
'use server';
/**
 * @fileOverview Handles queuing notifications to Firestore.
 * - notifyOnAttendance: Queues a real-time attendance notification.
 * - retryNotificationJob: Retries a failed notification job.
 * - deleteNotificationJob: Deletes a job from the notification queue.
 * - queueMonthlyRecapToParent: Queues a monthly recap for a student's parent.
 */

import { doc, getDoc, addDoc, collection, updateDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { id as localeID } from "date-fns/locale";
import { formatInTimeZone } from "date-fns-tz";

// Types
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
  parentWaStatus?: 'valid' | 'invalid' | null;
};

// This type mirrors the structure in the Node.js server
export type NotificationJobPayload = {
    phone: string;
    message: string;
    status: 'pending' | 'processing' | 'sent' | 'failed';
    retryCount: number;
    createdAt: Timestamp;
    processedAt: Timestamp | null;
    lockedAt: Timestamp | null;
    error: string | null;
    type: 'attendance' | 'recap';
    metadata: Record<string, any>;
}

export type NotificationJob = NotificationJobPayload & {
    id: string;
}

type MonthlySummaryData = {
    studentInfo: { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; },
    attendance: { [day: number]: string },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}

const footerVariations = [
    "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas._",
    "_Ini adalah pesan otomatis, mohon tidak membalas pesan ini._",
    "_Notifikasi otomatis dari sistem E-Absensi._",
    "_Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
];

// Internal helper to queue a notification, now matching the new Firestore structure
async function queueNotification(recipient: string, message: string, type: 'attendance' | 'recap', metadata: Record<string, any>): Promise<void> {
    if (!recipient) {
        console.warn("Nomor tujuan tidak ditemukan. Melewati notifikasi.", metadata);
        return;
    }
    
    const randomFooter = footerVariations[Math.floor(Math.random() * footerVariations.length)];
    const finalMessage = `${message}\n\n--------------------------------\n${randomFooter}`;

    const jobPayload: Omit<NotificationJob, 'id'> = {
        phone: recipient,
        message: finalMessage,
        status: 'pending',
        retryCount: 0,
        createdAt: Timestamp.now(),
        processedAt: null,
        lockedAt: null,
        error: null,
        type,
        metadata,
    };

    try {
        await addDoc(collection(db, "notification_queue"), jobPayload);
    } catch (e: any) {
        console.error("CRITICAL: Failed to queue notification to Firestore", e);
        throw new Error("Gagal menambahkan notifikasi ke dalam antrean database.");
    }
}


/**
 * Queues a real-time attendance notification to Firestore.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const studentWaNumber = record.parentWaNumber;
    if (!studentWaNumber) {
        console.log(`No WA number for ${record.studentName}, skipping notification.`);
        return;
    }

    const classSnap = await getDoc(doc(db, "classes", record.classId));
    if (!classSnap.exists()) {
        console.error(`Class with ID ${record.classId} not found.`);
        return;
    }
    const classInfo = classSnap.data() as Class;
    
    let timestampStr: string | null = null;
    let title: string;
    let finalStatus: string;

    if (record.timestampPulang) {
        timestampStr = record.timestampPulang;
        title = `Absensi Pulang`;
        finalStatus = 'Pulang Sekolah';
    } else if (record.timestampMasuk) {
        timestampStr = record.timestampMasuk;
        title = `Absensi Masuk`;
        finalStatus = record.status;
    } else {
        timestampStr = record.recordDate; 
        title = `Informasi Absensi`;
        finalStatus = record.status;
    }

    if (!timestampStr) {
        console.error("Could not determine timestamp for notification.", record);
        return;
    }

    const wibDate = new Date(timestampStr); // This correctly parses the UTC ISO string
    const timeZone = "Asia/Jakarta"; // WIB timezone

    const formattedDate = formatInTimeZone(wibDate, timeZone, "eeee, dd MMMM yyyy", { locale: localeID });
    const formattedTime = formatInTimeZone(wibDate, timeZone, "HH:mm:ss", { locale: localeID });

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*${title}: ${formattedDate}*`,
        "",
        `👤 *Nama*      : ${record.studentName}`,
        `🆔 *NISN*      : ${record.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        `⏰ *Jam*       : ${formattedTime}`,
        `👋 *Status*    : *${finalStatus}*`,
    ];
    
    const message = messageLines.join("\n");
    
    await queueNotification(studentWaNumber, message, 'attendance', { studentId: record.studentId, studentName: record.studentName, nisn: record.nisn });
}

/**
 * Retries a failed notification job by resetting its status to 'pending'.
 * @param jobId The ID of the notification job in Firestore.
 */
export async function retryNotificationJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const jobRef = doc(db, "notification_queue", jobId);
        await updateDoc(jobRef, {
            status: 'pending',
            retryCount: 0, // Reset retry count for manual retry
            error: 'Retrying manually...',
        });
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to retry job ${jobId}`, e);
        return { success: false, error: e.message };
    }
}


/**
 * Deletes a notification job from the queue.
 * @param jobId The ID of the notification job in Firestore.
 */
export async function deleteNotificationJob(jobId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const jobRef = doc(db, "notification_queue", jobId);
        await deleteDoc(jobRef);
        return { success: true };
    } catch (e: any) {
        console.error(`Failed to delete job ${jobId}`, e);
        return { success: false, error: e.message };
    }
}

/**
 * Queues a monthly attendance recap to a parent.
 * @param studentData The student's monthly summary data.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function queueMonthlyRecapToParent(studentData: MonthlySummaryData, month: number, year: number): Promise<void> {
    const waNumber = studentData.studentInfo.parentWaNumber;
    if (!waNumber) {
        console.log(`No WA number for ${studentData.studentInfo.nama}, skipping parent recap.`);
        return;
    }

    const { summary, studentInfo } = studentData;
    const totalHadir = summary.H + summary.T;
    const monthName = formatInTimeZone(new Date(year, month), "Asia/Jakarta", "MMMM yyyy", { locale: localeID });

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
    ];

    const message = messageLines.join('\n');
    await queueNotification(waNumber, message, 'recap', { studentName: studentInfo.nama, month, year, studentId: studentInfo.id });
}
