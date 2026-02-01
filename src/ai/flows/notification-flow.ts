
'use server';

/**
 * @fileOverview Handles queuing notifications to Firestore for WhatsApp delivery.
 * - notifyOnAttendance: Queues a real-time attendance notification to a class WhatsApp group.
 * - retryAllFailedJobs: Retries all failed notification jobs at once.
 * - deleteAllPendingAndProcessingJobs: Deletes all pending and processing jobs.
 * - queueDetailedClassRecapNotification: Queues a detailed monthly recap message to a class group.
 */

import { doc, getDoc, addDoc, collection, Timestamp, query, where, getDocs, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatInTimeZone } from "date-fns-tz";
import { id as localeID } from "date-fns/locale";
import { differenceInMinutes, startOfDay, setHours, setMinutes, setSeconds } from "date-fns";
import type { MonthlySummary } from "@/app/dashboard/rekapitulasi/page";

// Types
type Class = { 
    id: string; 
    name: string; 
    grade: string;
    whatsappGroupName?: string; 
    waliKelas?: string;
};
type Student = { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; }


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

const GOOGLE_DRIVE_LINK_GURU = "https://drive.google.com/drive/folders/1VxZT3XF4pWfrWXtzYCQL8GHUT5u2tvci?usp=drive_link";
const GOOGLE_DRIVE_LINK_SISWA = "https://drive.google.com/drive/folders/1zMSiJZvcNz1E8isgS-ZOT2F9CN8ehJta?usp=drive_link";


// Internal helper to queue a notification
async function queueNotification(recipient: string, message: string, type: 'attendance' | 'recap', metadata: Record<string, any>): Promise<void> {
    if (!recipient) {
        const errorMsg = "Nomor tujuan WhatsApp tidak ditemukan. Notifikasi dilewati.";
        console.warn(errorMsg, metadata);
        return; // No recipient, so no notification.
    }
    
    // The footer for recaps is now built inside queueDetailedClassRecapNotification.
    // The footer for attendance is added here.
    const finalMessage = type === 'recap' ? message : `${message}\n\n--------------------------------\n${footerVariations[Math.floor(Math.random() * footerVariations.length)]}`;

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
 * Queues a real-time attendance notification to a class WhatsApp group.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const classSnap = await getDoc(doc(db, "classes", record.classId));
    if (!classSnap.exists()) {
        console.error(`Class with ID ${record.classId} not found for notification.`);
        return;
    }
    const classInfo = classSnap.data() as Class;
    
    const recipient = classInfo.whatsappGroupName;
    if (!recipient) {
        console.log(`WhatsApp group for class "${classInfo.name}" not set, skipping notification.`);
        return;
    }
    
    let timestampStr: string | null = null;
    let title: string;
    let finalStatus: string;
    const timeZone = "Asia/Jakarta";

    if (record.timestampPulang) {
        timestampStr = record.timestampPulang;
        title = `Absensi Pulang`;
        finalStatus = 'Pulang Sekolah';
    } else if (record.timestampMasuk) {
        timestampStr = record.timestampMasuk;
        title = `Absensi Masuk`;

        const schoolHoursSnap = await getDoc(doc(db, "settings", "schoolHours"));
        if (schoolHoursSnap.exists()) {
            const schoolHours = schoolHoursSnap.data() as { jamMasuk: string; toleransi: string; };
            const checkinTime = new Date(record.timestampMasuk);
            const recordDate = startOfDay(checkinTime);

            const [hours, minutes] = schoolHours.jamMasuk.split(':').map(Number);
            const deadlineTime = setSeconds(setMinutes(setHours(recordDate, hours), minutes + parseInt(schoolHours.toleransi)), 0);

            if (checkinTime <= deadlineTime) {
                finalStatus = "Hadir (Tepat Waktu)";
            } else {
                const minutesLate = differenceInMinutes(checkinTime, deadlineTime);
                finalStatus = `Terlambat (${minutesLate} menit)`;
            }
        } else {
            // Fallback to the original status if schoolHours aren't set
            finalStatus = record.status;
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
    
    await queueNotification(recipient, message, 'attendance', { 
        studentName: record.studentName, 
        nisn: record.nisn, 
        studentId: record.studentId,
        className: classInfo.name,
    });
}

type DetailedRecapParams = {
    classInfo: Class;
    month: number;
    year: number;
    summaryData: MonthlySummary;
    students: Student[];
    schoolDays: number;
}

/**
 * Queues a detailed monthly attendance recap to a class WhatsApp group.
 * @param params The parameters for generating the detailed recap.
 */
export async function queueDetailedClassRecapNotification(params: DetailedRecapParams): Promise<void> {
    const { classInfo, month, year, summaryData, students, schoolDays } = params;

    if (!classInfo.whatsappGroupName) {
        throw new Error("Nama grup WhatsApp tidak ditemukan untuk kelas ini.");
    }

    const monthName = formatInTimeZone(new Date(year, month), "Asia/Jakarta", "MMMM yyyy", { locale: localeID });

    // --- Calculate Class-wide Stats ---
    let totalHadir = 0, totalAlfa = 0, totalSakit = 0, totalIzin = 0, totalDispen = 0;
    
    students.forEach(student => {
        const studentSummary = summaryData[student.id]?.summary;
        if (studentSummary) {
            totalHadir += studentSummary.H + studentSummary.T;
            totalAlfa += studentSummary.A;
            totalSakit += studentSummary.S;
            totalIzin += studentSummary.I;
            totalDispen += studentSummary.D;
        }
    });

    const totalPossibleAttendance = students.length * schoolDays;
    const averageKehadiran = totalPossibleAttendance > 0 ? ((totalHadir / totalPossibleAttendance) * 100).toFixed(1) : "0.0";
    
    // --- Build Student List ---
    const studentListString = students.map((student, index) => {
        const s = summaryData[student.id]?.summary;
        if (!s) return "";
        const hadir = s.H + s.T;
        return `${index + 1}. ${student.nama}\n   ✅ H: ${hadir} | ❌ A: ${s.A} | 🤒 S: ${s.S} | 📝 I: ${s.I} | 🏃 D: ${s.D}`;
    }).join('\n\n');
    
    const linkSection = classInfo.grade === 'Staf'
        ? `*Akses Laporan Guru:*\n${GOOGLE_DRIVE_LINK_GURU}`
        : `*Akses Laporan Siswa:*\n${GOOGLE_DRIVE_LINK_SISWA}`;

    // --- Assemble Final Message ---
    const messageLines = [
        "📊 *REKAP ABSENSI BULANAN KELAS*",
        "🏫 SMAS PGRI NARINGGUL",
        "━━━━━━━━━━━━━━━━━━",
        `🏷️ *Kelas*: ${classInfo.name}`,
        `📅 *Bulan*: ${monthName}`,
        `👩‍🏫 *Wali Kelas*: ${classInfo.waliKelas || '-'}`,
        "━━━━━━━━━━━━━━━━━━",
        "📌 *Ringkasan Akumulatif Kelas*",
        `Total entri dari ${students.length} siswa selama ${schoolDays} hari sekolah efektif.`,
        "",
        `✅ Total Hadir: ${totalHadir} entri`,
        `❌ Total Alpha: ${totalAlfa} entri`,
        `🤒 Total Sakit: ${totalSakit} entri`,
        `📝 Total Izin: ${totalIzin} entri`,
        `🏃 Total Dispen: ${totalDispen} entri`,
        `📊 Rata-rata Kehadiran: ${averageKehadiran}%`,
        "━━━━━━━━━━━━━━━━━━",
        "📋 *Daftar Siswa (Ringkas)*",
        studentListString,
        "━━━━━━━━━━━━━━━━━━",
        "🔗 *Tautan Unduh Laporan Lengkap*",
        linkSection,
        "━━━━━━━━━━━━━━━━━━",
        "🙏 Terima kasih atas kerja sama Bapak/Ibu.",
        "📍 SMAS PGRI NARINGGUL"
    ];

    const message = messageLines.join('\n');
    await queueNotification(classInfo.whatsappGroupName, message, 'recap', { className: classInfo.name, month, year, targetGrade: classInfo.grade });
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
