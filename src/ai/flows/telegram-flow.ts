'use server';
/**
 * @fileOverview Handles all Telegram bot interactions.
 * - processTelegramWebhook: Processes incoming messages from the Telegram webhook for user registration.
 * - notifyParentOnAttendance: Sends attendance notifications to parents.
 * - testTelegramConnection: Tests the validity of a bot token.
 */

import { collection, doc, getDoc, getDocs, query, updateDoc, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type TelegramSettings = {
  botToken: string;
  notifHadir: boolean;
  notifTerlambat: boolean;
  notifAbsen: boolean;
};

type Class = { id: string; name: string; grade: string };

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
                text: text,
                parse_mode: 'Markdown',
            }),
        });
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
 * Formats and sends an attendance notification to a parent.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyParentOnAttendance(record: AttendanceRecord) {
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

    let timestamp: Date;
    let title: string;
    const finalStatus = isClockOut ? 'Pulang' : record.status;

    if (isClockOut) {
        timestamp = record.timestampPulang!.toDate();
        title = `Absensi Pulang: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (record.timestampMasuk) {
        timestamp = record.timestampMasuk!.toDate();
        title = `Absensi Masuk: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else {
        timestamp = record.recordDate.toDate();
        title = `Informasi Absensi: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    }

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        title,
        "",
        `👤 *Nama*      : ${record.studentName}`,
        `🆔 *NISN*      : ${record.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        `⏰ *Jam*       : ${format(timestamp, "HH:mm:ss")}`,
        `👋 *Status*    : ${finalStatus}`,
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas._"
    ];
    
    const message = messageLines.join("\n");
    await sendTelegramMessage(config.botToken, parentChatId, message);
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
            // Error from Telegram API (e.g., invalid token)
            return { success: false, message: `Gagal terhubung ke Telegram: ${data.description}` };
        }
    } catch (error) {
        console.error("Failed to test Telegram connection:", error);
        return { success: false, message: "Gagal terhubung ke server Telegram. Periksa koneksi internet Anda." };
    }
}
