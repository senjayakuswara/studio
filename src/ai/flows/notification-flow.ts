
'use server';
/**
 * @fileOverview Handles all student and parent notifications via an external webhook.
 * - notifyOnAttendance: Sends a real-time attendance notification.
 * - processSingleNotification: Processes a single job from the notification queue.
 * - deleteNotificationJob: Deletes a job from the notification queue.
 * - sendMonthlyRecapToParent: Sends a monthly recap to a student's parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for an entire class to a group.
 */

import { doc, getDoc, addDoc, collection, updateDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format, zonedTimeToUtc, utcToZonedTime } from "date-fns-tz";
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

type WebhookPayload = {
    recipient: string;
    message: string;
    isGroup: boolean;
}

export type NotificationJob = {
    id: string;
    payload: WebhookPayload;
    status: 'pending' | 'success' | 'failed';
    type: 'attendance' | 'recap';
    metadata: Record<string, any>;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    errorMessage?: string;
}

type MonthlySummaryData = {
    studentInfo: { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; },
    attendance: { [day: number]: string }, // 'H', 'S', 'I', 'A', 'T', 'D', 'L'
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}
type MonthlySummary = {
    [studentId: string]: MonthlySummaryData
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
            throw new Error(`Webhook error (${response.status}): ${errorText}`);
        } else {
             console.log("Successfully sent payload to webhook.");
             return { success: true };
        }
    } catch (error: any) {
        console.error("Failed to send to webhook:", error);
        // Throw an error with a user-friendly message
        throw new Error(error.message || 'Gagal terhubung ke webhook. Pastikan server lokal dan Ngrok berjalan, dan URL webhook sudah benar.');
    }
}

// Internal helper to queue a notification
async function queueNotification(payload: WebhookPayload, type: 'attendance' | 'recap', metadata: Record<string, any>) {
    try {
        await addDoc(collection(db, "notification_queue"), {
            payload,
            type,
            metadata,
            status: 'pending',
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        });
    } catch (e) {
        console.error("CRITICAL: Failed to queue notification", e);
    }
}


/**
 * Sends a real-time attendance notification. If sending fails, it queues the notification.
 * This function will now throw an error if the webhook is not configured or fails,
 * allowing the calling function to handle it (e.g., by rejecting the attendance scan).
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const studentWaNumber = record.parentWaNumber;
    if (!studentWaNumber) {
        console.log(`No WA number for ${record.studentName}, skipping notification.`);
        return; // No number, so no notification, but not an error.
    }

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
    
    const wibTimeZone = 'Asia/Jakarta';
    const dateInWib = utcToZonedTime(new Date(timestampStr), wibTimeZone);
    
    const formattedDate = format(dateInWib, "eeee, dd MMMM yyyy", { locale: localeID, timeZone: wibTimeZone });
    const formattedTime = format(dateInWib, "HH:mm:ss", { locale: localeID, timeZone: wibTimeZone });

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
    
    try {
        await sendToWebhook(webhookPayload);
    } catch (e: any) {
        console.error("Direct notification failed, queuing now.", e.message);
        await queueNotification(webhookPayload, 'attendance', { studentName: record.studentName, nisn: record.nisn });
        // Re-throw the error so the calling function knows it failed and can show the UI warning.
        throw e;
    }
}


/**
 * Processes a single notification job from the queue.
 * @param jobId The ID of the notification job in Firestore.
 */
export async function processSingleNotification(jobId: string): Promise<{ success: boolean; error?: string }> {
    const jobRef = doc(db, "notification_queue", jobId);
    try {
        const jobSnap = await getDoc(jobRef);
        if (!jobSnap.exists()) {
            throw new Error("Job not found.");
        }
        const job = jobSnap.data() as Omit<NotificationJob, 'id'>;

        await sendToWebhook(job.payload);

        await updateDoc(jobRef, {
            status: 'success',
            updatedAt: Timestamp.now(),
            errorMessage: '',
        });
        return { success: true };

    } catch (e: any) {
        await updateDoc(jobRef, {
            status: 'failed',
            updatedAt: Timestamp.now(),
            errorMessage: e.message || "An unknown error occurred.",
        }).catch(updateErr => console.error("Failed to even update the job to failed status:", updateErr));

        return { success: false, error: e.message };
    }
}

/**
 * Deletes a notification job from the queue.
 * @param jobId The ID of the notification job in Firestore.
 */
export async function deleteNotificationJob(jobId: string): Promise<void> {
    const jobRef = doc(db, "notification_queue", jobId);
    await deleteDoc(jobRef);
}

/**
 * Sends a monthly attendance recap to a parent.
 * @param studentData The student's monthly summary data.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function sendMonthlyRecapToParent(studentData: MonthlySummaryData, month: number, year: number): Promise<void> {
    const waNumber = studentData.studentInfo.parentWaNumber;
    if (!waNumber) {
        console.log(`No WA number for ${studentData.studentInfo.nama}, skipping parent recap.`);
        return;
    }

    const { summary, studentInfo } = studentData;
    const totalHadir = summary.H + summary.T;
    const monthName = format(new Date(year, month), "MMMM yyyy", { locale: localeID });

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*Rekap Absensi Bulanan: ${monthName}*`,
        "--------------------------------",
        `*Nama Siswa*: ${studentInfo.nama}`,
        `*NISN*: ${studentInfo.nisn}`,
        "",
        "*Rincian Kehadiran:*",
        `  - Hadir       : ${totalHadir} hari`,
        `  - Terlambat   : ${summary.T} hari`,
        `  - Sakit       : ${summary.S} hari`,
        `  - Izin        : ${summary.I} hari`,
        `  - Tanpa Keterangan (Alfa) : ${summary.A} hari`,
        `  - Dispensasi  : ${summary.D} hari`,
        "",
        "_Pesan ini adalah rekapitulasi otomatis. Untuk informasi lebih lanjut, silakan hubungi pihak sekolah._"
    ];

    const message = messageLines.join('\n');
    const webhookPayload: WebhookPayload = { recipient: waNumber, message, isGroup: false };

    try {
        await sendToWebhook(webhookPayload);
    } catch (e: any) {
        console.warn(`Failed to send monthly recap for ${studentInfo.nama}, queuing.`, e.message);
        await queueNotification(webhookPayload, 'recap', { studentName: studentInfo.nama, month, year });
    }
}


/**
 * Sends a summary of a class's monthly attendance to a group.
 * @param className The name of the class.
 * @param grade The grade of the class.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 * @param summaryData The full summary data for all students in the report.
 */
export async function sendClassMonthlyRecap(className: string, grade: string, month: number, year: number, summaryData: MonthlySummary): Promise<void> {
    const config = await getAppConfig();
    const groupWaId = config?.groupWaId;

    if (!groupWaId) {
        console.log("Group WA ID not set, skipping class recap.");
        return;
    }

    const monthName = format(new Date(year, month), "MMMM yyyy", { locale: localeID });
    
    const studentsWithAbsences = Object.values(summaryData)
        .filter(s => s.summary.A > 0 || s.summary.S > 0 || s.summary.I > 0)
        .sort((a,b) => b.summary.A - a.summary.A);

    const messageLines = [
        "🏫 *Rekap Absensi Bulanan (Ringkas)*",
        `*Kelas*: ${className} (${grade})`,
        `*Periode*: ${monthName}`,
        "--------------------------------",
    ];

    if (studentsWithAbsences.length === 0) {
        messageLines.push("✅ Alhamdulillah, semua siswa di kelas ini hadir penuh selama sebulan terakhir. Terima kasih atas kerja samanya!");
    } else {
        messageLines.push("Berikut adalah siswa dengan catatan ketidakhadiran (Sakit, Izin, Alfa):");
        studentsWithAbsences.forEach(s => {
            const summaryParts: string[] = [];
            if (s.summary.S > 0) summaryParts.push(`${s.summary.S} S`);
            if (s.summary.I > 0) summaryParts.push(`${s.summary.I} I`);
            if (s.summary.A > 0) summaryParts.push(`${s.summary.A} A`);
            messageLines.push(`- *${s.studentInfo.nama}*: ${summaryParts.join(', ')}`);
        });
        messageLines.push("\n_S = Sakit, I = Izin, A = Alfa._")
    }
    
    messageLines.push("\n_Laporan ini dikirim untuk wali kelas. Mohon untuk menindaklanjuti siswa dengan jumlah Alfa yang signifikan._")
    
    const message = messageLines.join('\n');
    const webhookPayload: WebhookPayload = { recipient: groupWaId, message, isGroup: true };
    
    try {
        await sendToWebhook(webhookPayload);
    } catch (e: any) {
        console.warn(`Failed to send class monthly recap for ${className}, queuing.`, e.message);
        await queueNotification(webhookPayload, 'recap', { className, month, year });
    }
}

    