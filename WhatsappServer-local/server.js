
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, getDocs, Timestamp, getDoc, writeBatch, addDoc, setDoc, deleteDoc } = require('firebase/firestore');

const { jsPDF } = require("jspdf");
const { default: autoTable } = require("jspdf-autotable");
const { format, getDaysInMonth, getMonth, getYear, eachDayOfInterval, isSunday, isSaturday } = require("date-fns");
const { id: localeID } = require("date-fns/locale");


const firebaseConfig = {
  apiKey: "AIzaSyD9rX2jO_5bQ2ezK7sGv0QTMLcvy6aIhXE",
  authDomain: "sekolah-ccec3.firebaseapp.com",
  projectId: "sekolah-ccec3",
  storageBucket: "sekolah-ccec3.appspot.com",
  messagingSenderId: "430648491716",
  appId: "1:430648491716:web:1c3d389337adfd80d49391"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const logger = pino({ level: 'info' });

console.log('====================================================');
console.log('  AbTrack WhatsApp Server (v6.0 - Arsitektur Baileys)');
console.log('====================================================');
logger.info('Berhasil terhubung ke project Firestore: ' + firebaseConfig.projectId);

const SESSION_DIR = './.baileys_auth_info';
let sock;
let groupCache = {}; // Cache untuk menyimpan daftar grup

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if(qr) {
            console.log('Pindai QR Code di bawah ini untuk terhubung:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut;
            logger.error(`Koneksi terputus: ${lastDisconnect.error}, mencoba menghubungkan kembali: ${shouldReconnect}`);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                logger.error('Tidak dapat terhubung, keluar. Hapus folder .baileys_auth_info dan coba lagi.');
                if (fs.existsSync(SESSION_DIR)) {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                }
                process.exit(1);
            }
        } else if (connection === 'open') {
            logger.info('WhatsApp Terhubung! Siap memproses notifikasi.');
            
            try {
                logger.info('Memuat daftar grup...');
                const groups = await sock.groupFetchAllParticipating();
                groupCache = groups;
                logger.info(`Berhasil memuat ${Object.keys(groups).length} grup.`);
            } catch(e) {
                logger.error('Gagal memuat daftar grup saat startup.', e);
            }

            listenForNotificationJobs();
            listenForManualTriggers(); // Start the new listener
        }
    });
}

async function findGroupJidByName(name) {
    if (Object.keys(groupCache).length === 0) {
        try {
            logger.info('Cache grup kosong, mencoba memuat ulang...');
            const groups = await sock.groupFetchAllParticipating();
            groupCache = groups;
            logger.info(`Berhasil memuat ulang ${Object.keys(groups).length} grup.`);
        } catch(e) {
            logger.error('Gagal memuat ulang daftar grup.', e);
            return null;
        }
    }
    
    const groups = Object.values(groupCache);
    const foundGroup = groups.find(group => group.subject.trim().toLowerCase() === name.trim().toLowerCase());
    
    return foundGroup ? foundGroup.id : null;
}


function listenForNotificationJobs() {
    const q = query(collection(db, "notification_queue"), where("status", "==", "pending"));

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            return;
        }

        logger.info(`[QUEUE] Ditemukan ${snapshot.size} tugas baru. Memulai pemrosesan serial...`);

        // Use a for...of loop to process jobs one by one to prevent rate limits
        for (const jobDoc of snapshot.docs) {
            const jobData = jobDoc.data();
            const jobId = jobDoc.id;
            const jobRef = doc(db, "notification_queue", jobId);

            // Double-check the status in case it was processed by another call
            const freshDoc = await getDoc(jobRef);
            if (freshDoc.data()?.status !== 'pending') {
                logger.info(`[JOB] Melewati tugas ${jobId} karena status bukan 'pending'.`);
                continue;
            }

            logger.info(`[JOB] Mengambil tugas baru: ${jobId}`);

            try {
                await updateDoc(jobRef, { status: "processing", updatedAt: Timestamp.now() });

                const { recipient, message, fileData, fileMimetype, fileName } = jobData.payload;

                if (!recipient) {
                    throw new Error('Payload tidak valid: recipient kosong.');
                }
                
                let jid;
                if (recipient.match(/^\d+$/)) {
                     let phoneJid = recipient.replace(/\D/g, ''); 
                    if (phoneJid.startsWith('0')) {
                        phoneJid = '62' + phoneJid.substring(1);
                    }
                    jid = phoneJid + '@s.whatsapp.net';
                    const [result] = await sock.onWhatsApp(jid);
                    if (!result?.exists) {
                         throw new Error(`Nomor ${recipient} tidak ditemukan di WhatsApp.`);
                    }
                    jid = result.jid;
                } else {
                    jid = await findGroupJidByName(recipient);
                    if (!jid) {
                         throw new Error(`Grup "${recipient}" tidak ditemukan. Pastikan nama grup sama persis.`);
                    }
                }
                
                logger.info(`[JOB] Mengirim pesan ke ${jid}`);
                if (fileData) {
                    const buffer = Buffer.from(fileData, 'base64');
                    await sock.sendMessage(jid, {
                        document: buffer,
                        mimetype: fileMimetype,
                        fileName: fileName,
                        caption: message
                    });
                } else {
                    await sock.sendMessage(jid, { text: message });
                }

                await updateDoc(jobRef, { status: "sent", updatedAt: Timestamp.now() });
                logger.info(`[JOB] Tugas ${jobId} berhasil dikirim.`);

            } catch (error) {
                logger.error(`[JOB] Gagal memproses tugas ${jobId}: ${error.message}`);
                // If it's a rate limit error, reset to pending so the fail-safe or next run can pick it up.
                if (error.message && (error.message.includes('rate-overlimit') || error.message.includes('too-many-messages'))) {
                    logger.warn(`[RATE-LIMIT] Terkena rate-limit. Mereset tugas ${jobId} ke 'pending' untuk dicoba lagi nanti.`);
                    await updateDoc(jobRef, {
                        status: "pending",
                        errorMessage: `Rate limit hit. Will be retried automatically.`,
                        updatedAt: Timestamp.now()
                    });
                } else {
                    await updateDoc(jobRef, {
                        status: "failed",
                        errorMessage: error.message,
                        updatedAt: Timestamp.now()
                    });
                }
            }
            
            // CRUCIAL: Wait for a short, random interval before processing the next job.
            const delay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
            logger.info(`[QUEUE] Menjeda ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        logger.info(`[QUEUE] Selesai memproses batch saat ini.`);
    });
}

function listenForManualTriggers() {
    const q = query(collection(db, "manual_triggers"), where("status", "==", "pending"));

    onSnapshot(q, async (snapshot) => {
        if (snapshot.empty) {
            return;
        }

        logger.info(`[MANUAL-TRIGGER] Ditemukan ${snapshot.size} pemicu manual. Memproses...`);

        for (const triggerDoc of snapshot.docs) {
            const triggerData = triggerDoc.data();
            const triggerId = triggerDoc.id;
            const triggerRef = doc(db, "manual_triggers", triggerId);

            logger.info(`[MANUAL-TRIGGER] Mengambil pemicu: ${triggerId}`);
            
            // Mark as processing to prevent re-triggering
            await updateDoc(triggerRef, { status: "processing" });

            try {
                if (triggerData.type === 'monthly_recap') {
                    const { year, month, target } = triggerData;
                    if (typeof year !== 'number' || typeof month !== 'number' || month < 0 || month > 11 || !target) {
                        throw new Error('Payload tidak valid untuk pemicu rekap bulanan.');
                    }
                    logger.info(`[MANUAL-TRIGGER] Memulai rekap bulanan manual untuk ${month + 1}-${year} dengan target: ${target}`);
                    await generateAndQueueAllMonthlyRecaps(year, month, target);
                    logger.info(`[MANUAL-TRIGGER] Rekap bulanan manual untuk ${month + 1}-${year} berhasil dimasukkan ke antrean.`);
                }

                // Delete the trigger after successful processing
                await deleteDoc(triggerRef);
                logger.info(`[MANUAL-TRIGGER] Pemicu ${triggerId} berhasil diproses dan dihapus.`);

            } catch (error) {
                logger.error(`[MANUAL-TRIGGER] Gagal memproses pemicu ${triggerId}: ${error.message}`);
                // Mark as failed for inspection
                await updateDoc(triggerRef, { status: "failed", errorMessage: error.message });
            }
             // Add a small delay before next trigger
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    });
}

setInterval(async () => {
    logger.info('[FAIL-SAFE] Menjalankan pembersihan tugas macet...');
    try {
        const fiveMinutesAgo = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
        const q = query(
            collection(db, "notification_queue"),
            where("status", "==", "processing"),
            where("updatedAt", "<=", fiveMinutesAgo)
        );
        const stuckJobs = await getDocs(q);
        if (stuckJobs.empty) {
            logger.info('[FAIL-SAFE] Tidak ada tugas macet ditemukan.');
            return;
        }
        
        logger.warn(`[FAIL-SAFE] Ditemukan ${stuckJobs.size} tugas macet. Mereset ke 'pending'...`);
        const batch = writeBatch(db);
        stuckJobs.forEach(jobDoc => {
            batch.update(jobDoc.ref, { status: 'pending', errorMessage: 'Direset oleh fail-safe' });
        });
        await batch.commit();

    } catch (error) {
        logger.error(`[FAIL-SAFE] Error saat membersihkan tugas macet: ${error.message}`);
    }
}, 5 * 60 * 1000);


// --- SCHEDULED TASKS ---
let lastCheckDate = null;
let sentMasukReport = false;
let sentPulangReport = false;

async function generateUnattendedReport(type) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    let unattendedStudents = [];

    try {
        const studentsSnapshot = await getDocs(query(collection(db, "students"), where("status", "==", "Aktif")));
        const allStudents = studentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const attendanceSnapshot = await getDocs(query(collection(db, "attendance"), where("recordDate", ">=", todayStart), where("recordDate", "<=", todayEnd)));
        const attendanceRecords = attendanceSnapshot.docs.map(d => d.data());

        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const todayString = new Date().toLocaleDateString('id-ID', dateOptions);

        let messageHeader = '';
        if (type === 'masuk') {
            messageHeader = `*Laporan Siswa Belum Absen Masuk*\nTanggal: ${todayString}\n\nBerikut adalah daftar siswa yang belum melakukan absensi masuk hingga saat ini:\n`;
            const attendedStudentIds = new Set(attendanceRecords.map(r => r.studentId));
            unattendedStudents = allStudents.filter(s => !attendedStudentIds.has(s.id));
        } else { // type === 'pulang'
            messageHeader = `*Laporan Siswa Belum Absen Pulang*\nTanggal: ${todayString}\n\nBerikut adalah daftar siswa yang belum melakukan absensi pulang hingga saat ini:\n`;
            const pulangStudentIds = new Set(attendanceRecords.filter(r => r.timestampPulang).map(r => r.studentId));
            const masukStudentIds = new Set(attendanceRecords.map(r => r.studentId));
            unattendedStudents = allStudents.filter(s => masukStudentIds.has(s.id) && !pulangStudentIds.has(s.id));
        }
        
        if (unattendedStudents.length === 0) {
            logger.info(`[SCHEDULER] Tidak ada siswa yang belum absen ${type}. Laporan tidak dikirim.`);
            return;
        }

        const classesSnapshot = await getDocs(collection(db, "classes"));
        const classMap = new Map(classesSnapshot.docs.map(d => [d.id, d.data()]));

        // Group students by classId
        const unattendedByClassId = {};
        unattendedStudents.forEach(student => {
            if (!unattendedByClassId[student.classId]) {
                unattendedByClassId[student.classId] = [];
            }
            unattendedByClassId[student.classId].push(student.nama);
        });

        // For each class with unattended students, queue a notification
        for (const classId in unattendedByClassId) {
            const classInfo = classMap.get(classId);
            const studentNames = unattendedByClassId[classId];

            if (classInfo && classInfo.whatsappGroupName && studentNames.length > 0) {
                const groupName = classInfo.whatsappGroupName;
                
                let reportBody = `\n*Kelas ${classInfo.grade} ${classInfo.name}*:\n`;
                studentNames.sort().forEach(studentName => {
                    reportBody += `- ${studentName}\n`;
                });
                
                const message = messageHeader + reportBody;

                const jobPayload = {
                    payload: { recipient: groupName, message },
                    type: 'recap',
                    metadata: { reportType: `unattended_${type}`, classId: classId },
                    status: 'pending',
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(),
                    errorMessage: '',
                };

                await addDoc(collection(db, "notification_queue"), jobPayload);
                logger.info(`[SCHEDULER] Laporan siswa belum absen ${type} untuk kelas ${classInfo.name} berhasil dimasukkan ke antrean untuk grup ${groupName}.`);
                 await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    } catch (e) {
        logger.error(`[SCHEDULER] Gagal membuat laporan siswa belum absen ${type}: ${e.message}`);
    }
}

async function runScheduledTasks() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (lastCheckDate !== today) {
        logger.info('[SCHEDULER] Hari baru, mereset flag laporan harian.');
        sentMasukReport = false;
        sentPulangReport = false;
        lastCheckDate = today;
    }

    try {
        const schoolHoursSnap = await getDoc(doc(db, "settings", "schoolHours"));

        if (!schoolHoursSnap.exists()) {
            return;
        }

        const schoolHours = schoolHoursSnap.data();

        if (!schoolHours.jamMasuk || !schoolHours.jamPulang) {
            return;
        }

        const [hMasuk, mMasuk] = schoolHours.jamMasuk.split(':').map(Number);
        const reportTimeMasuk = new Date();
        reportTimeMasuk.setHours(hMasuk + 1, mMasuk, 0, 0);

        const [hPulang, mPulang] = schoolHours.jamPulang.split(':').map(Number);
        const reportTimePulang = new Date();
        reportTimePulang.setHours(hPulang + 1, mPulang, 0, 0);
        
        if (!sentMasukReport && now >= reportTimeMasuk && now < reportTimePulang) {
            logger.info('[SCHEDULER] Waktunya laporan siswa belum absen masuk. Memulai proses...');
            await generateUnattendedReport('masuk');
            sentMasukReport = true;
        }

        if (!sentPulangReport && now >= reportTimePulang) {
            logger.info('[SCHEDULER] Waktunya laporan siswa belum absen pulang. Memulai proses...');
            await generateUnattendedReport('pulang');
            sentPulangReport = true;
        }

    } catch (error) {
        logger.error(`[SCHEDULER] Error: ${error.message}`);
    }
}
// --- END DAILY SCHEDULED TASKS ---

// --- NEW MONTHLY RECAP TASKS ---
const isWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
}

async function generateMonthlyPdfBuffer(summary, students, classInfo, month, year, reportConfig, holidayDateStrings) {
    const doc = new jsPDF({ orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageMargin = 15;
    let lastY = 10;

    if (reportConfig?.headerImageUrl) {
        try {
            const base64Image = reportConfig.headerImageUrl;
            const imageType = base64Image.split(';')[0].split('/')[1].toUpperCase();
            const imgWidth = pageWidth - pageMargin * 2;
            const imgHeight = imgWidth * (150 / 950); // Aspect ratio
            doc.addImage(base64Image, imageType, pageMargin, 10, imgWidth, imgHeight);
            lastY = 10 + imgHeight + 5;
        } catch (e) {
            logger.error('Failed to add header image to PDF. Is it a valid data URI? Error:', e.message);
            lastY = 40; // Fallback position
        }
    } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text("Laporan Rekapitulasi Absensi", pageWidth / 2, 20, { align: 'center' });
        lastY = 35;
    }

    const scopeText = `Kelas: ${classInfo.name}, Tingkat: ${classInfo.grade}`;
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text("REKAPITULASI ABSENSI SISWA", pageWidth / 2, lastY, { align: 'center' });
    lastY += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const textY = lastY + 5;
    doc.text(scopeText, pageMargin, textY);
    doc.text(`Bulan: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}`, pageWidth - pageMargin, textY, { align: 'right' });
    lastY = textY + 10;

    const daysInMonth = getDaysInMonth(new Date(year, month));
    const head = [
        [{ content: 'No', rowSpan: 2 }, { content: 'Nama Siswa', rowSpan: 2 }, { content: 'NISN', rowSpan: 2 }, { content: 'Tanggal', colSpan: daysInMonth }, { content: 'Jumlah', colSpan: 6 }],
        [...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), 'Hadir', 'Telat', 'Sakit', 'Izin', 'Alfa', 'Dispen']
    ];

    const body = students.map((student, index) => {
        const studentSummary = summary[student.id];
        if (!studentSummary) return null;
        const attendanceRow = Array.from({ length: daysInMonth }, (_, i) => studentSummary.attendance[i + 1] || '');
        return [
            index + 1,
            student.nama,
            student.nisn,
            ...attendanceRow,
            studentSummary.summary.H + studentSummary.summary.T,
            studentSummary.summary.T,
            studentSummary.summary.S,
            studentSummary.summary.I,
            studentSummary.summary.A,
            studentSummary.summary.D,
        ];
    }).filter(row => row !== null);

    autoTable(doc, {
        head: head,
        body: body,
        startY: lastY,
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1, halign: 'center', valign: 'middle' },
        headStyles: { fillColor: [22, 163, 74], textColor: 255, halign: 'center' },
        columnStyles: {
            0: { halign: 'center', cellWidth: 8 }, 1: { halign: 'left', cellWidth: 40 }, 2: { halign: 'center', cellWidth: 20 },
        },
        willDrawCell: (data) => {
            const dayIndex = data.column.index - 3;
            if(data.section === 'body' && dayIndex >= 0 && dayIndex < daysInMonth) {
                const currentDate = new Date(year, month, dayIndex + 1);
                const dateString = format(currentDate, 'yyyy-MM-dd');
                if (holidayDateStrings.has(dateString) || isSunday(currentDate) || isSaturday(currentDate)) {
                    doc.setFillColor(229, 231, 235);
                }
            }
        }
    });
    lastY = (doc).lastAutoTable.finalY || lastY + 20;

    let signatureY = lastY + 15;
    if (signatureY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); signatureY = 40; }
    const leftX = pageWidth / 4;
    const rightX = (pageWidth / 4) * 3;
    doc.setFontSize(10);
    doc.setFont('times', 'normal');
    if(reportConfig){
        doc.text("Mengetahui,", leftX, signatureY, { align: 'center' });
        doc.text("Kepala Sekolah,", leftX, signatureY + 6, { align: 'center' });
        if (reportConfig.principalSignatureUrl) {
            try {
                doc.addImage(reportConfig.principalSignatureUrl, 'PNG', leftX - 25, signatureY + 8, 50, 20);
            } catch(e) { logger.error("Gagal menambahkan gambar ttd kepala sekolah", e.message); }
        }
        doc.setFont('times', 'bold');
        doc.text(reportConfig.principalName, leftX, signatureY + 28, { align: 'center' });
        doc.setFont('times', 'normal');
        doc.text(reportConfig.principalNpa, leftX, signatureY + 34, { align: 'center' });

        doc.text(`${reportConfig.reportLocation}, ` + format(new Date(), "dd MMMM yyyy", { locale: localeID }), rightX, signatureY, { align: 'center' });
        doc.text("Petugas,", rightX, signatureY + 6, { align: 'center' });
        if (reportConfig.signatorySignatureUrl) {
            try {
                doc.addImage(reportConfig.signatorySignatureUrl, 'PNG', rightX - 25, signatureY + 8, 50, 20);
            } catch(e) { logger.error("Gagal menambahkan gambar ttd petugas", e.message); }
        }
        doc.setFont('times', 'bold');
        doc.text(reportConfig.signatoryName, rightX, signatureY + 28, { align: 'center' });
        doc.setFont('times', 'normal');
        doc.text(reportConfig.signatoryNpa, rightX, signatureY + 34, { align: 'center' });
    }
    
    return Buffer.from(doc.output('arraybuffer'));
}

async function generateAndQueueAllMonthlyRecaps(recapYear, recapMonth, target) {
    logger.info(`[MONTHLY-RECAP] Memulai proses rekap bulanan untuk ${recapMonth + 1}-${recapYear} dengan target: ${target}`);

    try {
        const [allClassesSnapshot, studentsSnapshot, holidaysSnapshot, reportConfigSnap] = await Promise.all([
            getDocs(collection(db, "classes")),
            getDocs(query(collection(db, "students"), where("status", "==", "Aktif"))),
            getDocs(collection(db, "holidays")),
            getDoc(doc(db, "settings", "reportConfig"))
        ]);

        const reportConfig = reportConfigSnap.exists() ? reportConfigSnap.data() : null;
        if (!reportConfig) throw new Error("Pengaturan laporan (reportConfig) tidak ditemukan di database.");
        
        const allClasses = allClassesSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const classMap = new Map(allClasses.map(c => [c.id, c]));

        let classIdsToQuery = [];
        if (target.startsWith("grade-")) {
            const grade = target.split('-')[1];
            classIdsToQuery = allClasses.filter(c => c.grade === grade).map(c => c.id);
        } else if (target === "all-grades") {
            classIdsToQuery = allClasses.map(c => c.id);
        } else {
            classIdsToQuery = [target];
        }

        if (classIdsToQuery.length === 0) {
            logger.warn(`[MONTHLY-RECAP] Tidak ada kelas yang cocok dengan target: ${target}.`);
            return;
        }

        const students = studentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => classIdsToQuery.includes(s.classId));
        const studentsByClass = {};
        students.forEach(student => {
            if (!studentsByClass[student.classId]) studentsByClass[student.classId] = [];
            studentsByClass[student.classId].push(student);
        });
        
        const holidays = holidaysSnapshot.docs.map(d => d.data());
        const holidayDateStrings = new Set();
        holidays.forEach(holiday => {
            const start = holiday.startDate.toDate();
            const end = holiday.endDate.toDate();
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                 if (getMonth(d) === recapMonth && getYear(d) === recapYear) {
                     holidayDateStrings.add(d.toISOString().split('T')[0]);
                 }
            }
        });

        const monthStart = new Date(recapYear, recapMonth, 1);
        const monthEnd = new Date(recapYear, recapMonth + 1, 0);

        const allStudentIds = students.map(s => s.id);
        const allAttendance = [];
        for (let i = 0; i < allStudentIds.length; i += 30) {
            const chunk = allStudentIds.slice(i, i + 30);
            if(chunk.length === 0) continue;
            const attendanceQuery = query(collection(db, "attendance"), where("studentId", "in", chunk), where("recordDate", ">=", monthStart), where("recordDate", "<=", monthEnd));
            const attendanceSnapshot = await getDocs(attendanceQuery);
            attendanceSnapshot.forEach(doc => allAttendance.push(doc.data()));
        }
        
        logger.info(`[MONTHLY-RECAP] Memproses rekap untuk ${Object.keys(studentsByClass).length} kelas...`);

        for (const classId of classIdsToQuery) {
            const classInfo = classMap.get(classId);
            const studentsInClass = studentsByClass[classId];

            if (!classInfo || !classInfo.whatsappGroupName || !studentsInClass || studentsInClass.length === 0) {
                logger.warn(`[MONTHLY-RECAP] Melewati kelas ${classInfo?.name || classId} karena tidak ada grup WA atau tidak ada siswa.`);
                continue;
            }

            const summary = {};
            const daysInMonth = getDaysInMonth(new Date(recapYear, recapMonth));
            
            studentsInClass.forEach(student => {
                summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0, L: 0 } };
                const studentRecords = allAttendance.filter(r => r.studentId === student.id);
                const studentRecordsByDate = new Map(studentRecords.map(r => [r.recordDate.toDate().toISOString().split('T')[0], r]));

                for(let day = 1; day <= daysInMonth; day++) {
                    const currentDate = new Date(recapYear, recapMonth, day);
                    const dateString = currentDate.toISOString().split('T')[0];
                    
                    if (holidayDateStrings.has(dateString) || isWeekend(currentDate)) {
                        summary[student.id].attendance[day] = 'L';
                        summary[student.id].summary.L++;
                        continue;
                    }

                    const recordForDay = studentRecordsByDate.get(dateString);
                    if (recordForDay) {
                        let statusChar = '';
                        switch (recordForDay.status) {
                            case "Hadir": statusChar = 'H'; summary[student.id].summary.H++; break;
                            case "Terlambat": statusChar = 'T'; summary[student.id].summary.T++; break;
                            case "Sakit": statusChar = 'S'; summary[student.id].summary.S++; break;
                            case "Izin": statusChar = 'I'; summary[student.id].summary.I++; break;
                            case "Alfa": statusChar = 'A'; summary[student.id].summary.A++; break;
                            case "Dispen": statusChar = 'D'; summary[student.id].summary.D++; break;
                        }
                         if (statusChar) summary[student.id].attendance[day] = statusChar;
                    } else {
                        summary[student.id].attendance[day] = 'A';
                        summary[student.id].summary.A++;
                    }
                }
            });
            
            const pdfBuffer = await generateMonthlyPdfBuffer(summary, studentsInClass, classInfo, recapMonth, recapYear, reportConfig, holidayDateStrings);
            
            const monthName = format(new Date(recapYear, recapMonth), "MMMM yyyy", { locale: localeID });
            const caption = `Rekap Absensi Bulanan: ${monthName}\nKelas: ${classInfo.grade} ${classInfo.name}`;
            const fileName = `Rekap_${classInfo.name.replace(/ /g, '_')}_${monthName.replace(/ /g, '_')}.pdf`;
            
            const jobPayload = {
                payload: {
                    recipient: classInfo.whatsappGroupName,
                    message: caption,
                    fileData: pdfBuffer.toString('base64'),
                    fileMimetype: 'application/pdf',
                    fileName: fileName,
                },
                type: 'recap_pdf',
                metadata: { reportType: 'monthly_class_recap_pdf', classId: classId },
                status: 'pending',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                errorMessage: '',
            };

            await addDoc(collection(db, "notification_queue"), jobPayload);
            logger.info(`[MONTHLY-RECAP] Rekap PDF untuk kelas ${classInfo.name} berhasil dimasukkan ke antrean.`);
             // Add delay to prevent hitting write limits if processing many classes
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const statusDocRef = doc(db, "settings", "monthlyRecapStatus");
        await setDoc(statusDocRef, { [`lastRun_${target}`]: `${recapYear}-${recapMonth}` }, { merge: true });
        logger.info(`[MONTHLY-RECAP] Selesai: Semua rekap PDF untuk target ${target} berhasil dimasukkan ke antrean.`);

    } catch (e) {
        logger.error(`[MONTHLY-RECAP] Gagal menjalankan proses rekap bulanan PDF: ${e.message}`);
        throw e;
    }
}


async function runMonthlyRecapScheduler() {
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    // Run on the last day of the month at 8 PM (20:00)
    if (now.getDate() === lastDayOfMonth && now.getHours() === 20) {
        logger.info('[MONTHLY-RECAP-SCHEDULER] Waktu untuk rekap bulanan otomatis. Memulai proses...');
        const year = now.getFullYear();
        const month = now.getMonth();
        const monthIdentifier = `${year}-${month}`;

        try {
            const statusDocRef = doc(db, "settings", "monthlyRecapStatus");
            const statusDocSnap = await getDoc(statusDocRef);
            if (statusDocSnap.exists() && statusDocSnap.data().lastRun_all === monthIdentifier) {
                logger.info(`[MONTHLY-RECAP-SCHEDULER] Rekap bulanan otomatis untuk ${monthIdentifier} sudah pernah dijalankan. Melewati.`);
                return;
            }
            logger.info('[MONTHLY-RECAP-SCHEDULER] Memulai pembuatan rekap PDF otomatis untuk semua kelas...');
            await generateAndQueueAllMonthlyRecaps(year, month, 'all-grades');
            await setDoc(statusDocRef, { lastRun_all: monthIdentifier }, { merge: true });
        } catch(e) {
            logger.error(`[MONTHLY-RECAP-SCHEDULER] Gagal menjalankan rekap otomatis: ${e.message}`);
        }
    }
}

// Check every 5 minutes for daily reports
setInterval(runScheduledTasks, 5 * 60 * 1000);
// Check every hour for monthly recap
setInterval(runMonthlyRecapScheduler, 60 * 60 * 1000);

// --- END MONTHLY RECAP TASKS ---

connectToWhatsApp();

process.on('SIGINT', async () => {
    logger.info("Menutup koneksi...");
    if(sock) {
        await sock.logout();
    }
    process.exit(0);
});

    