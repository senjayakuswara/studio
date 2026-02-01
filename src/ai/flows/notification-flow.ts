
'use server';

/**
 * @fileOverview Handles queuing notifications to Firestore for WhatsApp delivery.
 * - notifyOnAttendance: Queues a real-time attendance notification to a parent.
 * - retryAllFailedJobs: Retries all failed notification jobs at once.
 * - deleteAllPendingAndProcessingJobs: Deletes all pending and processing jobs.
 * - queueMonthlyRecapToParent: Queues a monthly recap message to a parent.
 */

import { doc, getDoc, addDoc, collection, Timestamp, query, where, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatInTimeZone } from "date-fns-tz";
import { id as localeID } from "date-fns/locale";

// Types
type Class = { 
    id: string; 
    name: string; 
    grade: string;
    whatsappGroupName?: string; 
};

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

type MonthlySummaryData = {
    studentInfo: { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; },
    attendance: { [day: number]: string },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}

const footerVariations = [
    "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas._",
    "_Ini adalah pesan otomatis, mohon tidak membalas pesan ini._",
    "_Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
];

// Internal helper to queue a notification
async function queueNotification(recipient: string, message: string, type: 'attendance' | 'recap', metadata: Record<string, any>): Promise<void> {
    if (!recipient) {
        const errorMsg = "Nomor tujuan WhatsApp tidak ditemukan. Notifikasi dilewati.";
        console.warn(errorMsg, metadata);
        return; // No recipient, so no notification.
    }
    
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
    } catch (e: any) {
        console.error("CRITICAL: Failed to queue notification to Firestore", e);
        throw new Error("Gagal menambahkan notifikasi ke dalam antrean database.");
    }
}


/**
 * Queues a real-time attendance notification to a parent's WhatsApp.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const waNumber = record.parentWaNumber;
    if (!waNumber) {
        console.log(`No WhatsApp number for student ${record.studentName}, skipping parent notification.`);
        return;
    }
    
    const classSnap = await getDoc(doc(db, "classes", record.classId));
    if (!classSnap.exists()) {
        console.error(`Class with ID ${record.classId} not found for notification.`);
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
        // This case is for manual entries like Sakit/Izin/Alfa
        timestampStr = record.recordDate; 
        title = `Informasi Absensi`;
        finalStatus = record.status;
    }

    if (!timestampStr) {
        console.error("Could not determine timestamp for notification.", record);
        return;
    }

    const timeZone = "Asia/Jakarta";
    const date = new Date(timestampStr);
    
    const formattedDate = formatInTimeZone(date, timeZone, "eeee, dd MMMM yyyy", { locale: localeID });
    const formattedTime = formatInTimeZone(date, timeZone, "HH:mm:ss");

    const messageLines = [
        "🏫 *E-Absensi SMAS PGRI Naringgul*",
        `*${title}: ${formattedDate}*`,
        "====================",
        `👤 *Nama*: ${record.studentName}`,
        `🆔 *NISN*: ${record.nisn}`,
        `📚 *Kelas*: ${classInfo.name}`,
        `⏰ *Jam*: ${formattedTime} WIB`,
        `✨ *Status*: *${finalStatus}*`,
    ];
    
    const message = messageLines.join("\n");
    
    await queueNotification(waNumber, message, 'attendance', { 
        studentName: record.studentName, 
        nisn: record.nisn, 
        studentId: record.studentId,
        className: classInfo.name,
    });
}

/**
 * Queues a monthly attendance recap to a parent.
 * @param studentData The student's monthly summary data.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 * @param googleDriveLink The public link to the Google Drive folder.
 */
export async function queueMonthlyRecapToParent(studentData: MonthlySummaryData, month: number, year: number, googleDriveLink: string): Promise<void> {
    const waNumber = studentData.studentInfo.parentWaNumber;
    if (!waNumber) {
        // This is handled in the calling function, but as a safeguard.
        return;
    }

    const { summary, studentInfo } = studentData;
    const totalHadir = summary.H + summary.T;
    const monthName = formatInTimeZone(new Date(year, month), "Asia/Jakarta", "MMMM yyyy", { locale: localeID });

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*Laporan Rekap Absensi: ${monthName}*`,
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
        "Untuk melihat atau mengunduh laporan PDF lengkap, silakan kunjungi tautan berikut:",
        googleDriveLink,
    ];

    const message = messageLines.join('\n');
    await queueNotification(waNumber, message, 'recap', { studentName: studentInfo.nama, month, year, studentId: studentInfo.id });
}


/**
 * Retries all failed notification jobs by resetting their status to 'pending'.
 */
export async function retryAllFailedJobs(): Promise<{ success: boolean, count: number, error?: string }> {
    try {
        const q = query(collection(db, "notification_queue"), where("status", "==", "failed"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: true, count: 0 };
        }

        const batch = writeBatch(db);
        snapshot.forEach(doc => {
            batch.update(doc.ref, {
                status: 'pending',
                updatedAt: Timestamp.now(),
                errorMessage: 'Retrying all failed jobs...',
            });
        });

        await batch.commit();
        return { success: true, count: snapshot.size };

    } catch (e: any) {
        console.error(`Failed to retry all failed jobs`, e);
        return { success: false, count: 0, error: e.message };
    }
}

/**
 * Deletes all pending and processing notification jobs from the queue.
 */
export async function deleteAllPendingAndProcessingJobs(): Promise<{ success: boolean, count: number, error?: string }> {
    try {
        const q = query(collection(db, "notification_queue"), where("status", "in", ["pending", "processing"]));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: true, count: 0 };
        }

        const batch = writeBatch(db);
        snapshot.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        return { success: true, count: snapshot.size };

    } catch (e: any) {
        console.error(`Failed to delete all pending/processing jobs`, e);
        return { success: false, count: 0, error: e.message };
    }
}
