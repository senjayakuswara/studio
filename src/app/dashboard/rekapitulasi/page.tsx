"use client"

import { useState, useEffect } from "react"
import { collection, query, where, getDocs, Timestamp, doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, getDaysInMonth, startOfMonth, endOfMonth, getYear, getMonth, getDate } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Download, Loader2 } from "lucide-react"
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

// Types
type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
type AttendanceRecord = {
  studentId: string
  status: AttendanceStatus
  recordDate: Timestamp
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
type MonthlySummary = {
    [studentId: string]: {
        studentInfo: Student,
        attendance: { [day: number]: string }, // 'H', 'S', 'I', 'A', 'T', 'D'
        summary: { H: number, T: number, S: number, I: number, A: number, D: number }
    }
}

const years = [getYear(new Date()), getYear(new Date()) - 1, getYear(new Date()) - 2];
const months = Array.from({ length: 12 }, (_, i) => ({
  value: i,
  label: format(new Date(0, i), "MMMM", { locale: localeID }),
}));


export default function RekapitulasiPage() {
    const [selectedTarget, setSelectedTarget] = useState<string>("")
    const [selectedMonth, setSelectedMonth] = useState<number>(getMonth(new Date()))
    const [selectedYear, setSelectedYear] = useState<number>(getYear(new Date()))
    const [classes, setClasses] = useState<Class[]>([])
    const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const { toast } = useToast()

    useEffect(() => {
        async function fetchInitialData() {
            setIsLoading(true);
            try {
                const [classesSnapshot, reportConfigSnap] = await Promise.all([
                    getDocs(collection(db, "classes")),
                    getDoc(doc(db, "settings", "reportConfig"))
                ]);
                
                if (reportConfigSnap.exists()) {
                    setReportConfig(reportConfigSnap.data() as ReportConfig);
                }

                const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
                classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`));
                setClasses(classList);
                
            } catch (error) {
                console.error("Error fetching initial data:", error);
                toast({
                    variant: "destructive",
                    title: "Gagal Memuat Data",
                    description: "Gagal mengambil data kelas atau pengaturan laporan dari server.",
                });
            } finally {
                setIsLoading(false);
            }
        }
        fetchInitialData();
    }, [toast]);

    const handleGenerateMonthlyReport = async () => {
        if (!selectedTarget) {
            toast({ variant: "destructive", title: "Pilih Target Laporan", description: "Anda harus memilih kelas, tingkat, atau semua tingkat terlebih dahulu." });
            return;
        }
        if (!reportConfig) {
            toast({ variant: "destructive", title: "Pengaturan Belum Lengkap", description: "Harap lengkapi pengaturan desain laporan." });
            return;
        }

        setIsGenerating(true);

        try {
            // 1. Get all students based on selected target
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
                 setIsGenerating(false);
                 return;
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
                setIsGenerating(false);
                return;
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

            // 2. Prepare date range for the selected month
            const monthStart = startOfMonth(new Date(selectedYear, selectedMonth));
            const monthEnd = endOfMonth(new Date(selectedYear, selectedMonth));
            
            // 3. Fetch all attendance records for these students within the month
            const studentIds = students.map(s => s.id);
            const attendanceRecords: AttendanceRecord[] = [];
            
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
                attendanceSnapshot.forEach(doc => {
                    attendanceRecords.push(doc.data() as AttendanceRecord);
                });
            }

            // 4. Process data into a monthly summary
            const summary: MonthlySummary = {};
            students.forEach(student => {
                summary[student.id] = {
                    studentInfo: student,
                    attendance: {},
                    summary: { H: 0, T: 0, S: 0, I: 0, A: 0, D: 0 }
                };
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
                if (statusChar) {
                    summary[record.studentId].attendance[day] = statusChar;
                }
            });

            // 5. Generate PDF
            generatePdf(summary, students, selectedTarget);

        } catch (error) {
            console.error("Error generating monthly report:", error);
            toast({
                variant: "destructive",
                title: "Gagal Membuat Laporan",
                description: "Terjadi kesalahan saat mengambil atau memproses data absensi.",
            });
        } finally {
            setIsGenerating(false);
        }
    }

    const generatePdf = (summary: MonthlySummary, students: Student[], target: string) => {
        const doc = new jsPDF({ orientation: "landscape" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageMargin = 15;
        let lastY = 10;
        
        // --- Header ---
        if (reportConfig?.headerImageUrl) {
            try {
                const imgWidth = pageWidth - pageMargin * 2;
                const imgHeight = imgWidth * (150 / 950); // Assuming 950x150 aspect ratio
                doc.addImage(reportConfig.headerImageUrl, 'PNG', pageMargin, 10, imgWidth, imgHeight);
                lastY = 10 + imgHeight + 5;
            } catch (e) {
                lastY = 40;
            }
        } else {
             doc.setFont('helvetica', 'bold');
             doc.setFontSize(14);
             doc.text("Laporan Rekapitulasi Absensi", pageWidth / 2, 20, { align: 'center' });
             lastY = 35;
        }

        // --- Report Title ---
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
        
        // --- Table ---
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
            styles: {
                fontSize: 6,
                cellPadding: 1,
                halign: 'center',
                valign: 'middle'
            },
            headStyles: {
                fillColor: [22, 163, 74],
                textColor: 255,
                halign: 'center'
            },
            columnStyles: {
                0: { halign: 'center', cellWidth: 8 },  // No
                1: { halign: 'left', cellWidth: 35 }, // Nama
                2: { halign: 'center', cellWidth: 18 }, // NISN
                3: { halign: 'left', cellWidth: 15 }, // Kelas
                4: { halign: 'center', cellWidth: 10 }, // Tingkat
            }
        });

        lastY = (doc as any).lastAutoTable.finalY || lastY + 20;

        // --- Footer / Signatory ---
        let signatureY = lastY + 15;
        if (signatureY > doc.internal.pageSize.getHeight() - 60) {
            doc.addPage();
            signatureY = 40;
        }

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
        
        // --- Save PDF ---
        doc.save(`Laporan_Bulanan_${fileNameScope}_${format(new Date(selectedYear, selectedMonth), "MMMM_yyyy")}.pdf`);
    }

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Rekapitulasi & Laporan</h1>
                <p className="text-muted-foreground">Buat laporan rekapitulasi absensi bulanan.</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Laporan Bulanan</CardTitle>
                    <CardDescription>Pilih periode dan target untuk membuat laporan rekapitulasi absensi bulanan.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                             <label className="text-sm font-medium">Bulan</label>
                             <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number(v))} disabled={isLoading}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Bulan" />
                                </SelectTrigger>
                                <SelectContent>
                                    {months.map(month => (
                                        <SelectItem key={month.value} value={month.value.toString()}>{month.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Tahun</label>
                             <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))} disabled={isLoading}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Tahun" />
                                </SelectTrigger>
                                <SelectContent>
                                    {years.map(year => (
                                        <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Target Laporan</label>
                            <Select value={selectedTarget} onValueChange={setSelectedTarget} disabled={isLoading || classes.length === 0}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih Target Laporan" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectLabel>Grup Global</SelectLabel>
                                        <SelectItem value="all-grades">Semua Tingkat</SelectItem>
                                    </SelectGroup>
                                    <SelectGroup>
                                        <SelectLabel>Per Tingkat</SelectLabel>
                                        <SelectItem value="grade-X">Semua Kelas X</SelectItem>
                                        <SelectItem value="grade-XI">Semua Kelas XI</SelectItem>
                                        <SelectItem value="grade-XII">Semua Kelas XII</SelectItem>
                                    </SelectGroup>
                                    {["X", "XI", "XII"].map(grade => (
                                        <SelectGroup key={grade}>
                                            <SelectLabel>Per Kelas - Tingkat {grade}</SelectLabel>
                                            {classes.filter(c => c.grade === grade).map(c => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectGroup>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                     </div>
                     <div className="flex justify-end">
                         <Button onClick={handleGenerateMonthlyReport} disabled={isGenerating || isLoading || !selectedTarget}>
                            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            {isGenerating ? 'Membuat Laporan...' : 'Cetak Laporan Bulanan'}
                        </Button>
                     </div>
                </CardContent>
            </Card>
        </div>
    )
}
