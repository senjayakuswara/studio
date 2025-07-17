
"use client"

import { useState, useEffect, useMemo } from "react"
import type { DateRange } from "react-day-picker"
import { collection, query, where, getDocs, Timestamp, doc, getDoc, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, getDaysInMonth, startOfMonth, endOfMonth, getYear, getMonth, getDate, eachDayOfInterval, getDay } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Download, Loader2, Send } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { sendClassMonthlyRecap, sendMonthlyRecapToParent } from "@/ai/flows/notification-flow"

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

// Types
type Class = { id: string; name: string; grade: string }
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
    principalName: string
    principalNpa: string
}
type MonthlySummaryData = {
    studentInfo: Student,
    attendance: { [day: number]: string }, // 'H', 'S', 'I', 'A', 'T', 'D', 'L'
    summary: { H: number, T: number, S: number, I: number, A: number, D: number, L: number }
}
type MonthlySummary = {
    [studentId: string]: MonthlySummaryData
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

    // Common State
    const [classes, setClasses] = useState<Class[]>([])
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isSending, setIsSending] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
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

    const generateSummaryData = async (forPDF: boolean): Promise<{summary: MonthlySummary; students: Student[], holidayDateStrings: Set<string>} | null> => {
        if (!selectedTarget) {
            toast({ variant: "destructive", title: "Pilih Target Laporan", description: "Anda harus memilih kelas, tingkat, atau semua tingkat." });
            return null;
        }
        if (forPDF) setIsGenerating(true); else setIsSending(true);

        try {
            let classIdsToQuery: string[] = [];
            if (selectedTarget.startsWith("grade-")) {
                const grade = selectedTarget.split('-')[1];
                classIdsToQuery = classes.filter(c => c.grade === grade).map(c => c.id);
            } else if (selectedTarget === "all-grades") {
                classIdsToQuery = classes.map(c => c.id);
            } else {
                classIdsToQuery = [selectedTarget];
            }

            if (classIdsToQuery.length === 0) {
                 toast({ title: "Tidak Ada Kelas", description: "Tidak ada kelas yang cocok dengan target yang dipilih." });
                 return null;
            }

            const students: Student[] = [];
            const classIdChunks = [];
            for (let i = 0; i < classIdsToQuery.length; i += 30) {
                classIdChunks.push(classIdsToQuery.slice(i, i + 30));
            }
            
            for (const chunk of classIdChunks) {
                if (chunk.length === 0) continue;
                const studentsQuery = query(collection(db, "students"), where("classId", "in", chunk));
                const studentsSnapshot = await getDocs(studentsQuery);
                studentsSnapshot.forEach(doc => {
                    students.push({ id: doc.id, ...doc.data() } as Student);
                });
            }

            if (students.length === 0) {
                toast({ title: "Tidak Ada Siswa", description: "Tidak ada siswa di target ini untuk dilaporkan." });
                return null;
            }

            const classMap = new Map(classes.map(c => [c.id, c]));
            students.sort((a, b) => {
                const classA = classMap.get(a.classId);
                const classB = classMap.get(b.classId);
                const classAKey = classA ? `${classA.grade}-${classA.name}` : '';
                const classBKey = classB ? `${classB.grade}-${classB.name}` : '';
                if (classAKey !== classBKey) return classAKey.localeCompare(classBKey);
                return a.nama.localeCompare(b.nama);
            });

            const monthStart = startOfMonth(new Date(selectedYear, selectedMonth));
            const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth));
            const studentIds = students.map(s => s.id);
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
            
            students.forEach(student => {
                summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0, L: 0 } };
                const studentRecords = attendanceRecords.filter(r => r.studentId === student.id);
                
                for(let day = 1; day <= daysInMonth; day++) {
                    const currentDate = new Date(selectedYear, selectedMonth, day);
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

            return { summary, students, holidayDateStrings };
        } catch(e) {
             console.error("Error generating summary data:", e);
             toast({ variant: "destructive", title: "Gagal Memproses Data", description: "Terjadi kesalahan saat memproses data absensi." });
             return null;
        } finally {
            if (forPDF) setIsGenerating(false); else setIsSending(false);
        }
    }

    const handleGenerateMonthlyReport = async () => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }
        const data = await generateSummaryData(true);
        if (data) {
            generateMonthlyPdf(data.summary, data.students, selectedTarget, data.holidayDateStrings);
        }
    }

    const handleSendWhatsappReport = async () => {
        const data = await generateSummaryData(false);
        if (!data || Object.keys(data.summary).length === 0) {
            toast({ title: "Tidak Ada Data", description: "Tidak ada data untuk dikirim." });
            return;
        }
        
        toast({ title: "Memulai Pengiriman...", description: `Mengirim ${Object.keys(data.summary).length} rekap via WhatsApp...` });

        // Get Group ID for class recap
        const appConfigDoc = await getDoc(doc(db, "settings", "appConfig"));
        const groupWaId = appConfigDoc.exists() ? appConfigDoc.data().groupWaId : null;


        // Send to parents
        for (const studentData of Object.values(data.summary)) {
            await sendMonthlyRecapToParent(studentData, selectedMonth, selectedYear);
        }
        
        // Send to class advisor group
        if ((selectedTarget.startsWith("grade-") || classes.some(c => c.id === selectedTarget)) && groupWaId) {
            let className = "";
            let grade = "";
            if (selectedTarget.startsWith("grade-")) {
                grade = selectedTarget.split('-')[1];
                className = `Semua Kelas ${grade}`;
            } else {
                const classInfo = classes.find(c => c.id === selectedTarget);
                if (classInfo) {
                    className = classInfo.name;
                    grade = classInfo.grade;
                }
            }
            if (className) {
                await sendClassMonthlyRecap(className, grade, selectedMonth, selectedYear, data.summary, groupWaId);
            }
        }
        
        toast({ title: "Pengiriman Selesai", description: "Semua perintah notifikasi rekapitulasi telah dikirim ke server lokal." });
    }

    const generateMonthlyPdf = (summary: MonthlySummary, students: Student[], target: string, holidayDateStrings: Set<string>) => {
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
        let fileNameScope = "Laporan"
        if (target.startsWith("grade-")) {
            const grade = target.split('-')[1];
            scopeText = `Tingkat: ${grade}`;
            fileNameScope = `Tingkat_${grade}`
        } else if (target === "all-grades") {
            scopeText = `Tingkat: Semua`;
            fileNameScope = `Semua_Tingkat`
        } else {
            const selectedClassInfo = classes.find(c => c.id === target);
            if (selectedClassInfo) {
                scopeText = `Kelas: ${selectedClassInfo.name}, Tingkat: ${selectedClassInfo.grade}`;
                fileNameScope = `Kelas_${selectedClassInfo.name.replace(/ /g, '_')}`
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
            [...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)), 'H', 'T', 'S', 'I', 'A', 'D']
        ];
        
        const classMap = new Map(classes.map(c => [c.id, c]));
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
                    const dateString = format(new Date(selectedYear, selectedMonth, dayIndex + 1), 'yyyy-MM-dd');
                    const dayOfWeek = getDay(new Date(selectedYear, selectedMonth, dayIndex + 1));
                    if (holidayDateStrings.has(dateString) || dayOfWeek === 0) {
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
            doc.setFont('times', 'bold');
            doc.text(reportConfig.principalName, leftX, signatureY + 28, { align: 'center' });
            doc.setFont('times', 'normal');
            doc.text(reportConfig.principalNpa, leftX, signatureY + 34, { align: 'center' });
            doc.text(`${reportConfig.reportLocation}, ` + format(new Date(), "dd MMMM yyyy", { locale: localeID }), rightX, signatureY, { align: 'center' });
            doc.text("Petugas,", rightX, signatureY + 6, { align: 'center' });
            doc.setFont('times', 'bold');
            doc.text(reportConfig.signatoryName, rightX, signatureY + 28, { align: 'center' });
            doc.setFont('times', 'normal');
            doc.text(reportConfig.signatoryNpa, rightX, signatureY + 34, { align: 'center' });
        }
        
        doc.save(`Laporan_Bulanan_${fileNameScope}_${format(new Date(selectedYear, selectedMonth), "MMMM_yyyy")}.pdf`);
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
                return;
            }
            
            generateIndividualPdf(selectedStudent, records, dateRange);

        } catch (e) {
             console.error("Error generating individual report:", e);
             toast({ variant: "destructive", title: "Gagal Membuat Laporan", description: "Terjadi kesalahan saat memproses data." });
        } finally {
            setIsGenerating(false);
        }
    }

    const generateIndividualPdf = (student: Student, records: AttendanceRecord[], range: DateRange) => {
        const doc = new jsPDF();
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

        doc.save(`Laporan_Individual_${student.nama.replace(/ /g, '_')}.pdf`);
    };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Rekapitulasi & Laporan</h1>
                <p className="text-muted-foreground">Buat laporan rekapitulasi absensi bulanan atau individual.</p>
            </div>
            
            <Tabs defaultValue="monthly">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="monthly">Laporan Bulanan</TabsTrigger>
                    <TabsTrigger value="individual">Laporan Individual</TabsTrigger>
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
                                                <SelectGroup key={grade}><SelectLabel>Per Kelas - Tingkat {grade}</SelectLabel>
                                                    {classes.filter(c => c.grade === grade).map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                                </SelectGroup>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button onClick={handleSendWhatsappReport} disabled={isGenerating || isLoading || !selectedTarget || isSending}>
                                    {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                    {isSending ? 'Mengirim...' : 'Kirim Rekap via WhatsApp'}
                                </Button>
                                <Button onClick={handleGenerateMonthlyReport} disabled={isGenerating || isLoading || !selectedTarget || isSending}>
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
                                            {["X", "XI", "XII"].map(grade => (
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
            </Tabs>
        </div>
    )
}

    