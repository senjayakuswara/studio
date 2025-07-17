'use server';
/**
 * @fileOverview Handles all student and parent notifications via Telegram.
 * - processTelegramWebhook: Main entry point for incoming Telegram messages.
 * - notifyParentOnAttendance: Sends daily attendance notifications.
 * - sendMonthlyRecapToParent: Sends a monthly recap to an individual parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for a class to the advisors' group.
 * - runMonthlyRecapAutomation: Runs the entire monthly recap process automatically for all classes.
 */

import { collection, doc, getDoc, getDocs, query, updateDoc, where, Timestamp, setDoc, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format, subMonths, startOfMonth, endOfMonth, getYear, getMonth, getDate, eachDayOfInterval, getDay, getDaysInMonth } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type TelegramSettings = {
  botToken: string;
  chatId: string;
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
  status: "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
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
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown'
            }),
        });
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
    }
}

/**
 * Handles incoming webhook payloads from Telegram.
 * @param payload The webhook payload from Telegram.
 */
export async function processTelegramWebhook(payload: any) {
    console.log("Received Telegram payload:", payload);
    const message = payload.message || payload.edited_message;
    if (!message) return;

    const chatId = message.chat.id;
    const text = message.text;

    const config = await getTelegramConfig();
    if (!config || !config.botToken) return;

    if (text === '/myid') {
        const responseText = `Your Chat ID is: \`${chatId}\``;
        await sendTelegramMessage(config.botToken, String(chatId), responseText);
    }
    // Add other command handlers here if needed.
}

/**
 * Formats and sends a daily attendance notification to the admin via Telegram.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyParentOnAttendance(record: SerializableAttendanceRecord) {
    const config = await getTelegramConfig();
    if (!config || !config.botToken || !config.chatId) return;

    const status = record.status;
    const isClockOut = !!record.timestampPulang;

    // Check if notification for this status is enabled
    if (status === 'Hadir' && !isClockOut && !config.notifHadir) return;
    if (status === 'Terlambat' && !isClockOut && !config.notifTerlambat) return;
    if (isClockOut && !config.notifHadir) return; // Assume clock-out notif follows "hadir" setting
    if (['Sakit', 'Izin', 'Alfa', 'Dispen'].includes(status) && !config.notifAbsen) return;
    
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
        "🏫 *SMAS PGRI Naringgul*",
        `*${title}*`,
        "",
        `👤 *Nama*      : ${record.studentName}`,
        `🆔 *NISN*      : ${record.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        `⏰ *Jam*       : ${format(timestamp, "HH:mm:ss")}`,
        `👋 *Status*    : *${finalStatus}*`
    ];
    
    const message = messageLines.join("\n");
    await sendTelegramMessage(config.botToken, config.chatId, message);
}

/**
 * Sends a monthly recap notification to the admin via Telegram.
 * @param studentData The student's full summary data for the month.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function sendMonthlyRecapToParent(
    studentData: MonthlySummaryData,
    month: number,
    year: number
) {
    const config = await getTelegramConfig();
    if (!config || !config.botToken || !config.chatId) return;

    const student = studentData.studentInfo;
    const summary = studentData.summary;

    const classSnap = await getDoc(doc(db, "classes", student.classId));
    const classInfo = classSnap.data() as Class;

    const totalSchoolDays = Object.values(summary).reduce((a, b) => a + b, 0);
    const totalHadir = summary.H + summary.T; // Hadir + Terlambat

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*Laporan Bulanan: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}*`,
        "",
        "Laporan untuk:",
        `👤 *Nama*      : ${student.nama}`,
        `🆔 *NISN*      : ${student.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        "",
        "Berikut adalah rekapitulasi kehadiran:",
        `✅ *Total Hadir*      : ${totalHadir} hari`,
        `⏰ *Terlambat*      : ${summary.T} kali`,
        `🤒 *Sakit*         : ${summary.S} hari`,
        `✉️ *Izin*          : ${summary.I} hari`,
        `✈️ *Dispen*        : ${summary.D} hari`,
        `❌ *Alfa*           : ${summary.A} hari`,
        "",
        `Dari total ${totalSchoolDays} hari sekolah efektif pada bulan ini.`,
    ];

    await sendTelegramMessage(config.botToken, config.chatId, messageLines.join("\n"));
}

/**
 * Sends a monthly recap for a class to the designated advisors' group chat via Telegram.
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
    const config = await getTelegramConfig();
    if (!config || !config.botToken || !config.groupChatId) return;

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
        "🏫 *Laporan Bulanan untuk Wali Kelas*",
        `*Kelas:* ${className} (${grade})`,
        `*Periode:* ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}`,
        "",
        `Berikut adalah rekapitulasi absensi kolektif untuk ${totalStudents} siswa di kelas Anda:`,
        "",
        "📈 *STATISTIK KELAS:*",
        `Total Kehadiran (Hadir+Terlambat): ${totalKehadiran}`,
        `Total Terlambat: ${totalLate}`,
        `Total Sakit: ${totalSick}`,
        `Total Izin: ${totalPermission}`,
        `Total Dispensasi: ${totalDispen}`,
        `Total Tanpa Keterangan (Alfa): ${totalAlfa}`,
    ];

    await sendTelegramMessage(config.botToken, config.groupChatId, messageLines.join("\n"));
}

/**
 * Runs the automated process to send monthly recap reports to the admin and class advisors.
 * This function is designed to be triggered by a cron job.
 */
export async function runMonthlyRecapAutomation() {
    console.log("Starting monthly recap automation process...");
    
    const today = new Date();
    const previousMonthDate = subMonths(today, 1);
    const targetMonth = getMonth(previousMonthDate);
    const targetYear = getYear(previousMonthDate);
    
    console.log(`Targeting report for: ${format(previousMonthDate, "MMMM yyyy")}`);

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

    // Send to admin
    console.log(`Sending recaps to admin...`);
    for (const studentData of Object.values(summary)) {
        await sendMonthlyRecapToParent(studentData, targetMonth, targetYear);
        await new Promise(resolve => setTimeout(resolve, 500)); // Delay to avoid rate limiting
    }
    console.log("Finished sending recaps to admin.");

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
            await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid rate limiting
        }
    }
    console.log("Finished sending recaps to advisors.");
    console.log("Monthly recap automation process completed.");
}

// --- Webhook Management Functions ---

/**
 * Sets up the Telegram webhook to point to our Vercel endpoint.
 */
async function setTelegramWebhook(): Promise<{ success: boolean; message: string }> {
    const config = await getTelegramConfig();
    if (!config || !config.botToken) {
        return { success: false, message: "Bot Token belum diatur." };
    }

    const vercelUrl = process.env.VERCEL_URL;
    if (!vercelUrl) {
        return { success: false, message: "URL Vercel tidak ditemukan. Pastikan variabel VERCEL_URL sudah diatur." };
    }
    const webhookUrl = `https://${vercelUrl}/api/telegram/webhook`;
    const tgUrl = `https://api.telegram.org/bot${config.botToken}/setWebhook?url=${webhookUrl}`;

    try {
        const response = await fetch(tgUrl);
        const data = await response.json();
        if (data.ok) {
            return { success: true, message: `Webhook berhasil diatur ke: ${webhookUrl}` };
        } else {
            return { success: false, message: `Gagal mengatur webhook: ${data.description}` };
        }
    } catch (error) {
        return { success: false, message: "Gagal terhubung ke API Telegram." };
    }
}

/**
 * Deletes the currently set Telegram webhook.
 */
export async function deleteTelegramWebhook(): Promise<{ success: boolean; message: string }> {
    const config = await getTelegramConfig();
    if (!config || !config.botToken) {
        return { success: false, message: "Bot Token belum diatur." };
    }

    const tgUrl = `https://api.telegram.org/bot${config.botToken}/deleteWebhook`;
    try {
        const response = await fetch(tgUrl);
        const data = await response.json();
        if (data.ok) {
            return { success: true, message: "Webhook berhasil dihapus." };
        } else {
            return { success: false, message: `Gagal menghapus webhook: ${data.description}` };
        }
    } catch (error) {
        return { success: false, message: "Gagal terhubung ke API Telegram." };
    }
}


/**
 * Fetches new messages from Telegram manually. This is an alternative to using webhooks.
 */
export async function syncTelegramMessages(): Promise<{ success: boolean; message: string }> {
    const config = await getTelegramConfig();
    if (!config || !config.botToken) {
        return { success: false, message: "Bot Token belum diatur." };
    }

    const lastUpdateIdDocRef = doc(db, "settings", "telegramState");
    const lastUpdateIdSnap = await getDoc(lastUpdateIdDocRef);
    const lastUpdateId = lastUpdateIdSnap.exists() ? lastUpdateIdSnap.data().lastUpdateId : 0;

    const tgUrl = `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${lastUpdateId + 1}&limit=100`;

    try {
        const response = await fetch(tgUrl);
        const data = await response.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                await processTelegramWebhook({ message: update.message });
            }
            const newLastUpdateId = data.result[data.result.length - 1].update_id;
            await setDoc(lastUpdateIdDocRef, { lastUpdateId: newLastUpdateId });

            return { success: true, message: `${data.result.length} pesan baru berhasil disinkronkan.` };
        } else if (data.ok) {
            return { success: true, message: "Tidak ada pesan baru." };
        } else {
            return { success: false, message: `Gagal mengambil pembaruan: ${data.description}` };
        }
    } catch (error) {
        return { success: false, message: "Gagal terhubung ke API Telegram." };
    }
}
