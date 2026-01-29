
'use server';

/**
 * @fileOverview Handles queuing notifications to Firestore for WhatsApp group delivery.
 * - notifyOnAttendance: Queues a real-time attendance notification to a class group.
 * - retryAllFailedJobs: Retries all failed notification jobs at once.
 * - deleteAllPendingAndProcessingJobs: Deletes all pending and processing jobs.
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

const footerVariations = [
    "_Pesan ini dikirim oleh sistem dan tidak untuk dibalas._",
    "_Ini adalah pesan otomatis, mohon tidak membalas pesan ini._",
    "_Mohon simpan nomor ini untuk menerima informasi selanjutnya._"
];

// Internal helper to queue a notification
async function queueNotification(groupName: string, message: string, type: 'attendance' | 'recap', metadata: Record<string, any>): Promise<void> {
    if (!groupName) {
        const errorMsg = "Nama grup WhatsApp tidak ditemukan untuk kelas ini. Notifikasi dilewati.";
        console.warn(errorMsg, metadata);
        return; // No group name, so no notification.
    }
    
    const randomFooter = footerVariations[Math.floor(Math.random() * footerVariations.length)];
    const finalMessage = `${message}\n\n--------------------------------\n${randomFooter}`;

    const jobPayload = {
        // We reuse the 'recipient' field for the group name.
        payload: { recipient: groupName, message: finalMessage },
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
 * Queues a real-time attendance notification to a class's WhatsApp group.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const classSnap = await getDoc(doc(db, "classes", record.classId));
    if (!classSnap.exists()) {
        console.error(`Class with ID ${record.classId} not found for notification.`);
        return;
    }
    const classInfo = classSnap.data() as Class;
    
    // If the class has no group name configured, skip notification.
    if (!classInfo.whatsappGroupName) {
        console.log(`No WhatsApp group name for class ${classInfo.name}, skipping notification.`);
        return;
    }

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
        // Make status more descriptive
        if (record.status === 'Hadir') {
            finalStatus = 'Masuk Tepat Waktu';
        } else {
            finalStatus = record.status; // e.g., "Terlambat"
        }
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
    // The timestampStr is an ISO string (UTC) from the client
    const date = new Date(timestampStr);
    
    // Use formatInTimeZone to guarantee the conversion to WIB
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
    
    await queueNotification(classInfo.whatsappGroupName, message, 'attendance', { 
        studentName: record.studentName, 
        nisn: record.nisn, 
        studentId: record.studentId,
        className: classInfo.name,
    });
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
