'use server';
/**
 * @fileOverview Handles all Telegram bot interactions.
 * - processTelegramWebhook: Processes incoming messages from the Telegram webhook for user registration.
 * - notifyParentOnAttendance: Sends daily attendance notifications to parents.
 * - sendMonthlyRecapToParent: Sends a monthly recap to an individual parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for a class to the advisors' group.
 * - syncTelegramMessages: Fetches and processes new messages from Telegram upon manual request.
 * - deleteTelegramWebhook: Removes the currently active webhook from the bot.
 * - runMonthlyRecapAutomation: Runs the entire monthly recap process automatically for all classes.
 */

import { collection, doc, getDoc, getDocs, query, updateDoc, where, Timestamp, setDoc, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format, subMonths, startOfMonth, endOfMonth, getYear, getMonth, getDate, eachDayOfInterval, getDay, getDaysInMonth } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type TelegramSettings = {
  groupChatId?: string;
  notifHadir: boolean;
  notifTerlambat: boolean;
  notifAbsen: boolean;
};

type Class = { id: string; name: string; grade: string };
type Student = { id: string; nisn: string; nama: string; classId: string };
type Holiday = { id: string; name: string; startDate: Timestamp; endDate: Timestamp };
type AttendanceRecord = {
  id?: string
  studentId: string
  nisn: string
  studentName: string
  classId: string
  status: "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
  timestampMasuk: Timestamp | null
  timestampPulang: Timestamp | null
  recordDate: Timestamp
};
type AutomationAttendanceRecord = {
  studentId: string
  status: "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
  recordDate: Timestamp
}

// New type for Server Action to avoid non-plain objects
export type SerializableAttendanceRecord = {
  id?: string
  studentId: string
  nisn: string
  studentName: string
  classId: string
  status: "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
  timestampMasuk: string | null
  timestampPulang: string | null
  recordDate: string
};

type MonthlySummaryData = {
    studentInfo: Student,
    attendance: { [day: number]: string },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
};

type MonthlySummary = {
    [studentId: string]: MonthlySummaryData
}

// Internal helper to get bot token from environment variables
function getBotToken(): string | null {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.error("TELEGRAM_BOT_TOKEN environment variable not set.");
        return null;
    }
    return token;
}

// Internal helper to get Telegram config from Firestore
async function getTelegramConfig(): Promise<TelegramSettings | null> {
    try {
        const docRef = doc(db, "settings", "telegramConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as TelegramSettings;
        }
        return null;
    } catch (error) {
        console.error("Error fetching Telegram config:", error);
        return null;
    }
}

// Internal helper to send a message via Telegram API
async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("Telegram API Error:", errorData.description, errorData);
        }
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
    }
}

/**
 * Processes a single incoming update (message) from Telegram.
 * Handles user registration by matching NISN to a student.
 * @param payload The update object from Telegram.
 */
export async function processTelegramWebhook(payload: any) {
    const botToken = getBotToken();
    if (!botToken) {
        console.error("Bot token not configured on server.");
        return;
    }

    const message = payload.message || payload.edited_message;
    if (!message) {
        return;
    }

    const chatId = message.chat?.id;
    const text = message.text?.trim();

    if (!chatId || !text) {
        return;
    }

    // Handle /start command
    if (text === '/start') {
        const welcomeMessage = "👋 Selamat datang di layanan Notifikasi AbsensiKu Cerdas untuk SMAS PGRI Naringgul.\n\nSistem ini akan menghubungkan satu akun Telegram dengan satu siswa. Untuk memulai, silakan balas pesan ini dengan Nomor Induk Siswa Nasional (NISN) putra/putri Anda.";
        await sendTelegramMessage(botToken, String(chatId), welcomeMessage);
        return;
    }
    
    // Handle NISN (numeric input)
    if (/^\d+$/.test(text)) {
        const nisn = text;
        const stringChatId = String(chatId);

        try {
            // 1. Check if this Telegram account (chatId) is already linked to ANY student.
            const chatQuery = query(collection(db, "students"), where("parentChatId", "==", stringChatId));
            const chatSnapshot = await getDocs(chatQuery);

            if (!chatSnapshot.empty) {
                const linkedStudent = chatSnapshot.docs[0].data();
                if (linkedStudent.nisn === nisn) {
                    const alreadyRegisteredMessage = `✅ Akun Anda Sudah Terdaftar\n\nAkun Telegram ini sudah terhubung dengan siswa atas nama ${linkedStudent.nama}. Anda tidak perlu mendaftar lagi.`;
                    await sendTelegramMessage(botToken, stringChatId, alreadyRegisteredMessage);
                } else {
                    const chatInUseMessage = `⚠️ Pendaftaran Gagal\n\nAkun Telegram Anda sudah terdaftar untuk siswa lain (${linkedStudent.nama}). Satu akun hanya bisa terhubung ke satu siswa.`;
                    await sendTelegramMessage(botToken, stringChatId, chatInUseMessage);
                }
                return;
            }

            // 2. If the chat ID is free, check the status of the NISN.
            const nisnQuery = query(collection(db, "students"), where("nisn", "==", nisn));
            const nisnSnapshot = await getDocs(nisnQuery);

            if (nisnSnapshot.empty) {
                const notFoundMessage = `⚠️ NISN Tidak Ditemukan\n\nNISN ${nisn} tidak terdaftar dalam sistem kami. Mohon periksa kembali nomor tersebut dan coba lagi.`;
                await sendTelegramMessage(botToken, stringChatId, notFoundMessage);
                return;
            }
            
            // 3. Check if the student found by NISN is already claimed by another parent.
            const studentDoc = nisnSnapshot.docs[0];
            const studentData = studentDoc.data();

            if (studentData.parentChatId && studentData.parentChatId !== "") {
                const nisnClaimedMessage = `⚠️ Pendaftaran Gagal\n\nSiswa atas nama ${studentData.nama} (NISN: ${nisn}) sudah terhubung dengan akun Telegram lain. Hubungi administrator jika Anda yakin ini adalah sebuah kesalahan.`;
                await sendTelegramMessage(botToken, stringChatId, nisnClaimedMessage);
                return;
            }

            // 4. All checks passed. Link the account.
            await updateDoc(doc(db, "students", studentDoc.id), {
                parentChatId: stringChatId
            });
            const successMessage = `✅ Pendaftaran Berhasil!\n\nAkun Telegram Anda telah berhasil terhubung dengan data absensi atas nama ${studentData.nama}.\n\nAnda akan mulai menerima notifikasi absensi.`;
            await sendTelegramMessage(botToken, stringChatId, successMessage);

        } catch (error) {
            console.error("Error during NISN registration:", error);
            const errorMessage = "Terjadi kesalahan pada sistem saat pendaftaran. Mohon coba lagi nanti.";
            await sendTelegramMessage(botToken, stringChatId, errorMessage);
        }
        return;
    }

    // Handle any other message
    const defaultReply = "ℹ️ Perintah tidak dikenali.\n\nJika Anda ingin mendaftar, silakan kirimkan NISN putra/putri Anda. Jika Anda ingin memulai dari awal, gunakan perintah /start.";
    await sendTelegramMessage(botToken, String(chatId), defaultReply);
}

/**
 * Formats and sends a daily attendance notification to a parent.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyParentOnAttendance(record: SerializableAttendanceRecord) {
    const botToken = getBotToken();
    if (!botToken) return;

    const config = await getTelegramConfig();
    if (!config) return;

    const status = record.status;
    const isClockOut = !!record.timestampPulang;

    // Check if notification for this status is enabled
    if (status === 'Hadir' && !isClockOut && !config.notifHadir) return;
    if (status === 'Terlambat' && !isClockOut && !config.notifTerlambat) return;
    if (isClockOut && !config.notifHadir) return; // Assume clock-out notif follows "hadir" setting
    if (['Sakit', 'Izin', 'Alfa', 'Dispen'].includes(status) && !config.notifAbsen) return;
    
    const studentDocRef = doc(db, "students", record.studentId);
    const studentSnap = await getDoc(studentDocRef);
    const parentChatId = studentSnap.data()?.parentChatId;
    if (!parentChatId) return;

    const classSnap = await getDoc(doc(db, "classes", record.classId));
    const classInfo = classSnap.data() as Class;
    
    let timestamp: Date;
    let title: string;
    const finalStatus = isClockOut ? 'Pulang' : record.status;

    if (isClockOut && record.timestampPulang) {
        timestamp = new Date(record.timestampPulang);
        title = `Absensi Pulang: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (!isClockOut && record.timestampMasuk) {
        timestamp = new Date(record.timestampMasuk);
        title = `Absensi Masuk: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else {
        timestamp = new Date(); // Use current time for manual status changes
        title = `Informasi Absensi: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    }

    const messageLines = [
        "🏫 SMAS PGRI Naringgul",
        title,
        "",
        `👤 Nama      : ${record.studentName}`,
        `🆔 NISN      : ${record.nisn}`,
        `📚 Kelas     : ${classInfo.name}`,
        `⏰ Jam       : ${format(timestamp, "HH:mm:ss")}`,
        `👋 Status    : ${finalStatus}`,
        "",
        "--",
        "Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas."
    ];
    
    const message = messageLines.join("\n");
    await sendTelegramMessage(botToken, parentChatId, message);
}

/**
 * Sends a monthly recap notification to a parent.
 * @param studentData The student's full summary data for the month.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function sendMonthlyRecapToParent(
    studentData: MonthlySummaryData,
    month: number,
    year: number
) {
    const botToken = getBotToken();
    if (!botToken) return;

    const student = studentData.studentInfo;
    const summary = studentData.summary;

    const studentDocRef = doc(db, "students", student.id);
    const studentSnap = await getDoc(studentDocRef);
    const parentChatId = studentSnap.data()?.parentChatId;
    if (!parentChatId) return; // Skip if parent is not registered

    const classSnap = await getDoc(doc(db, "classes", student.classId));
    const classInfo = classSnap.data() as Class;

    const totalSchoolDays = Object.values(summary).reduce((a, b) => a + b, 0);
    const totalHadir = summary.H + summary.T; // Hadir + Terlambat

    const messageLines = [
        "🏫 SMAS PGRI Naringgul",
        `Laporan Bulanan: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}`,
        "",
        "Yth. Orang Tua/Wali dari:",
        `👤 Nama      : ${student.nama}`,
        `🆔 NISN      : ${student.nisn}`,
        `📚 Kelas     : ${classInfo.name}`,
        "",
        "Berikut adalah rekapitulasi kehadiran putra/putri Anda:",
        `✅ Total Hadir      : ${totalHadir} hari`,
        `⏰ Terlambat      : ${summary.T} kali`,
        `🤒 Sakit         : ${summary.S} hari`,
        `✉️ Izin          : ${summary.I} hari`,
        `✈️ Dispen        : ${summary.D} hari`,
        `❌ Alfa           : ${summary.A} hari`,
        "",
        `Dari total ${totalSchoolDays} hari sekolah efektif pada bulan ini.`,
        "",
        "--",
        "Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas."
    ];

    await sendTelegramMessage(botToken, parentChatId, messageLines.join("\n"));
}


/**
 * Sends a monthly recap for a class to the designated advisors' group chat.
 * @param className The name of the class being reported.
 * @param grade The grade of the class.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 * @param summary The complete monthly summary object for all students in the report.
 */
export async function sendClassMonthlyRecap(
    className: string,
    grade: string,
    month: number,
    year: number,
    summary: { [studentId: string]: MonthlySummaryData }
) {
    const botToken = getBotToken();
    if (!botToken) return;

    const config = await getTelegramConfig();
    if (!config?.groupChatId) return;

    let totalPresent = 0;
    let totalLate = 0;
    let totalSick = 0;
    let totalPermission = 0;
    let totalDispen = 0;
    let totalAlfa = 0;
    
    Object.values(summary).forEach(studentData => {
        totalPresent += studentData.summary.H;
        totalLate += studentData.summary.T;
        totalSick += studentData.summary.S;
        totalPermission += studentData.summary.I;
        totalDispen += studentData.summary.D;
        totalAlfa += studentData.summary.A;
    });

    const totalStudents = Object.keys(summary).length;
    const totalKehadiran = totalPresent + totalLate;

    const messageLines = [
        "🏫 Laporan Bulanan untuk Wali Kelas",
        `Kelas: ${className} (${grade})`,
        `Periode: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}`,
        "",
        `Berikut adalah rekapitulasi absensi kolektif untuk ${totalStudents} siswa di kelas Anda:`,
        "",
        "📈 STATISTIK KELAS:",
        `Total Kehadiran (Hadir+Terlambat): ${totalKehadiran}`,
        `Total Terlambat: ${totalLate}`,
        `Total Sakit: ${totalSick}`,
        `Total Izin: ${totalPermission}`,
        `Total Dispensasi: ${totalDispen}`,
        `Total Tanpa Keterangan (Alfa): ${totalAlfa}`,
        "",
        "--",
        "Pesan ini dikirim otomatis oleh sistem."
    ];

    await sendTelegramMessage(botToken, config.groupChatId, messageLines.join("\n"));
}


/**
 * Fetches new messages from Telegram, processes them, and updates the last processed ID.
 * This is an alternative to using webhooks, triggered manually by the user.
 * @returns An object indicating success or failure, with a message.
 */
export async function syncTelegramMessages(): Promise<{ success: boolean; message: string }> {
    const botToken = getBotToken();
    if (!botToken) {
        return { success: false, message: "Token bot tidak diatur di file .env server." };
    }

    // 1. Get last processed update_id
    const stateDocRef = doc(db, "settings", "telegramState");
    const stateDocSnap = await getDoc(stateDocRef);
    const lastUpdateId = stateDocSnap.exists() ? stateDocSnap.data().lastUpdateId || 0 : 0;
    const offset = lastUpdateId + 1;

    // 2. Fetch updates from Telegram using the getUpdates method
    const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=10`;
    let updates: any[] = [];
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (!data.ok) {
            console.error("Telegram getUpdates API Error:", data.description);
            return { success: false, message: `Gagal mengambil pesan: ${data.description}` };
        }
        updates = data.result;
    } catch (error) {
        console.error("Failed to fetch Telegram updates:", error);
        return { success: false, message: "Gagal terhubung ke server Telegram. Periksa koneksi jaringan server." };
    }

    if (updates.length === 0) {
        return { success: true, message: "Tidak ada pesan baru untuk diproses." };
    }

    // 3. Process each update sequentially
    let highestUpdateId = lastUpdateId;
    for (const update of updates) {
        try {
            // processTelegramWebhook is designed to handle one update object at a time
            await processTelegramWebhook(update); 
        } catch (e) {
            console.error(`Error processing update ID ${update.update_id}:`, e);
            // Continue to the next update even if one fails
        }
        highestUpdateId = Math.max(highestUpdateId, update.update_id);
    }

    // 4. Save the new highest update_id to prevent re-processing
    if (highestUpdateId > lastUpdateId) {
        await setDoc(stateDocRef, { lastUpdateId: highestUpdateId }, { merge: true });
    }

    return { success: true, message: `Berhasil memproses ${updates.length} pesan baru.` };
}

/**
 * Deletes the bot's webhook, allowing getUpdates to be used.
 * @returns An object indicating success or failure.
 */
export async function deleteTelegramWebhook(): Promise<{ success: boolean; message: string }> {
    const botToken = getBotToken();
    if (!botToken) {
        return { success: false, message: "Token bot tidak diatur di file .env server." };
    }

    const url = `https://api.telegram.org/bot${botToken}/deleteWebhook`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        if (data.ok) {
            return { success: true, message: "Webhook berhasil dihapus. Anda sekarang dapat menggunakan sinkronisasi manual." };
        } else {
            return { success: false, message: `Gagal menghapus webhook: ${data.description}` };
        }
    } catch (error) {
        console.error("Failed to delete webhook:", error);
        return { success: false, message: "Gagal terhubung ke server Telegram." };
    }
}

/**
 * Runs the automated process to send monthly recap reports to all parents and class advisors.
 * This function is designed to be triggered by a cron job.
 */
export async function runMonthlyRecapAutomation() {
    console.log("Starting monthly recap automation process...");
    
    // 1. Determine the target month (previous month)
    const today = new Date();
    const previousMonthDate = subMonths(today, 1);
    const targetMonth = getMonth(previousMonthDate);
    const targetYear = getYear(previousMonthDate);
    
    console.log(`Targeting report for: ${format(previousMonthDate, "MMMM yyyy")}`);

    // 2. Fetch all necessary data from Firestore
    const [classesSnapshot, studentsSnapshot, holidaysSnapshot] = await Promise.all([
        getDocs(collection(db, "classes")),
        getDocs(query(collection(db, "students"), where("status", "==", "Aktif"))),
        getDocs(collection(db, "holidays"))
    ]);

    const classes = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
    const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
    const holidays = holidaysSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Holiday[];
    
    if (students.length === 0) {
        console.log("No active students found. Aborting recap automation.");
        return;
    }

    // 3. Fetch all attendance records for the target month
    const monthStart = startOfMonth(previousMonthDate);
    const monthEnd = endOfMonth(previousMonthDate);
    const studentIds = students.map(s => s.id);
    const attendanceRecords: AutomationAttendanceRecord[] = [];

    const studentIdChunks = [];
    for (let i = 0; i < studentIds.length; i += 30) {
        studentIdChunks.push(studentIds.slice(i, i + 30));
    }

    for (const chunk of studentIdChunks) {
        if (chunk.length === 0) continue;
        const attendanceQuery = query(
            collection(db, "attendance"),
            where("studentId", "in", chunk),
            where("recordDate", ">=", monthStart),
            where("recordDate", "<=", monthEnd)
        );
        const attendanceSnapshot = await getDocs(attendanceQuery);
        attendanceSnapshot.forEach(doc => attendanceRecords.push(doc.data() as AutomationAttendanceRecord));
    }

    // 4. Process data into summary format
    const holidayDateStrings = new Set<string>();
    holidays.forEach(holiday => {
        const start = holiday.startDate.toDate();
        const end = holiday.endDate.toDate();
        const interval = eachDayOfInterval({ start, end });
        interval.forEach(day => {
            if (getMonth(day) === targetMonth && getYear(day) === targetYear) {
                holidayDateStrings.add(format(day, 'yyyy-MM-dd'));
            }
        });
    });

    const summary: MonthlySummary = {};
    const daysInMonth = getDaysInMonth(previousMonthDate);
            
    students.forEach(student => {
        summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0, L: 0 } };
        const studentRecords = attendanceRecords.filter(r => r.studentId === student.id);
        
        for(let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(targetYear, targetMonth, day);
            const dateString = format(currentDate, 'yyyy-MM-dd');
            const dayOfWeek = getDay(currentDate);

            if (holidayDateStrings.has(dateString) || dayOfWeek === 0) { // Sunday is a holiday
                summary[student.id].attendance[day] = 'L';
                summary[student.id].summary.L++;
                continue;
            }

            const recordForDay = studentRecords.find(r => getDate(r.recordDate.toDate()) === day);
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

    // 5. Send notifications
    // Send to individual parents
    console.log(`Sending recaps to ${students.length} parents...`);
    for (const studentData of Object.values(summary)) {
        await sendMonthlyRecapToParent(studentData, targetMonth, targetYear);
        // Add a small delay to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log("Finished sending recaps to parents.");

    // Send to class advisor groups
    console.log("Sending recaps to class advisor groups...");
    const classSummaries: { [classId: string]: MonthlySummary } = {};
    Object.values(summary).forEach(studentData => {
        const classId = studentData.studentInfo.classId;
        if (!classSummaries[classId]) {
            classSummaries[classId] = {};
        }
        classSummaries[classId][studentData.studentInfo.id] = studentData;
    });

    for (const classId in classSummaries) {
        const classInfo = classes.find(c => c.id === classId);
        if (classInfo) {
            await sendClassMonthlyRecap(classInfo.name, classInfo.grade, targetMonth, targetYear, classSummaries[classId]);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    console.log("Finished sending recaps to advisors.");
    console.log("Monthly recap automation process completed.");
}
