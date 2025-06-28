
"use client"

import { useState, useEffect, useMemo } from "react"
import type { DateRange } from "react-day-picker"
import { addDays } from "date-fns"
import { collection, query, where, getDocs, Timestamp, doc, getDoc, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, getDaysInMonth, startOfMonth, endOfMonth, getYear, getMonth, getDate } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Download, Loader2, Send } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { sendClassMonthlyRecap, sendMonthlyRecapToParent } from "@/ai/flows/telegram-flow"

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
type Student = { id: string; nisn: string; nama: string; classId: string }
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
    attendance: { [day: number]: string }, // 'H', 'S', 'I', 'A', 'T', 'D'
    summary: { H: number, T: number, S: number, I: number, A: number, D: number }
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
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfMonth(new Date()),
    })

    // Common State
    const [classes, setClasses] = useState<Class[]>([])
    const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const { toast } = useToast()
    
    const studentOptions = useMemo(() => {
        return allStudents.map(student => {
            const studentClass = classes.find(c => c.id === student.classId);
            return {
                value: student.id,
                label: `${student.nama} (${studentClass?.name ?? 'Tanpa Kelas'})`,
            };
        });
    }, [allStudents, classes]);

    useEffect(() => {
        async function fetchInitialData() {
            setIsLoading(true);
            try {
                const [classesSnapshot, reportConfigSnap, studentsSnapshot] = await Promise.all([
                    getDocs(collection(db, "classes")),
                    getDoc(doc(db, "settings", "reportConfig")),
                    getDocs(collection(db, "students"))
                ]);
                
                if (reportConfigSnap.exists()) {
                    setReportConfig(reportConfigSnap.data() as ReportConfig);
                }

                const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
                classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`));
                setClasses(classList);
                
                const studentList = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
                studentList.sort((a,b) => a.nama.localeCompare(b.nama));
                setAllStudents(studentList);
                
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

    // --- MONTHLY REPORT LOGIC ---
    const generateSummaryData = async (): Promise<{summary: MonthlySummary; students: Student[]} | null> => {
        if (!selectedTarget) {
            toast({ variant: "destructive", title: "Pilih Target Laporan", description: "Anda harus memilih kelas, tingkat, atau semua tingkat." });
            return null;
        }
        setIsGenerating(true);
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

            const summary: MonthlySummary = {};
            students.forEach(student => {
                summary[student.id] = { studentInfo: student, attendance: {}, summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0 } };
            });
            attendanceRecords.forEach(record => {
                const day = getDate(record.recordDate.toDate());
                let statusChar = '';
                switch (record.status) {
                    case "Hadir": statusChar = 'H'; summary[record.studentId].summary.H++; break;
                    case "Terlambat": statusChar = 'T'; summary[record.studentId].summary.T++; break;
                    case "Sakit": statusChar = 'S'; summary[record.studentId].summary.S++; break;
                    case "Izin": statusChar = 'I'; summary[record.studentId].summary.I++; break;
                    case "Alfa": statusChar = 'A'; summary[record.studentId].summary.A++; break;
                    case "Dispen": statusChar = 'D'; summary[record.studentId].summary.D++; break;
                }
                if (statusChar) summary[record.studentId].attendance[day] = statusChar;
            });
            return { summary, students };
        } catch(e) {
             console.error("Error generating summary data:", e);
             toast({ variant: "destructive", title: "Gagal Memproses Data", description: "Terjadi kesalahan saat memproses data absensi." });
             return null;
        } finally {
            setIsGenerating(false);
        }
    }

    const handleGenerateMonthlyReport = async () => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }
        const data = await generateSummaryData();
        if (data) {
            generateMonthlyPdf(data.summary, data.students, selectedTarget);
        }
    }

    const handleSendTeleReport = async () => {
        const data = await generateSummaryData();
        if (!data || Object.keys(data.summary).length === 0) {
            toast({ title: "Tidak Ada Data", description: "Tidak ada data untuk dikirim." });
            return;
        }
        
        toast({ title: "Memulai Pengiriman...", description: `Mengirim ${Object.keys(data.summary).length} rekap ke orang tua...` });

        for (const studentData of Object.values(data.summary)) {
            await sendMonthlyRecapToParent(studentData, selectedMonth, selectedYear);
        }
        
        if (selectedTarget.startsWith("grade-") || classes.some(c => c.id === selectedTarget)) {
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
                await sendClassMonthlyRecap(className, grade, selectedMonth, selectedYear, data.summary);
            }
        }
        
        toast({ title: "Pengiriman Selesai", description: "Semua notifikasi rekapitulasi telah dikirim." });
    }

    const generateMonthlyPdf = (summary: MonthlySummary, students: Student[], target: string) => {
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
                studentSummary.summary.H,
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

    // --- INDIVIDUAL REPORT LOGIC ---
    const handleGenerateIndividualReport = async () => {
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }
        if (!selectedStudent || !dateRange?.from) {
            toast({ variant: "destructive", title: "Pilihan Tidak Lengkap", description: "Harap pilih siswa dan tentukan rentang tanggal." });
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
                                <Button onClick={handleSendTeleReport} disabled={isGenerating || isLoading || !selectedTarget}>
                                    {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                    {isGenerating ? 'Mengirim...' : 'Kirim Rekap via Telegram'}
                                </Button>
                                <Button onClick={handleGenerateMonthlyReport} disabled={isGenerating || isLoading || !selectedTarget}>
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
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Pilih Siswa</Label>
                                    <ComboBox
                                        options={studentOptions}
                                        value={selectedStudent?.id}
                                        onSelect={(value) => {
                                            const student = allStudents.find(s => s.id === value) || null;
                                            setSelectedStudent(student);
                                        }}
                                        placeholder="Cari nama siswa..."
                                        searchPlaceholder="Ketik nama untuk mencari..."
                                        emptyState="Siswa tidak ditemukan."
                                        disabled={isLoading || allStudents.length === 0}
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
