'use server';
/**
 * @fileOverview Handles all Telegram bot interactions.
 * - processTelegramWebhook: Processes incoming messages from the Telegram webhook for user registration.
 * - notifyParentOnAttendance: Sends daily attendance notifications to parents.
 * - sendMonthlyRecapToParent: Sends a monthly recap to an individual parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for a class to the advisors' group.
 * - testTelegramConnection: Tests the validity of a bot token.
 */

import { collection, doc, getDoc, getDocs, query, updateDoc, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type TelegramSettings = {
  botToken: string;
  groupChatId?: string;
  notifHadir: boolean;
  notifTerlambat: boolean;
  notifAbsen: boolean;
};

type Class = { id: string; name: string; grade: string };
type Student = { id: string; nisn: string; nama: string; classId: string };
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

// New type for Server Action to avoid non-plain objects
type SerializableAttendanceRecord = {
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
    summary: { H: number, T: number, S: number, I: number, A: number, D: number }
};

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
                parse_mode: 'Markdown',
            }),
        });
        if (!response.ok) {
            const errorData = await response.json();
            console.error("Telegram API Error:", errorData.description);
        }
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
    }
}

/**
 * Processes incoming webhook requests from Telegram.
 * Handles user registration by matching NISN to a student.
 * @param payload The request body from the Telegram webhook.
 */
export async function processTelegramWebhook(payload: any) {
    const message = payload?.message;
    const chatId = message?.chat?.id;
    const text = message?.text?.trim();

    if (!chatId || !text) return;

    const config = await getTelegramConfig();
    if (!config?.botToken) {
        console.error("Telegram bot token is not configured.");
        return;
    }

    if (text === '/start') {
        const welcomeMessage = "Selamat datang di Notifikasi AbsensiKu Cerdas SMAS PGRI Naringgul. Untuk menghubungkan akun Anda dengan data absensi putra/i Anda, silakan masukkan Nomor Induk Siswa Nasional (NISN) anak Anda.";
        await sendTelegramMessage(config.botToken, String(chatId), welcomeMessage);
        return;
    }
    
    if (/^\d+$/.test(text)) {
        const nisn = text;
        try {
            const q = query(collection(db, "students"), where("nisn", "==", nisn));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                const notFoundMessage = `NISN ${nisn} tidak ditemukan. Mohon periksa kembali NISN putra/i Anda dan coba lagi.`;
                await sendTelegramMessage(config.botToken, String(chatId), notFoundMessage);
            } else {
                const studentDoc = querySnapshot.docs[0];
                await updateDoc(doc(db, "students", studentDoc.id), {
                    parentChatId: String(chatId)
                });
                const successMessage = `✅ Berhasil! Akun Telegram Anda telah terhubung dengan data absensi ananda *${studentDoc.data().nama}*. Anda akan menerima notifikasi absensi mulai sekarang.`;
                await sendTelegramMessage(config.botToken, String(chatId), successMessage);
            }
        } catch (error) {
            console.error("Error during NISN registration:", error);
            const errorMessage = "Terjadi kesalahan pada sistem. Mohon coba lagi nanti.";
            await sendTelegramMessage(config.botToken, String(chatId), errorMessage);
        }
    } else {
        const defaultReply = "Perintah tidak dikenali. Silakan masukkan NISN putra/i Anda untuk mendaftar notifikasi.";
        await sendTelegramMessage(config.botToken, String(chatId), defaultReply);
    }
}

/**
 * Formats and sends a daily attendance notification to a parent.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyParentOnAttendance(record: SerializableAttendanceRecord) {
    const config = await getTelegramConfig();
    if (!config?.botToken) return;

    const status = record.status;
    const isClockOut = !!record.timestampPulang;

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
    
    const now = new Date();
    let timestamp: Date;
    let title: string;
    const finalStatus = isClockOut ? 'Pulang' : record.status;

    // Special handling for manual statuses (Sakit, Izin, etc.)
    if (['Sakit', 'Izin', 'Alfa', 'Dispen'].includes(record.status)) {
        timestamp = now; // Use current time for manual status changes
        title = `Informasi Absensi: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (isClockOut && record.timestampPulang) {
        timestamp = new Date(record.timestampPulang);
        title = `Absensi Pulang: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (record.timestampMasuk) {
        timestamp = new Date(record.timestampMasuk);
        title = `Absensi Masuk: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else {
        // Fallback for unexpected cases
        timestamp = new Date(record.recordDate);
        title = `Informasi Absensi: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    }


    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*${title}*`,
        "",
        `👤 Nama      : ${record.studentName}`,
        `🆔 NIS       : ${record.nisn}`,
        `📚 Kelas     : ${classInfo.name}`,
        `⏰ Jam       : ${format(timestamp, "HH:mm:ss")}`,
        `👋 Status    : *${finalStatus}*`,
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas._"
    ];
    
    const message = messageLines.join("\n");
    await sendTelegramMessage(config.botToken, parentChatId, message);
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
    const config = await getTelegramConfig();
    if (!config?.botToken) return;

    const student = studentData.studentInfo;
    const summary = studentData.summary;

    const studentDocRef = doc(db, "students", student.id);
    const studentSnap = await getDoc(studentDocRef);
    const parentChatId = studentSnap.data()?.parentChatId;
    if (!parentChatId) return; // Skip if parent is not registered

    const classSnap = await getDoc(doc(db, "classes", student.classId));
    const classInfo = classSnap.data() as Class;

    const totalHadir = summary.H + summary.T;
    const totalSchoolDays = Object.values(summary).reduce((a, b) => a + b, 0);

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*Laporan Bulanan: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}*`,
        "",
        "Yth. Orang Tua/Wali dari:",
        `👤 Nama      : ${student.nama}`,
        `🆔 NIS       : ${student.nisn}`,
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
        "_Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas._"
    ];

    await sendTelegramMessage(config.botToken, parentChatId, messageLines.join("\n"));
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
    const config = await getTelegramConfig();
    if (!config?.botToken || !config.groupChatId) return;

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
        "🏫 *SMAS PGRI Naringgul*",
        `*Laporan Bulanan Untuk Wali Kelas*`,
        `*${className} (${grade}) - ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}*`,
        "",
        `Berikut adalah rekapitulasi absensi untuk kelas Anda dengan total *${totalStudents}* siswa:`,
        `✅ Total Hadir      : ${totalKehadiran} Kehadiran`,
        `⏰ Total Terlambat  : ${totalLate} Pelanggaran`,
        `🤒 Total Sakit      : ${totalSick} Hari`,
        `✉️ Total Izin       : ${totalPermission} Hari`,
        `✈️ Total Dispen     : ${totalDispen} Hari`,
        `❌ Total Alfa       : ${totalAlfa} Hari`,
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem._"
    ];

    await sendTelegramMessage(config.botToken, config.groupChatId, messageLines.join("\n"));
}


/**
 * Tests the connection to the Telegram API using the provided bot token.
 * @param botToken The Telegram bot token to test.
 * @returns An object indicating success or failure, with a message.
 */
export async function testTelegramConnection(botToken: string): Promise<{ success: boolean; message: string }> {
    if (!botToken) {
        return { success: false, message: "Token bot tidak boleh kosong." };
    }
    const url = `https://api.telegram.org/bot${botToken}/getMe`;
    try {
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok) {
            return { success: true, message: `Koneksi berhasil! Terhubung dengan bot: ${data.result.first_name} (@${data.result.username}).` };
        } else {
            return { success: false, message: `Gagal terhubung ke Telegram: ${data.description || 'Unknown error'}` };
        }
    } catch (error) {
        console.error("Failed to test Telegram connection:", error);
        return { success: false, message: "Gagal terhubung ke server Telegram. Periksa koneksi internet Anda." };
    }
}
