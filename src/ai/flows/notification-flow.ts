
'use server';
/**
 * @fileOverview Handles queuing notifications to Firestore.
 * - notifyOnAttendance: Queues a real-time attendance notification.
 * - queueMonthlyRecap: Queues a monthly recap for a student's parent.
 * - queueClassMonthlyRecap: Queues a monthly recap for an entire class to a group.
 */

import { doc, getDoc, addDoc, collection, updateDoc, deleteDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";

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
};

type WebhookPayload = {
    recipient: string;
    message: string;
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
    attendance: { [day: number]: string },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}

const footerVariations = [
    "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas._",
    "_Ini adalah pesan otomatis, mohon tidak membalas pesan ini._",
    "_Notifikasi otomatis dari sistem E-Absensi._",
    "_Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
];

// Internal helper to queue a notification
async function queueNotification(recipient: string, message: string, type: 'attendance' | 'recap', metadata: Record<string, any>): Promise<{ success: boolean, error?: string }> {
    if (!recipient) {
        const errorMsg = "Nomor tujuan tidak ditemukan.";
        console.warn(errorMsg, metadata);
        return { success: false, error: errorMsg };
    }
    
    // Select a random footer
    const randomFooter = footerVariations[Math.floor(Math.random() * footerVariations.length)];
    const finalMessage = `${message}\n\n--------------------------------\n${randomFooter}`;

    const jobPayload = {
        payload: { recipient, message: finalMessage },
        type,
        metadata,
        status: 'pending' as const,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        errorMessage: '',
    };

    try {
        await addDoc(collection(db, "notification_queue"), jobPayload);
        return { success: true };
    } catch (e: any) {
        console.error("CRITICAL: Failed to queue notification", e);
        return { success: false, error: e.message };
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
        return; // No number, so no notification.
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

    const wibDate = new Date(timestampStr); 
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
    ];
    
    const message = messageLines.join("\n");
    
    await queueNotification(studentWaNumber, message, 'attendance', { studentName: record.studentName, nisn: record.nisn, studentId: record.studentId });
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
            updatedAt: Timestamp.now(),
            errorMessage: 'Retrying...',
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
export async function deleteNotificationJob(jobId: string): Promise<void> {
    const jobRef = doc(db, "notification_queue", jobId);
    await deleteDoc(jobRef);
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
    ];

    const message = messageLines.join('\n');
    await queueNotification(waNumber, message, 'recap', { studentName: studentInfo.nama, month, year, studentId: studentInfo.id });
}
