
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode-terminal');
const fs = require('fs');

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, query, where, onSnapshot, doc, updateDoc, getDocs, Timestamp, getDoc, writeBatch, addDoc } = require('firebase/firestore');

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

                const { recipient, message } = jobData.payload;
                if (!recipient || !message) {
                    throw new Error('Payload tidak valid: recipient atau message kosong.');
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
                await sock.sendMessage(jid, { text: message });

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

async function generateUnattendedReport(adminGroup, type) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const studentsByClass = {};
    let message = '';
    let unattendedStudents = [];

    try {
        const studentsSnapshot = await getDocs(query(collection(db, "students"), where("status", "==", "Aktif")));
        const allStudents = studentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const attendanceSnapshot = await getDocs(query(collection(db, "attendance"), where("recordDate", ">=", todayStart), where("recordDate", "<=", todayEnd)));
        const attendanceRecords = attendanceSnapshot.docs.map(d => d.data());

        const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        const todayString = new Date().toLocaleDateString('id-ID', dateOptions);

        if (type === 'masuk') {
            message = `*Laporan Siswa Belum Absen Masuk*\nTanggal: ${todayString}\n\nBerikut adalah daftar siswa yang belum melakukan absensi masuk hingga saat ini:\n`;
            const attendedStudentIds = new Set(attendanceRecords.map(r => r.studentId));
            unattendedStudents = allStudents.filter(s => !attendedStudentIds.has(s.id));
        } else { // type === 'pulang'
            message = `*Laporan Siswa Belum Absen Pulang*\nTanggal: ${todayString}\n\nBerikut adalah daftar siswa yang belum melakukan absensi pulang hingga saat ini:\n`;
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

        unattendedStudents.forEach(student => {
            const classInfo = classMap.get(student.classId);
            const className = classInfo ? `${classInfo.grade} ${classInfo.name}` : 'Kelas Tidak Dikenal';
            if (!studentsByClass[className]) {
                studentsByClass[className] = [];
            }
            studentsByClass[className].push(student.nama);
        });

        const sortedClasses = Object.keys(studentsByClass).sort();
        
        let reportBody = '';
        sortedClasses.forEach(className => {
            reportBody += `\n*${className}*:\n`;
            studentsByClass[className].sort().forEach(studentName => {
                reportBody += `- ${studentName}\n`;
            });
        });
        
        message += reportBody;

        const jobPayload = {
            payload: { recipient: adminGroup, message },
            type: 'recap',
            metadata: { reportType: `unattended_${type}` },
            status: 'pending',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            errorMessage: '',
        };

        await addDoc(collection(db, "notification_queue"), jobPayload);
        logger.info(`[SCHEDULER] Laporan siswa belum absen ${type} berhasil dimasukkan ke antrean untuk grup ${adminGroup}.`);

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
        const appConfigSnap = await getDoc(doc(db, "settings", "appConfig"));

        if (!schoolHoursSnap.exists() || !appConfigSnap.exists()) {
            return;
        }

        const schoolHours = schoolHoursSnap.data();
        const appConfig = appConfigSnap.data();
        const adminGroup = appConfig.adminNotificationGroupName;

        if (!adminGroup || !schoolHours.jamMasuk || !schoolHours.jamPulang) {
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
            await generateUnattendedReport(adminGroup, 'masuk');
            sentMasukReport = true;
        }

        if (!sentPulangReport && now >= reportTimePulang) {
            logger.info('[SCHEDULER] Waktunya laporan siswa belum absen pulang. Memulai proses...');
            await generateUnattendedReport(adminGroup, 'pulang');
            sentPulangReport = true;
        }

    } catch (error) {
        logger.error(`[SCHEDULER] Error: ${error.message}`);
    }
}

// Check every 5 minutes
setInterval(runScheduledTasks, 5 * 60 * 1000);
// --- END SCHEDULED TASKS ---


const expressApp = express();
const PORT = 8000;
expressApp.get('/', (req, res) => {
    res.send('WhatsApp Server (Baileys) is running.');
});
expressApp.listen(PORT, () => {
    logger.info(`Server Express berjalan di port ${PORT}`);
});

connectToWhatsApp();

process.on('SIGINT', async () => {
    logger.info("Menutup koneksi...");
    if(sock) {
        await sock.logout();
    }
    process.exit(0);
});
