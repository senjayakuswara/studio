
"use client"

import { useState, useEffect, useMemo } from "react"
import type { DateRange } from "react-day-picker"
import { collection, query, where, getDocs, Timestamp, doc, getDoc, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, getDaysInMonth, startOfMonth, endOfMonth, getYear, getMonth, eachDayOfInterval, isSunday, isSaturday } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Download, Loader2, Printer, Search, Send } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ComboBox } from "@/components/ui/combobox"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { queueDetailedClassRecapNotification } from "@/ai/flows/notification-flow"

// Types
type Class = { id: string; name: string; grade: string; whatsappGroupName?: string; waliKelas?: string; }
type Student = { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; }
type Holiday = { id: string; name: string; startDate: Timestamp; endDate: Timestamp };
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
type AttendanceRecord = {
  studentId: string
  status: AttendanceStatus
  recordDate: Timestamp
  timestampMasuk?: Timestamp
  timestampPulang?: Timestamp
}
type ReportConfig = {
    headerImageUrl: string | null
    reportTitle: string
    reportLocation: string
    signatoryName: string
    signatoryNpa: string
    signatorySignatureUrl: string | null
    principalName: string
    principalNpa: string
    principalSignatureUrl: string | null
}
export type MonthlySummaryData = {
    studentInfo: Student,
    attendance: { [day: number]: string }, // 'H', 'S', 'I', 'A', 'T', 'D', 'L'
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}
export type MonthlySummary = {
    [studentId: string]: MonthlySummaryData
}

type WarningStudent = {
    studentInfo: Student,
    alfaCount: number,
    sakitCount: number,
    izinCount: number,
    classInfo: Class
}

const years = [getYear(new Date()), getYear(new Date()) - 1, getYear(new Date()) - 2];
const months = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: format(new Date(0, i), "MMMM", { locale: localeID }),
}));

export default function RekapitulasiPage() {
    // State for Monthly Report
    const [selectedTarget, setSelectedTarget] = useState<string>("")
    const [selectedMonth, setSelectedMonth] = useState<number>(getMonth(new Date()))
    const [selectedYear, setSelectedYear] = useState<number>(getYear(new Date()))

    // State for Individual Report
    const [allStudents, setAllStudents] = useState<Student[]>([])
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
    const [individualReportClassId, setIndividualReportClassId] = useState<string>("");
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
    })

    // State for Warning Letters
    const [warningMonth, setWarningMonth] = useState<number>(getMonth(new Date()));
    const [warningYear, setWarningYear] = useState<number>(getYear(new Date()));
    const [warningClass, setWarningClass] = useState<string>("all");
    const [warningThreshold, setWarningThreshold] = useState<number>(3);
    const [warningList, setWarningList] = useState<WarningStudent[]>([]);
    const [isSearchingWarnings, setIsSearchingWarnings] = useState(false);

    // Common State
    const [classes, setClasses] = useState<Class[]>([])
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [isSendingNotifs, setIsSendingNotifs] = useState(false);
    const { toast } = useToast()
    
    const individualStudentOptions = useMemo(() => {
        if (!individualReportClassId) return [];
        return allStudents
            .filter(student => student.classId === individualReportClassId)
            .map(student => ({
                value: student.id,
                label: student.nama,
            }));
    }, [allStudents, individualReportClassId]);

    const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);

    const isSingleClassSelected = useMemo(() => !selectedTarget.startsWith("grade-") && selectedTarget !== "all-grades" && selectedTarget !== "", [selectedTarget]);

    useEffect(() => {
        async function fetchInitialData() {
            setIsLoading(true);
            try {
                const [classesSnapshot, reportConfigSnap, studentsSnapshot, holidaysSnapshot] = await Promise.all([
                    getDocs(collection(db, "classes")),
                    getDoc(doc(db, "settings", "reportConfig")),
                    getDocs(query(collection(db, "students"), orderBy("nama", "asc"))),
                    getDocs(collection(db, "holidays"))
                ]);
                
                if (reportConfigSnap.exists()) {
                    setReportConfig(reportConfigSnap.data() as ReportConfig);
                }

                const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
                classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`));
                setClasses(classList);
                
                const studentList = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
                setAllStudents(studentList);

                const holidayList = holidaysSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Holiday[];
                setHolidays(holidayList);
                
            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast({
                    variant: "destructive",
                    title: "Gagal Memuat Data",
                    description: "Gagal mengambil data dari server.",
                });
            } finally {
                setIsLoading(false);
            }
        }
        fetchInitialData();
    }, [toast]);

    const generateSummaryData = async (): Promise<{summary: MonthlySummary; students: Student[], holidayDateStrings: Set<string>} | null> => {
        if (!selectedTarget) {
            toast({ variant: "destructive", title: "Pilih Target Laporan", description: "Anda harus memilih kelas, tingkat, atau semua tingkat." });
            return null;
        }

        try {
            let studentsToQuery: Student[] = [];
            if (selectedTarget.startsWith("grade-")) {
                const grade = selectedTarget.split('-')[1];
                const classIdsInGrade = classes.filter(c => c.grade === grade).map(c => c.id);
                studentsToQuery = allStudents.filter(s => classIdsInGrade.includes(s.classId));
            } else if (selectedTarget === "all-grades") {
                studentsToQuery = allStudents;
            } else {
                studentsToQuery = allStudents.filter(s => s.classId === selectedTarget);
            }
            
            if (studentsToQuery.length === 0) {
                toast({ title: "Tidak Ada Siswa", description: "Tidak ada siswa di target ini untuk dilaporkan." });
                return null;
            }

            studentsToQuery.sort((a, b) => {
                const classA = classMap.get(a.classId);
                const classB = classMap.get(b.classId);
                const classAKey = classA ? `${classA.grade}-${classA.name}` : '';
                const classBKey = classB ? `${b.grade}-${b.name}` : '';
                if (classAKey !== classBKey) return classAKey.localeCompare(classBKey);
                return a.nama.localeCompare(b.nama);
            });

            const monthStart = startOfMonth(new Date(selectedYear, selectedMonth));
            const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth));
            const studentIds = studentsToQuery.map(s => s.id);
            const attendanceRecords: AttendanceRecord[] = [];
            const studentIdChunks = [];
            for (let i = 0; i < studentIds.length; i += 30) {
                studentIdChunks.push(studentIds.slice(i, i + 30));
            }
            for (const chunk of studentIdChunks) {
                if (chunk.length === 0) continue;
                const attendanceQuery = query(collection(db, "attendance"), where("studentId", "in", chunk), where("recordDate", ">=", monthStart), where("recordDate", "<=", monthEnd));
                const attendanceSnapshot = await getDocs(attendanceQuery);
                attendanceSnapshot.forEach(doc => attendanceRecords.push(doc.data() as AttendanceRecord));
            }

            const holidayDateStrings = new Set<string>();
            holidays.forEach(holiday => {
                const start = holiday.startDate.toDate();
                const end = holiday.endDate.toDate();
                const interval = eachDayOfInterval({ start, end });
                interval.forEach(day => {
                    if (getMonth(day) === selectedMonth && getYear(day) === selectedYear) {
                        holidayDateStrings.add(format(day, 'yyyy-MM-dd'));
                    }
                });
            });

            const summary: MonthlySummary = {};
            const daysInMonth = getDaysInMonth(new Date(selectedYear, selectedMonth));

            const recordsMap = new Map<string, AttendanceRecord>();
            attendanceRecords.forEach(record => {
                const dateString = format(record.recordDate.toDate(), 'yyyy-MM-dd');
                const key = `${record.studentId}-${dateString}`;
                if (!recordsMap.has(key)) {
                    recordsMap.set(key, record);
                }
            });

            studentsToQuery.forEach(student => {
                summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0, L: 0 } };
                
                for(let day = 1; day <= daysInMonth; day++) {
                    const currentDate = new Date(selectedYear, selectedMonth, day);
                    const dateString = format(currentDate, 'yyyy-MM-dd');
                    
                    if (holidayDateStrings.has(dateString) || isSunday(currentDate) || isSaturday(currentDate)) {
                        summary[student.id].attendance[day] = 'L';
                        summary[student.id].summary.L++;
                        continue;
                    }

                    const recordKey = `${student.id}-${dateString}`;
                    const recordForDay = recordsMap.get(recordKey);

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

            return { summary, students: studentsToQuery, holidayDateStrings };
        } catch(e) {
             console.error("Error generating summary data:", e);
             toast({ variant: "destructive", title: "Gagal Memproses Data", description: "Terjadi kesalahan saat memproses data absensi." });
             return null;
        }
    }

    const handleGenerateMonthlyReport = async () => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }
        setIsGenerating(true);
        try {
            const data = await generateSummaryData();
            if (data) {
                const pdfDoc = generateMonthlyPdf(data.summary, data.students, selectedTarget, data.holidayDateStrings);
                const monthName = format(new Date(selectedYear, selectedMonth), "MMMM_yyyy");
                let fileNameScope = "Laporan_Bulanan";
                if (selectedTarget.startsWith("grade-")) fileNameScope = `Tingkat_${selectedTarget.split('-')[1]}`;
                else if (selectedTarget !== "all-grades") fileNameScope = `Kelas_${classMap.get(selectedTarget)?.name.replace(/ /g, '_')}`;

                pdfDoc.save(`${fileNameScope}_${monthName}.pdf`);
            }
        } finally {
            setIsGenerating(false);
        }
    }

    const generateMonthlyPdf = (summary: MonthlySummary, students: Student[], target: string, holidayDateStrings: Set<string>): jsPDF => {
        const doc = new jsPDF({ orientation: "landscape" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageMargin = 15;
        let lastY = 10;
        
        if (reportConfig?.headerImageUrl) {
            try {
                const imgWidth = pageWidth - pageMargin * 2;
                const imgHeight = imgWidth * (150 / 950);
                doc.addImage(reportConfig.headerImageUrl, 'PNG', pageMargin, 10, imgWidth, imgHeight);
                lastY = 10 + imgHeight + 5;
            } catch (e) { lastY = 40; }
        } else {
             doc.setFont('helvetica', 'bold');
             doc.setFontSize(14);
             doc.text("Laporan Rekapitulasi Absensi", pageWidth / 2, 20, { align: 'center' });
             lastY = 35;
        }

        let scopeText = "";
        if (target.startsWith("grade-")) {
            const grade = target.split('-')[1];
            scopeText = `Tingkat: ${grade}`;
        } else if (target === "all-grades") {
            scopeText = `Tingkat: Semua`;
        } else {
            const selectedClassInfo = classes.find(c => c.id === target);
            if (selectedClassInfo) {
                scopeText = `Kelas: ${selectedClassInfo.name}, Tingkat: ${selectedClassInfo.grade}`;
            }
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text("REKAPITULASI ABSENSI SISWA", pageWidth / 2, lastY, { align: 'center' });
        lastY += 6;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const textY = lastY + 5;
        doc.text(scopeText, pageMargin, textY);
        doc.text(`Bulan: ${format(new Date(selectedYear, selectedMonth), "MMMM yyyy", { locale: localeID })}`, pageWidth - pageMargin, textY, { align: 'right' });
        lastY = textY + 10;
        
        const daysInMonth = getDaysInMonth(new Date(selectedYear, selectedMonth));
        const head = [
            [{ content: 'No', rowSpan: 2 }, { content: 'Nama Siswa', rowSpan: 2 }, { content: 'NISN', rowSpan: 2 }, { content: 'Kelas', rowSpan: 2 }, { content: 'Tingkat', rowSpan: 2 }, { content: 'Tanggal', colSpan: daysInMonth }, { content: 'Jumlah', colSpan: 6 }],
            [...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), 'Hadir', 'Telat', 'Sakit', 'Izin', 'Alfa', 'Dispen']
        ];
        
        const body = students.map((student, index) => {
            const studentSummary = summary[student.id];
            const attendanceRow = Array.from({ length: daysInMonth }, (_, i) => studentSummary.attendance[i + 1] || '');
            const studentClass = classMap.get(student.classId);
            return [
                index + 1,
                student.nama,
                student.nisn,
                studentClass ? studentClass.name : 'N/A',
                studentClass ? studentClass.grade : 'N/A',
                ...attendanceRow,
                studentSummary.summary.H + studentSummary.summary.T, // Total Hadir (H+T)
                studentSummary.summary.T,
                studentSummary.summary.S,
                studentSummary.summary.I,
                studentSummary.summary.A,
                studentSummary.summary.D,
            ];
        });

        autoTable(doc, {
            head: head,
            body: body,
            startY: lastY,
            theme: 'grid',
            styles: { fontSize: 6, cellPadding: 1, halign: 'center', valign: 'middle' },
            headStyles: { fillColor: [22, 163, 74], textColor: 255, halign: 'center' },
            columnStyles: {
                0: { halign: 'center', cellWidth: 8 }, 1: { halign: 'left', cellWidth: 35 }, 2: { halign: 'center', cellWidth: 18 },
                3: { halign: 'left', cellWidth: 15 }, 4: { halign: 'center', cellWidth: 10 },
            },
            willDrawCell: (data) => {
                const dayIndex = data.column.index - 5;
                if(data.section === 'body' && dayIndex >= 0 && dayIndex < daysInMonth) {
                    const currentDate = new Date(selectedYear, selectedMonth, dayIndex + 1);
                    const dateString = format(currentDate, 'yyyy-MM-dd');
                    if (holidayDateStrings.has(dateString) || isSunday(currentDate) || isSaturday(currentDate)) {
                        doc.setFillColor(229, 231, 235);
                    }
                }
            }
        });
        lastY = (doc as any).lastAutoTable.finalY || lastY + 20;

        let signatureY = lastY + 15;
        if (signatureY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); signatureY = 40; }
        const leftX = pageWidth / 4;
        const rightX = (pageWidth / 4) * 3;
        doc.setFontSize(10);
        doc.setFont('times', 'normal');
        if(reportConfig){
            doc.text("Mengetahui,", leftX, signatureY, { align: 'center' });
            doc.text("Kepala Sekolah,", leftX, signatureY + 6, { align: 'center' });
            if (reportConfig.principalSignatureUrl) {
                try {
                doc.addImage(reportConfig.principalSignatureUrl, 'PNG', leftX - 25, signatureY + 8, 50, 20);
                } catch(e) { console.error("Failed to add principal signature image", e); }
            }
            doc.setFont('times', 'bold');
            doc.text(reportConfig.principalName, leftX, signatureY + 28, { align: 'center' });
            doc.setFont('times', 'normal');
            doc.text(reportConfig.principalNpa, leftX, signatureY + 34, { align: 'center' });

            doc.text(`${reportConfig.reportLocation}, ` + format(new Date(), "dd MMMM yyyy", { locale: localeID }), rightX, signatureY, { align: 'center' });
            doc.text("Petugas,", rightX, signatureY + 6, { align: 'center' });
            if (reportConfig.signatorySignatureUrl) {
                try {
                doc.addImage(reportConfig.signatorySignatureUrl, 'PNG', rightX - 25, signatureY + 8, 50, 20);
                } catch(e) { console.error("Failed to add signatory signature image", e); }
            }
            doc.setFont('times', 'bold');
            doc.text(reportConfig.signatoryName, rightX, signatureY + 28, { align: 'center' });
            doc.setFont('times', 'normal');
            doc.text(reportConfig.signatoryNpa, rightX, signatureY + 34, { align: 'center' });
        }
        
        return doc;
    }

    const handleSendRecapNotifications = async () => {
        if (!isSingleClassSelected) {
            toast({ variant: "destructive", title: "Aksi Tidak Valid", description: "Harap pilih satu kelas spesifik untuk mengirim rekap." });
            return;
        }
        
        const classInfo = classMap.get(selectedTarget);
        if (!classInfo || !classInfo.whatsappGroupName) {
            toast({
                variant: "destructive",
                title: "Grup Tidak Ditemukan",
                description: "Nama grup WhatsApp belum diatur untuk kelas ini di menu Pengaturan Kelas.",
            });
            return;
        }
        
        setIsSendingNotifs(true);
        toast({ title: "Memproses Rekapitulasi...", description: `Menyiapkan rekapitulasi untuk kelas ${classInfo.name}. Ini mungkin memakan waktu...` });

        try {
            const data = await generateSummaryData();
            if (!data) {
                // generateSummaryData already shows a toast on failure
                setIsSendingNotifs(false);
                return;
            }
            
            await queueDetailedClassRecapNotification({
                classInfo,
                month: selectedMonth,
                year: selectedYear,
                summaryData: data.summary,
                students: data.students,
            });

            toast({
                title: "Tugas Terkirim ke Antrean",
                description: `Notifikasi rekap detail untuk grup ${classInfo.name} berhasil dijadwalkan untuk dikirim.`,
            });

        } catch (error: any) {
            console.error("Error during handleSendRecapNotifications:", error);
            toast({ variant: "destructive", title: "Proses Gagal", description: error.message || "Terjadi kesalahan saat mengirim tugas." });
        } finally {
            setIsSendingNotifs(false);
        }
    }


    const handleGenerateIndividualReport = async () => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }
        if (!selectedStudent || !dateRange?.from) {
            toast({ variant: "destructive", title: "Pilihan Tidak Lengkap", description: "Harap pilih kelas, siswa, dan tentukan rentang tanggal." });
            return;
        }

        setIsGenerating(true);
        try {
            const startDate = startOfMonth(dateRange.from);
            const endDate = endOfMonth(dateRange.to || dateRange.from);
            
            const q = query(
                collection(db, "attendance"), 
                where("studentId", "==", selectedStudent.id), 
                where("recordDate", ">=", startDate), 
                where("recordDate", "<=", endDate),
                orderBy("recordDate", "asc")
            );

            const attendanceSnapshot = await getDocs(q);
            const records = attendanceSnapshot.docs.map(doc => doc.data() as AttendanceRecord);

            if(records.length === 0){
                toast({ title: "Tidak Ada Data", description: "Tidak ditemukan catatan absensi untuk siswa pada periode ini." });
                setIsGenerating(false);
                return;
            }
            
            generateIndividualPdf(selectedStudent, records, dateRange, reportConfig);

        } catch (e) {
             console.error("Error generating individual report:", e);
             toast({ variant: "destructive", title: "Gagal Membuat Laporan", description: "Terjadi kesalahan saat memproses data." });
        } finally {
            setIsGenerating(false);
        }
    }

    const generateIndividualPdf = (student: Student, records: AttendanceRecord[], range: DateRange, reportConfig: ReportConfig) => {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageMargin = 15;
        let lastY = 10;

        if (reportConfig.headerImageUrl) {
            try {
                const imgWidth = pageWidth - pageMargin * 2;
                const imgHeight = imgWidth * (150 / 950);
                doc.addImage(reportConfig.headerImageUrl, 'PNG', pageMargin, 10, imgWidth, imgHeight);
                lastY = 10 + imgHeight + 5;
            } catch (e) { lastY = 40; }
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text("Laporan Kehadiran Individual", pageWidth / 2, lastY, { align: 'center' });
        lastY += 10;
        
        const studentClass = classes.find(c => c.id === student.classId);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Nama: ${student.nama}`, pageMargin, lastY);
        doc.text(`Kelas: ${studentClass?.name ?? 'N/A'}`, pageWidth - pageMargin, lastY, {align: 'right'});
        lastY += 6;
        doc.text(`NISN: ${student.nisn}`, pageMargin, lastY);
        const period = `${format(range.from!, "dd MMM yyyy")} - ${format(range.to || range.from!, "dd MMM yyyy")}`;
        doc.text(`Periode: ${period}`, pageWidth - pageMargin, lastY, {align: 'right'});
        lastY += 10;
        
        const summary = { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0 };
        const tableBody = records.map(record => {
            switch(record.status){
                case "Hadir": summary.H++; break;
                case "Terlambat": summary.T++; break;
                case "Sakit": summary.S++; break;
                case "Izin": summary.I++; break;
                case "Alfa": summary.A++; break;
                case "Dispen": summary.D++; break;
            }
            return [
                format(record.recordDate.toDate(), 'eeee, dd MMM yyyy', {locale: localeID}),
                record.timestampMasuk ? format(record.timestampMasuk.toDate(), 'HH:mm:ss') : '-',
                record.timestampPulang ? format(record.timestampPulang.toDate(), 'HH:mm:ss') : '-',
                record.status,
            ];
        });

        autoTable(doc, {
            head: [['Tanggal', 'Jam Masuk', 'Jam Pulang', 'Status']],
            body: tableBody,
            startY: lastY,
            theme: 'grid',
            headStyles: { fillColor: [22, 163, 74], textColor: 255 },
        });

        lastY = (doc as any).lastAutoTable.finalY + 10;

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text("Ringkasan Kehadiran", pageMargin, lastY);
        lastY += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        
        const summaryText = `Hadir: ${summary.H + summary.T} | Terlambat: ${summary.T} | Sakit: ${summary.S} | Izin: ${summary.I} | Alfa: ${summary.A} | Dispen: ${summary.D}`;
        doc.text(summaryText, pageMargin, lastY);

        let signatureY = lastY + 15;
        if (signatureY > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); signatureY = 40; }
        const leftX = pageWidth / 4;
        const rightX = (pageWidth / 4) * 3;
        doc.setFontSize(10);
        doc.setFont('times', 'normal');
        
        doc.text("Mengetahui,", leftX, signatureY, { align: 'center' });
        doc.text("Kepala Sekolah,", leftX, signatureY + 6, { align: 'center' });
        if (reportConfig.principalSignatureUrl) {
            try {
            doc.addImage(reportConfig.principalSignatureUrl, 'PNG', leftX - 25, signatureY + 8, 50, 20);
            } catch(e) { console.error("Failed to add principal signature image", e); }
        }
        doc.setFont('times', 'bold');
        doc.text(reportConfig.principalName, leftX, signatureY + 28, { align: 'center' });
        doc.setFont('times', 'normal');
        doc.text(reportConfig.principalNpa, leftX, signatureY + 34, { align: 'center' });

        doc.text(`${reportConfig.reportLocation}, ` + format(new Date(), "dd MMMM yyyy", { locale: localeID }), rightX, signatureY, { align: 'center' });
        doc.text("Petugas,", rightX, signatureY + 6, { align: 'center' });
        if (reportConfig.signatorySignatureUrl) {
            try {
            doc.addImage(reportConfig.signatorySignatureUrl, 'PNG', rightX - 25, signatureY + 8, 50, 20);
            } catch(e) { console.error("Failed to add signatory signature image", e); }
        }
        doc.setFont('times', 'bold');
        doc.text(reportConfig.signatoryName, rightX, signatureY + 28, { align: 'center' });
        doc.setFont('times', 'normal');
        doc.text(reportConfig.signatoryNpa, rightX, signatureY + 34, { align: 'center' });
        
        doc.save(`Laporan_Individual_${student.nama.replace(/ /g, '_')}.pdf`);
    };

    const handleSearchWarnings = async () => {
        setIsSearchingWarnings(true);
        setWarningList([]);
        try {
            const monthStart = startOfMonth(new Date(warningYear, warningMonth));
            const monthEnd = endOfMonth(new Date(warningYear, warningMonth));
            
            let studentsToScan = allStudents;
            if (warningClass !== "all") {
                studentsToScan = allStudents.filter(s => s.classId === warningClass);
            }

            if (studentsToScan.length === 0) {
                toast({ title: "Tidak Ada Siswa", description: "Tidak ada siswa pada kelas yang dipilih." });
                setIsSearchingWarnings(false);
                return;
            }
            
            const studentIds = studentsToScan.map(s => s.id);
            const attendanceRecords: AttendanceRecord[] = [];
            const studentIdChunks = [];
            for (let i = 0; i < studentIds.length; i += 30) {
                studentIdChunks.push(studentIds.slice(i, i + 30));
            }
            for (const chunk of studentIdChunks) {
                if (chunk.length === 0) continue;
                const attendanceQuery = query(collection(db, "attendance"), where("studentId", "in", chunk), where("recordDate", ">=", monthStart), where("recordDate", "<=", monthEnd));
                const attendanceSnapshot = await getDocs(attendanceQuery);
                attendanceSnapshot.forEach(doc => attendanceRecords.push(doc.data() as AttendanceRecord));
            }

            const warnings: WarningStudent[] = [];
            studentsToScan.forEach(student => {
                const studentRecords = attendanceRecords.filter(r => r.studentId === student.id);
                const alfaCount = studentRecords.filter(r => r.status === 'Alfa').length;
                
                if (alfaCount >= warningThreshold) {
                    warnings.push({
                        studentInfo: student,
                        alfaCount,
                        sakitCount: studentRecords.filter(r => r.status === 'Sakit').length,
                        izinCount: studentRecords.filter(r => r.status === 'Izin').length,
                        classInfo: classMap.get(student.classId)!
                    });
                }
            });
            
            setWarningList(warnings.sort((a,b) => b.alfaCount - a.alfaCount));
             toast({ title: "Pencarian Selesai", description: `Ditemukan ${warnings.length} siswa yang memenuhi kriteria.` });

        } catch (e) {
            console.error("Error searching for warnings:", e);
            toast({ variant: "destructive", title: "Gagal Mencari Data", description: "Terjadi kesalahan saat memproses data absensi." });
        } finally {
            setIsSearchingWarnings(false);
        }
    }

    const generateWarningLetterPdf = (studentData: WarningStudent) => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageMargin = 20;
        let lastY = 15;

        if (reportConfig.headerImageUrl) {
            try {
                const imgWidth = pageWidth - pageMargin * 2;
                const imgHeight = imgWidth * (150 / 950);
                doc.addImage(reportConfig.headerImageUrl, 'PNG', pageMargin, lastY, imgHeight);
                lastY += imgHeight + 10;
            } catch (e) { lastY = 50; }
        }

        doc.setFontSize(11);
        doc.setFont('times', 'normal');
        doc.text(`Nomor: ...../...../...../.....`, pageMargin, lastY);
        doc.text(
            `${reportConfig.reportLocation}, ${format(new Date(), 'd MMMM yyyy', { locale: localeID })}`,
            pageWidth - pageMargin,
            lastY,
            { align: 'right' }
        );
        lastY += 8;
        doc.text(`Perihal: Surat Panggilan Orang Tua/Wali`, pageMargin, lastY);
        lastY += 15;

        doc.text(`Yth. Bapak/Ibu Orang Tua/Wali dari:`, pageMargin, lastY);
        lastY += 8;
        doc.text(`Nama: ${studentData.studentInfo.nama}`, pageMargin + 10, lastY);
        lastY += 6;
        doc.text(`Kelas: ${studentData.classInfo.name}`, pageMargin + 10, lastY);
        lastY += 8;
        doc.text(`Di`, pageMargin, lastY);
        lastY += 6;
        doc.text(`Tempat`, pageMargin + 10, lastY);
        lastY += 15;

        doc.text(`Dengan hormat,`, pageMargin, lastY);
        lastY += 8;

        const bodyText = `Sehubungan dengan kegiatan belajar mengajar di sekolah kami, dengan ini kami memberitahukan bahwa putra/i Bapak/Ibu berdasarkan rekapitulasi absensi bulan ${format(new Date(warningYear, warningMonth), 'MMMM yyyy', { locale: localeID })} telah melakukan pelanggaran berupa tidak masuk sekolah tanpa keterangan (Alfa) sebanyak ${studentData.alfaCount} kali.`;
        const splitBody = doc.splitTextToSize(bodyText, pageWidth - (pageMargin * 2));
        doc.text(splitBody, pageMargin, lastY);
        lastY += splitBody.length * 5 + 8;

        const bodyText2 = `Oleh karena itu, kami mengharap kehadiran Bapak/Ibu Orang Tua/Wali siswa untuk dapat hadir ke sekolah pada:`;
        const splitBody2 = doc.splitTextToSize(bodyText2, pageWidth - (pageMargin * 2));
        doc.text(splitBody2, pageMargin, lastY);
        lastY += splitBody2.length * 5 + 8;
        
        doc.text(`Hari, Tanggal: ...........................................`, pageMargin + 10, lastY);
        lastY += 6;
        doc.text(`Waktu: ...........................................`, pageMargin + 10, lastY);
        lastY += 6;
        doc.text(`Tempat: ...........................................`, pageMargin + 10, lastY);
        lastY += 6;
        doc.text(`Keperluan: Pembinaan Kesiswaan`, pageMargin + 10, lastY);
        lastY += 15;
        
        const closingText = `Demikian surat panggilan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami ucapkan terima kasih.`;
        const splitClosing = doc.splitTextToSize(closingText, pageWidth - (pageMargin * 2));
        doc.text(splitClosing, pageMargin, lastY);
        lastY += splitClosing.length * 5 + 20;

        const rightX = (pageWidth / 4) * 3;
        doc.text(`Kepala Sekolah,`, rightX, lastY, { align: 'center' });
        if (reportConfig.principalSignatureUrl) {
            try {
            doc.addImage(reportConfig.principalSignatureUrl, 'PNG', rightX - 25, lastY + 2, 50, 20);
            } catch(e) { console.error("Failed to add principal signature image", e); }
        }
        lastY += 25;
        doc.setFont('times', 'bold');
        doc.text(reportConfig.principalName, rightX, lastY, { align: 'center' });
        lastY += 6;
        doc.setFont('times', 'normal');
        doc.text(reportConfig.principalNpa, rightX, lastY, { align: 'center' });
        
        doc.save(`SP_${studentData.studentInfo.nama.replace(/ /g, '_')}_${warningMonth+1}_${warningYear}.pdf`);
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Rekapitulasi & Laporan</h1>
                <p className="text-muted-foreground">Buat laporan rekapitulasi absensi bulanan atau individual.</p>
            </div>
            
            <Tabs defaultValue="monthly">
                <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="monthly">Laporan Bulanan</TabsTrigger>
                    <TabsTrigger value="individual">Laporan Individual</TabsTrigger>
                    <TabsTrigger value="warnings">Surat Peringatan</TabsTrigger>
                </TabsList>
                
                <TabsContent value="monthly">
                    <Card>
                        <CardHeader>
                            <CardTitle>Laporan Rekapitulasi Bulanan</CardTitle>
                            <CardDescription>Pilih periode dan target untuk membuat laporan rekapitulasi absensi kolektif.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Bulan</Label>
                                    <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number(v))} disabled={isLoading}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Bulan" /></SelectTrigger>
                                        <SelectContent>{months.map(month => (<SelectItem key={month.value} value={month.value.toString()}>{month.label}</SelectItem>))}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Tahun</Label>
                                    <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))} disabled={isLoading}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Tahun" /></SelectTrigger>
                                        <SelectContent>{years.map(year => (<SelectItem key={year} value={year.toString()}>{year}</SelectItem>))}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Target Laporan</Label>
                                    <Select value={selectedTarget} onValueChange={setSelectedTarget} disabled={isLoading || classes.length === 0}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Target Laporan" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup><SelectLabel>Grup Global</SelectLabel><SelectItem value="all-grades">Semua Tingkat</SelectItem></SelectGroup>
                                            <SelectGroup><SelectLabel>Per Tingkat</SelectLabel>
                                                <SelectItem value="grade-X">Semua Kelas X</SelectItem>
                                                <SelectItem value="grade-XI">Semua Kelas XI</SelectItem>
                                                <SelectItem value="grade-XII">Semua Kelas XII</SelectItem>
                                            </SelectGroup>
                                            {["X", "XI", "XII"].map(grade => (
                                                <SelectGroup key={grade}><SelectLabel>Kelas {grade}</SelectLabel>
                                                    {classes.filter(c => c.grade === grade).map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                                </SelectGroup>
                                            ))}
                                            <SelectGroup><SelectLabel>Staf</SelectLabel>
                                                {classes.filter(c => c.grade === 'Staf').map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button onClick={handleSendRecapNotifications} disabled={isSendingNotifs || isGenerating || isLoading || !isSingleClassSelected}>
                                    {isSendingNotifs ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                    Kirim Notif Rekap
                                </Button>
                                <Button onClick={handleGenerateMonthlyReport} disabled={isGenerating || isSendingNotifs || isLoading || !selectedTarget}>
                                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    {isGenerating ? 'Membuat...' : 'Cetak Laporan Bulanan'}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="individual">
                     <Card>
                        <CardHeader>
                            <CardTitle>Laporan Kehadiran Individual</CardTitle>
                            <CardDescription>Pilih siswa dan rentang tanggal untuk mencetak laporan kehadiran personal.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="space-y-2">
                                    <Label>Pilih Kelas</Label>
                                    <Select 
                                        value={individualReportClassId}
                                        onValueChange={(value) => {
                                            setIndividualReportClassId(value);
                                            setSelectedStudent(null);
                                        }}
                                        disabled={isLoading || classes.length === 0}
                                    >
                                        <SelectTrigger><SelectValue placeholder="Pilih kelas" /></SelectTrigger>
                                        <SelectContent>
                                            {["X", "XI", "XII", "Staf"].map(grade => (
                                                <SelectGroup key={grade}><SelectLabel>Kelas {grade}</SelectLabel>
                                                    {classes.filter(c => c.grade === grade).map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Pilih Siswa</Label>
                                    <ComboBox
                                        options={individualStudentOptions}
                                        value={selectedStudent?.id}
                                        onSelect={(value) => {
                                            const student = allStudents.find(s => s.id === value) || null;
                                            setSelectedStudent(student);
                                        }}
                                        placeholder="Pilih siswa..."
                                        searchPlaceholder="Ketik nama untuk mencari..."
                                        emptyState="Siswa tidak ditemukan."
                                        disabled={isLoading || !individualReportClassId}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Rentang Tanggal</Label>
                                     <DateRangePicker 
                                        date={dateRange}
                                        onDateChange={setDateRange}
                                        disabled={isLoading}
                                    />
                                </div>
                             </div>
                              <div className="flex justify-end">
                                 <Button onClick={handleGenerateIndividualReport} disabled={isGenerating || isLoading || !selectedStudent}>
                                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                    {isGenerating ? 'Membuat Laporan...' : 'Cetak Laporan Individual'}
                                 </Button>
                             </div>
                        </CardContent>
                     </Card>
                </TabsContent>

                 <TabsContent value="warnings">
                    <Card>
                        <CardHeader>
                            <CardTitle>Laporan Surat Peringatan (SP)</CardTitle>
                            <CardDescription>Cari siswa yang melebihi batas ketidakhadiran (Alfa) dalam satu bulan dan cetak surat panggilan orang tua.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="space-y-2">
                                    <Label>Bulan</Label>
                                    <Select value={warningMonth.toString()} onValueChange={(v) => setWarningMonth(Number(v))} disabled={isLoading}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Bulan" /></SelectTrigger>
                                        <SelectContent>{months.map(month => (<SelectItem key={month.value} value={month.value.toString()}>{month.label}</SelectItem>))}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Tahun</Label>
                                    <Select value={warningYear.toString()} onValueChange={(v) => setWarningYear(Number(v))} disabled={isLoading}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Tahun" /></SelectTrigger>
                                        <SelectContent>{years.map(year => (<SelectItem key={year} value={year.toString()}>{year}</SelectItem>))}</SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Kelas</Label>
                                    <Select value={warningClass} onValueChange={setWarningClass} disabled={isLoading || classes.length === 0}>
                                        <SelectTrigger><SelectValue placeholder="Pilih Kelas" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">Semua Kelas</SelectItem>
                                            {["X", "XI", "XII"].map(grade => (
                                                <SelectGroup key={grade}><SelectLabel>Kelas {grade}</SelectLabel>
                                                    {classes.filter(c => c.grade === grade).map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="warning-threshold">Batas Alfa</Label>
                                    <Input
                                        id="warning-threshold"
                                        type="number"
                                        value={warningThreshold}
                                        onChange={(e) => setWarningThreshold(Number(e.target.value))}
                                        min="1"
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <Button onClick={handleSearchWarnings} disabled={isSearchingWarnings || isLoading}>
                                    {isSearchingWarnings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                                    {isSearchingWarnings ? 'Mencari...' : 'Cari Siswa'}
                                </Button>
                            </div>
                            
                            {warningList.length > 0 && (
                                <div className="pt-4">
                                <h3 className="text-lg font-medium mb-2">Hasil Pencarian</h3>
                                 <div className="border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Nama Siswa</TableHead>
                                                <TableHead>Kelas</TableHead>
                                                <TableHead>Jumlah Alfa</TableHead>
                                                <TableHead>Jumlah Sakit</TableHead>
                                                <TableHead>Jumlah Izin</TableHead>
                                                <TableHead className="text-right">Aksi</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                        {warningList.map(item => (
                                            <TableRow key={item.studentInfo.id}>
                                                <TableCell className="font-medium">{item.studentInfo.nama}</TableCell>
                                                <TableCell>{item.classInfo.name}</TableCell>
                                                <TableCell>{item.alfaCount}</TableCell>
                                                <TableCell>{item.sakitCount}</TableCell>
                                                <TableCell>{item.izinCount}</TableCell>
                                                <TableCell className="text-right">
                                                    <Button variant="outline" size="sm" onClick={() => generateWarningLetterPdf(item)}>
                                                        <Printer className="mr-2 h-4 w-4" />
                                                        Cetak SP
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                        </TableBody>
                                    </Table>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}
