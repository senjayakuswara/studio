
'use server';
/**
 * @fileOverview Handles all student and parent notifications via an external webhook.
 * - notifyOnAttendance: Creates a notification job in the queue.
 * - sendMonthlyRecapToParent: Creates a notification job for a monthly parent recap.
 * - sendClassMonthlyRecap: Creates a notification job for a monthly class recap.
 * - processNotificationQueue: Processes pending notifications from the queue.
 */

import { collection, doc, getDoc, getDocs, query, where, Timestamp, addDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type AppConfig = {
    appName?: string;
    logoUrl?: string;
    notificationWebhookUrl?: string;
    groupWaId?: string;
};
type Class = { id: string; name: string; grade: string };
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
  parentWaNumber?: string;
};
export type MonthlySummaryData = {
    studentInfo: { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number }
};

type WebhookPayload = {
    recipient: string;
    message: string;
    isGroup: boolean;
}

export type NotificationJob = {
    id: string;
    type: 'attendance' | 'monthly_recap_parent' | 'monthly_recap_class';
    payload: WebhookPayload;
    status: 'pending' | 'success' | 'failed';
    createdAt: Timestamp;
    lastAttemptAt: Timestamp | null;
    errorMessage?: string;
    metadata?: object;
}

// Internal helper to get app config from Firestore
async function getAppConfig(): Promise<AppConfig | null> {
    try {
        const docRef = doc(db, "settings", "appConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as AppConfig;
        }
        return null;
    } catch (error) {
        console.error("Error fetching App config:", error);
        return null;
    }
}

// Internal helper to send a payload to the external webhook
async function sendToWebhook(payload: WebhookPayload): Promise<{ success: true } | { success: false, error: string }> {
    const config = await getAppConfig();
    const webhookUrl = config?.notificationWebhookUrl;
    
    if (!webhookUrl) {
        const errorMsg = "Notification webhook URL is not set.";
        console.warn(errorMsg);
        return { success: false, error: errorMsg };
    }

    try {
        const response = await fetch(`${webhookUrl}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Webhook failed with status ${response.status}:`, errorText);
            return { success: false, error: `Webhook error (${response.status}): ${errorText}` };
        } else {
             console.log("Successfully sent payload to webhook.");
             return { success: true };
        }
    } catch (error: any) {
        console.error("Failed to send to webhook:", error);
        return { success: false, error: error.message || 'Failed to connect to webhook.' };
    }
}

async function addJobToQueue(type: NotificationJob['type'], payload: WebhookPayload, metadata?: object) {
    try {
        await addDoc(collection(db, "notification_queue"), {
            type,
            payload,
            metadata,
            status: 'pending',
            createdAt: Timestamp.now(),
            lastAttemptAt: null,
            errorMessage: null,
        });
    } catch (error) {
        console.error("Failed to add job to notification queue:", error);
    }
}

/**
 * Creates a job in the notification queue for a daily attendance event.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const studentWaNumber = record.parentWaNumber;
    if (!studentWaNumber) return;

    const classSnap = await getDoc(doc(db, "classes", record.classId));
    const classInfo = classSnap.data() as Class;
    
    let timestampStr: string | null = null;
    let title: string;
    let finalStatus: string;

    if (record.timestampPulang) {
        timestampStr = record.timestampPulang;
        title = `Absensi Pulang`;
        finalStatus = 'Pulang';
    } else if (record.timestampMasuk) {
        timestampStr = record.timestampMasuk;
        title = `Absensi Masuk`;
        if(record.status === 'Hadir') {
            finalStatus = 'Hadir (Tepat Waktu)';
        } else if (record.status === 'Terlambat') {
            finalStatus = 'Hadir (Terlambat)';
        } else {
            finalStatus = record.status;
        }
    } else {
        timestampStr = record.recordDate; 
        title = `Informasi Absensi`;
        finalStatus = record.status;
    }

    // Create a date object from the ISO string (which is in UTC)
    const utcDate = new Date(timestampStr);

    // Manually add 7 hours for WIB (GMT+7)
    const wibDate = new Date(utcDate.getTime() + (7 * 60 * 60 * 1000));
    
    // Format the corrected WIB date
    const formattedDate = format(wibDate, "eeee, dd MMMM yyyy", { locale: localeID });
    const formattedTime = format(wibDate, "HH:mm:ss", { locale: localeID });

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*${title}: ${formattedDate}*`,
        "",
        `👤 *Nama*      : ${record.studentName}`,
        `🆔 *NISN*      : ${record.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        `⏰ *Jam*       : ${formattedTime}`,
        `👋 *Status*    : *${finalStatus}*`,
        "",
        "--------------------------------",
        "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas. Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
    ];
    
    const message = messageLines.join("\n");
    const webhookPayload: WebhookPayload = { recipient: studentWaNumber, message, isGroup: false };
    
    await addJobToQueue('attendance', webhookPayload, { studentName: record.studentName });
}

/**
 * Creates a job in the notification queue to send a monthly recap to a parent.
 * @param studentData The student's full summary data for the month.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function sendMonthlyRecapToParent(
    studentData: MonthlySummaryData,
    month: number,
    year: number
) {
    const studentWaNumber = studentData.studentInfo.parentWaNumber;
    if (!studentWaNumber) return;

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
        "",
        "--------------------------------",
        "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas. Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
    ];

    const message = messageLines.join("\n");
    const webhookPayload: WebhookPayload = { recipient: studentWaNumber, message, isGroup: false };

    await addJobToQueue('monthly_recap_parent', webhookPayload, { studentName: student.nama });
}

/**
 * Creates a job in the notification queue to send a monthly class recap.
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
    const config = await getAppConfig();
    const groupWaId = config?.groupWaId;

    if (!groupWaId) {
        console.warn("Group WhatsApp ID is not set. Skipping class recap notification.");
        return;
    }

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
        `*Target:* ${className} (${grade})`,
        `*Periode:* ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}`,
        "",
        `Berikut adalah rekapitulasi absensi kolektif untuk ${totalStudents} siswa:`,
        "",
        "📈 *STATISTIK KELAS:*",
        `Total Kehadiran (Hadir+Terlambat): ${totalKehadiran}`,
        `Total Terlambat: ${totalLate}`,
        `Total Sakit: ${totalSick}`,
        `Total Izin: ${totalPermission}`,
        `Total Dispensasi: ${totalDispen}`,
        `Total Tanpa Keterangan (Alfa): ${totalAlfa}`,
    ];
    
    const message = messageLines.join("\n");
    const webhookPayload: WebhookPayload = { recipient: groupWaId, message, isGroup: true };
    
    await addJobToQueue('monthly_recap_class', webhookPayload, { className, grade });
}

/**
 * Processes a single notification job from the queue.
 */
export async function processSingleNotification(jobId: string): Promise<{ success: boolean }> {
    try {
        const jobRef = doc(db, "notification_queue", jobId);
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists()) {
            console.error(`Job with ID ${jobId} not found.`);
            return { success: false };
        }
        const job = jobSnap.data() as Omit<NotificationJob, 'id'>;

        await updateDoc(jobRef, { lastAttemptAt: Timestamp.now() });
        const result = await sendToWebhook(job.payload);

        if (result.success) {
            await updateDoc(jobRef, { status: 'success', errorMessage: null });
        } else {
            await updateDoc(jobRef, { status: 'failed', errorMessage: result.error });
        }
        return { success: result.success };
    } catch (error: any) {
        console.error(`Error processing job ${jobId}:`, error);
        await updateDoc(doc(db, "notification_queue", jobId), { status: 'failed', errorMessage: error.message });
        return { success: false };
    }
}

/**
 * Deletes a notification job from the queue.
 */
export async function deleteNotificationJob(jobId: string): Promise<void> {
    await deleteDoc(doc(db, "notification_queue", jobId));
}
