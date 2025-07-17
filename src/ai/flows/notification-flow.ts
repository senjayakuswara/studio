'use server';
/**
 * @fileOverview Handles all student and parent notifications via an external webhook.
 * - notifyOnAttendance: Sends daily attendance notifications.
 * - sendMonthlyRecapToParent: Sends a monthly recap to an individual parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for a class to the advisors' group.
 */

import { collection, doc, getDoc, getDocs, query, where, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format } from "date-fns";
import { id as localeID } from "date-fns/locale";

// Types
type AppConfig = {
    appName?: string;
    logoUrl?: string;
    notificationWebhookUrl?: string;
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
type MonthlySummaryData = {
    studentInfo: { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; },
    summary: { H: number, T: number, S: number, I: number, A: number, D: number }
};

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
async function sendToWebhook(payload: object) {
    const config = await getAppConfig();
    const webhookUrl = config?.notificationWebhookUrl;
    
    if (!webhookUrl) {
        console.warn("Notification webhook URL is not set. Skipping notification.");
        return;
    }

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Webhook failed with status ${response.status}:`, errorText);
        } else {
             console.log("Successfully sent payload to webhook.");
        }
    } catch (error) {
        console.error("Failed to send to webhook:", error);
    }
}

/**
 * Formats and sends a daily attendance notification.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyOnAttendance(record: SerializableAttendanceRecord) {
    const studentWaNumber = record.parentWaNumber;
    if (!studentWaNumber) return;

    const classSnap = await getDoc(doc(db, "classes", record.classId));
    const classInfo = classSnap.data() as Class;
    
    let timestamp: Date;
    let title: string;
    const finalStatus = record.timestampPulang ? 'Pulang' : record.status;

    if (record.timestampPulang) {
        timestamp = new Date(record.timestampPulang);
        title = `Absensi Pulang: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (record.timestampMasuk) {
        timestamp = new Date(record.timestampMasuk);
        title = `Absensi Masuk: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else {
        timestamp = new Date(); 
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
    await sendToWebhook({ recipient: studentWaNumber, message });
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
    ];

    const message = messageLines.join("\n");
    await sendToWebhook({ recipient: studentWaNumber, message });
}

/**
 * Sends a monthly recap for a class to a predefined group.
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
    
    const message = messageLines.join("\n");
    // 'GROUP' is a special recipient keyword for the local server
    await sendToWebhook({ recipient: 'GROUP', message });
}
