'use server';
/**
 * @fileOverview Handles all student and parent notifications.
 * This file is now responsible for sending notifications via WhatsApp.
 * - processWhatsappRegistration: Handles new user registrations via WhatsApp. (Placeholder for future)
 * - notifyParentOnAttendance: Sends daily attendance notifications to parents.
 * - sendMonthlyRecapToParent: Sends a monthly recap to an individual parent.
 * - sendClassMonthlyRecap: Sends a monthly recap for a class to the advisors' group.
 * - runMonthlyRecapAutomation: Runs the entire monthly recap process automatically for all classes.
 */

import { collection, doc, getDoc, getDocs, query, updateDoc, where, Timestamp, setDoc, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { format, subMonths, startOfMonth, endOfMonth, getYear, getMonth, getDate, eachDayOfInterval, getDay, getDaysInMonth } from "date-fns";
import { id as localeID } from "date-fns/locale";
import { sendWhatsappMessage } from "@/services/whatsapp-service";

// Types
type WhatsappSettings = {
  groupChatId?: string;
  notifHadir: boolean;
  notifTerlambat: boolean;
  notifAbsen: boolean;
};

type Class = { id: string; name: string; grade: string };
type Student = { id: string; nisn: string; nama: string; classId: string, parentWaNumber?: string };
type Holiday = { id: string; name: string; startDate: Timestamp; endDate: Timestamp };
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
type AutomationAttendanceRecord = {
  studentId: string
  status: "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
  recordDate: Timestamp
}

// New type for Server Action to avoid non-plain objects
export type SerializableAttendanceRecord = {
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
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
};

type MonthlySummary = {
    [studentId: string]: MonthlySummaryData
}

// Internal helper to get WhatsApp config from Firestore
async function getWhatsappConfig(): Promise<WhatsappSettings | null> {
    try {
        // We reuse the telegramConfig doc for whatsapp settings to avoid migration
        const docRef = doc(db, "settings", "telegramConfig");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as WhatsappSettings;
        }
        return null;
    } catch (error) {
        console.error("Error fetching Whatsapp config:", error);
        return null;
    }
}

/**
 * Placeholder for future WhatsApp registration logic.
 * Currently, parent WA numbers must be added manually in the student management page.
 */
export async function processWhatsappRegistration(payload: any) {
    console.log("Received WhatsApp payload:", payload);
    // This is where you would handle incoming messages from parents,
    // for example, a "DAFTAR <NISN>" message to link their number.
    // For now, we do nothing.
    return;
}

/**
 * Formats and sends a daily attendance notification to a parent via WhatsApp.
 * @param record The attendance record that triggered the notification.
 */
export async function notifyParentOnAttendance(record: SerializableAttendanceRecord) {
    const config = await getWhatsappConfig();
    if (!config) return;

    const status = record.status;
    const isClockOut = !!record.timestampPulang;

    // Check if notification for this status is enabled
    if (status === 'Hadir' && !isClockOut && !config.notifHadir) return;
    if (status === 'Terlambat' && !isClockOut && !config.notifTerlambat) return;
    if (isClockOut && !config.notifHadir) return; // Assume clock-out notif follows "hadir" setting
    if (['Sakit', 'Izin', 'Alfa', 'Dispen'].includes(status) && !config.notifAbsen) return;
    
    const studentDocRef = doc(db, "students", record.studentId);
    const studentSnap = await getDoc(studentDocRef);
    const studentData = studentSnap.data() as Student;
    const parentWaNumber = studentData?.parentWaNumber;

    if (!parentWaNumber) {
        console.log(`No WhatsApp number for parent of ${record.studentName}. Skipping notification.`);
        return;
    }

    const classSnap = await getDoc(doc(db, "classes", record.classId));
    const classInfo = classSnap.data() as Class;
    
    let timestamp: Date;
    let title: string;
    const finalStatus = isClockOut ? 'Pulang' : record.status;

    if (isClockOut && record.timestampPulang) {
        timestamp = new Date(record.timestampPulang);
        title = `Absensi Pulang: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else if (!isClockOut && record.timestampMasuk) {
        timestamp = new Date(record.timestampMasuk);
        title = `Absensi Masuk: ${format(timestamp, "eeee, dd MMMM yyyy", { locale: localeID })}`;
    } else {
        timestamp = new Date(); // Use current time for manual status changes
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
        `👋 *Status*    : *${finalStatus}*`,
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas._"
    ];
    
    const message = messageLines.join("\n");
    await sendWhatsappMessage(parentWaNumber, message);
}

/**
 * Sends a monthly recap notification to a parent via WhatsApp.
 * @param studentData The student's full summary data for the month.
 * @param month The month of the recap (0-11).
 * @param year The year of the recap.
 */
export async function sendMonthlyRecapToParent(
    studentData: MonthlySummaryData,
    month: number,
    year: number
) {
    const student = studentData.studentInfo;
    const summary = studentData.summary;

    const studentDocRef = doc(db, "students", student.id);
    const studentSnap = await getDoc(studentDocRef);
    const parentWaNumber = (studentSnap.data() as Student)?.parentWaNumber;
    if (!parentWaNumber) return; // Skip if parent WA is not registered

    const classSnap = await getDoc(doc(db, "classes", student.classId));
    const classInfo = classSnap.data() as Class;

    const totalSchoolDays = Object.values(summary).reduce((a, b) => a + b, 0);
    const totalHadir = summary.H + summary.T; // Hadir + Terlambat

    const messageLines = [
        "🏫 *SMAS PGRI Naringgul*",
        `*Laporan Bulanan: ${format(new Date(year, month), "MMMM yyyy", { locale: localeID })}*`,
        "",
        "Yth. Orang Tua/Wali dari:",
        `👤 *Nama*      : ${student.nama}`,
        `🆔 *NISN*      : ${student.nisn}`,
        `📚 *Kelas*     : ${classInfo.name}`,
        "",
        "Berikut adalah rekapitulasi kehadiran putra/putri Anda:",
        `✅ *Total Hadir*      : ${totalHadir} hari`,
        `⏰ *Terlambat*      : ${summary.T} kali`,
        `🤒 *Sakit*         : ${summary.S} hari`,
        `✉️ *Izin*          : ${summary.I} hari`,
        `✈️ *Dispen*        : ${summary.D} hari`,
        `❌ *Alfa*           : ${summary.A} hari`,
        "",
        `Dari total ${totalSchoolDays} hari sekolah efektif pada bulan ini.`,
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem. Mohon tidak membalas._"
    ];

    await sendWhatsappMessage(parentWaNumber, messageLines.join("\n"));
}


/**
 * Sends a monthly recap for a class to the designated advisors' group chat via WhatsApp.
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
    const config = await getWhatsappConfig();
    if (!config?.groupChatId) return;

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
        "",
        "--",
        "_Pesan ini dikirim otomatis oleh sistem._"
    ];

    await sendWhatsappMessage(config.groupChatId, messageLines.join("\n"));
}

/**
 * Runs the automated process to send monthly recap reports to all parents and class advisors.
 * This function is designed to be triggered by a cron job.
 */
export async function runMonthlyRecapAutomation() {
    console.log("Starting monthly recap automation process...");
    
    // 1. Determine the target month (previous month)
    const today = new Date();
    const previousMonthDate = subMonths(today, 1);
    const targetMonth = getMonth(previousMonthDate);
    const targetYear = getYear(previousMonthDate);
    
    console.log(`Targeting report for: ${format(previousMonthDate, "MMMM yyyy")}`);

    // 2. Fetch all necessary data from Firestore
    const [classesSnapshot, studentsSnapshot, holidaysSnapshot] = await Promise.all([
        getDocs(collection(db, "classes")),
        getDocs(query(collection(db, "students"), where("status", "==", "Aktif"))),
        getDocs(collection(db, "holidays"))
    ]);

    const classes = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
    const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
    const holidays = holidaysSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Holiday[];
    
    if (students.length === 0) {
        console.log("No active students found. Aborting recap automation.");
        return;
    }

    // 3. Fetch all attendance records for the target month
    const monthStart = startOfMonth(previousMonthDate);
    const monthEnd = endOfMonth(previousMonthDate);
    const studentIds = students.map(s => s.id);
    const attendanceRecords: AutomationAttendanceRecord[] = [];

    const studentIdChunks = [];
    for (let i = 0; i < studentIds.length; i += 30) {
        studentIdChunks.push(studentIds.slice(i, i + 30));
    }

    for (const chunk of studentIdChunks) {
        if (chunk.length === 0) continue;
        const attendanceQuery = query(
            collection(db, "attendance"),
            where("studentId", "in", chunk),
            where("recordDate", ">=", monthStart),
            where("recordDate", "<=", monthEnd)
        );
        const attendanceSnapshot = await getDocs(attendanceQuery);
        attendanceSnapshot.forEach(doc => attendanceRecords.push(doc.data() as AutomationAttendanceRecord));
    }

    // 4. Process data into summary format
    const holidayDateStrings = new Set<string>();
    holidays.forEach(holiday => {
        const start = holiday.startDate.toDate();
        const end = holiday.endDate.toDate();
        const interval = eachDayOfInterval({ start, end });
        interval.forEach(day => {
            if (getMonth(day) === targetMonth && getYear(day) === targetYear) {
                holidayDateStrings.add(format(day, 'yyyy-MM-dd'));
            }
        });
    });

    const summary: MonthlySummary = {};
    const daysInMonth = getDaysInMonth(previousMonthDate);
            
    students.forEach(student => {
        summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0, L: 0 } };
        const studentRecords = attendanceRecords.filter(r => r.studentId === student.id);
        
        for(let day = 1; day <= daysInMonth; day++) {
            const currentDate = new Date(targetYear, targetMonth, day);
            const dateString = format(currentDate, 'yyyy-MM-dd');
            const dayOfWeek = getDay(currentDate);

            if (holidayDateStrings.has(dateString) || dayOfWeek === 0) { // Sunday is a holiday
                summary[student.id].attendance[day] = 'L';
                summary[student.id].summary.L++;
                continue;
            }

            const recordForDay = studentRecords.find(r => getDate(r.recordDate.toDate()) === day);
            if (recordForDay) {
                let statusChar = '';
                switch (recordForDay.status) {
                    case "Hadir": statusChar = 'H'; summary[student.id].summary.H++; break;
                    case "Terlambat": statusChar = 'T'; summary[student.id].summary.T++; break;
                    case "Sakit": statusChar = 'S'; summary[student.id].summary.S++; break;
                    case "Izin": statusChar = 'I'; summary[student.id].summary.I++; break;
                    case "Alfa": statusChar = 'A'; summary[student.id].summary.A++; break;
                    case "Dispen": statusChar = 'D'; summary[student.id].summary.D++; break;
                }
                 if (statusChar) summary[student.id].attendance[day] = statusChar;
            } else {
                summary[student.id].attendance[day] = 'A';
                summary[student.id].summary.A++;
            }
        }
    });

    // 5. Send notifications
    // NOTE: The random delay is now handled inside sendWhatsappMessage, so we can remove the explicit delay here.
    console.log(`Sending recaps to ${students.length} parents...`);
    for (const studentData of Object.values(summary)) {
        await sendMonthlyRecapToParent(studentData, targetMonth, targetYear);
    }
    console.log("Finished sending recaps to parents.");

    // Send to class advisor groups
    console.log("Sending recaps to class advisor groups...");
    const classSummaries: { [classId: string]: MonthlySummary } = {};
    Object.values(summary).forEach(studentData => {
        const classId = studentData.studentInfo.classId;
        if (!classSummaries[classId]) {
            classSummaries[classId] = {};
        }
        classSummaries[classId][studentData.studentInfo.id] = studentData;
    });

    for (const classId in classSummaries) {
        const classInfo = classes.find(c => c.id === classId);
        if (classInfo) {
            await sendClassMonthlyRecap(classInfo.name, classInfo.grade, targetMonth, targetYear, classSummaries[classId]);
        }
    }
    console.log("Finished sending recaps to advisors.");
    console.log("Monthly recap automation process completed.");
}

// These functions below are now deprecated as we are not using a public webhook or manual polling for WhatsApp.
export async function syncTelegramMessages(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: "This feature is deprecated for WhatsApp." };
}
export async function deleteTelegramWebhook(): Promise<{ success: boolean; message: string }> {
     return { success: false, message: "This feature is not applicable for WhatsApp." };
}
export async function processTelegramWebhook(payload: any) {
    // Deprecated
    return;
}
