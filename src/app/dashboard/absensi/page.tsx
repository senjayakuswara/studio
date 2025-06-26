"use client"

import { useState, useEffect, useMemo } from "react"
import { collection, query, where, getDocs, Timestamp, doc, getDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, startOfDay, endOfDay } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Calendar as CalendarIcon, Download, Loader2 } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

// Types
type Class = { id: string; name: string; grade: string }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
type AttendanceRecord = {
  id: string
  studentId: string
  studentName: string
  nisn: string
  classId: string
  status: AttendanceStatus
  timestampMasuk: Timestamp | null
  timestampPulang: Timestamp | null
}
type CombinedAttendanceRecord = AttendanceRecord & { classInfo?: Class }
type ReportConfig = {
    title: string;
    signatoryName: string;
    signatoryNpa: string;
    logoUrl: string | null;
}

const statusBadgeVariant: Record<AttendanceStatus, 'default' | 'destructive' | 'secondary'> = {
    "Hadir": "default",
    "Terlambat": "destructive",
    "Sakit": "secondary",
    "Izin": "secondary",
    "Alfa": "destructive",
    "Dispen": "secondary",
}

export default function AbsensiPage() {
  const [date, setDate] = useState<Date>(new Date())
  const [classes, setClasses] = useState<Class[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<CombinedAttendanceRecord[]>([])
  const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPrinting, setIsPrinting] = useState(false)
  const [filterClass, setFilterClass] = useState("all")
  const { toast } = useToast()

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true)
      try {
        const selectedDateStart = startOfDay(date)
        const selectedDateEnd = endOfDay(date)
        
        const [classesSnapshot, reportConfigSnap] = await Promise.all([
            getDocs(collection(db, "classes")),
            getDoc(doc(db, "settings", "reportConfig"))
        ]);

        if(reportConfigSnap.exists()) {
            setReportConfig(reportConfigSnap.data() as ReportConfig);
        }

        // Fetch classes
        const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[]
        classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`))
        setClasses(classList)
        const classMap = new Map(classList.map(c => [c.id, c]))

        // Fetch attendance records for the selected date
        const attendanceQuery = query(
          collection(db, "attendance"),
          where("recordDate", ">=", selectedDateStart),
          where("recordDate", "<=", selectedDateEnd)
        )
        const attendanceSnapshot = await getDocs(attendanceQuery)
        const records = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AttendanceRecord[]
        
        const combinedRecords = records.map(record => ({
          ...record,
          classInfo: classMap.get(record.classId)
        })).sort((a,b) => {
            const classA = a.classInfo ? `${a.classInfo.grade}-${a.classInfo.name}` : ''
            const classB = b.classInfo ? `${b.classInfo.grade}-${b.classInfo.name}` : ''
            if (classA !== classB) return classA.localeCompare(classB);
            return a.studentName.localeCompare(b.studentName);
        })

        setAttendanceRecords(combinedRecords)

      } catch (error) {
        console.error("Error fetching attendance data:", error)
        toast({
          variant: "destructive",
          title: "Gagal Memuat Data",
          description: "Gagal mengambil data absensi dari server.",
        })
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [date, toast])

  const filteredRecords = useMemo(() => {
    if (filterClass === "all") {
      return attendanceRecords
    }
    return attendanceRecords.filter(record => record.classId === filterClass)
  }, [attendanceRecords, filterClass])

  const handlePrintReport = () => {
    if (filteredRecords.length === 0) {
      toast({
        variant: "destructive",
        title: "Tidak Ada Data",
        description: "Tidak ada data untuk dicetak pada tanggal dan kelas yang dipilih.",
      });
      return;
    }

    if (!reportConfig) {
      toast({
        variant: "destructive",
        title: "Pengaturan Belum Lengkap",
        description: "Harap lengkapi pengaturan desain laporan terlebih dahulu.",
      });
      return;
    }

    setIsPrinting(true);
    try {
      const doc = new jsPDF();
      const tableData = filteredRecords.map((record, index) => [
        index + 1,
        record.nisn,
        record.studentName,
        `${record.classInfo?.name || 'N/A'} (${record.classInfo?.grade || 'N/A'})`,
        record.status,
        record.timestampMasuk ? format(record.timestampMasuk.toDate(), "HH:mm:ss") : "-",
        record.timestampPulang ? format(record.timestampPulang.toDate(), "HH:mm:ss") : "-",
      ]);
      
      const pageWidth = doc.internal.pageSize.getWidth();

      // Header
      if (reportConfig.logoUrl) {
        doc.addImage(reportConfig.logoUrl, 'PNG', 15, 10, 20, 20);
      }
      doc.setFontSize(14);
      doc.text(reportConfig.title.split('\n'), pageWidth / 2, 15, { align: 'center' });
      
      doc.setFontSize(11);
      const reportDate = `Tanggal: ${format(date, "dd MMMM yyyy", { locale: localeID })}`;
      doc.text(reportDate, pageWidth / 2, 30, { align: 'center' });

      // Table
      autoTable(doc, {
        startY: 38,
        head: [['No', 'NISN', 'Nama Siswa', 'Kelas', 'Status', 'Jam Masuk', 'Jam Pulang']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        styles: { cellPadding: 2, fontSize: 8 },
      });

      // Footer (Titimangsa)
      const finalY = (doc as any).lastAutoTable.finalY || 60;
      const signatureX = pageWidth - 65;
      let signatureY = finalY + 15;
      
      if (signatureY > doc.internal.pageSize.getHeight() - 40) {
          doc.addPage();
          signatureY = 20;
      }

      doc.setFontSize(10);
      doc.text("Naringgul, " + format(new Date(), "dd MMMM yyyy", { locale: localeID }), signatureX, signatureY, { align: 'center' });
      doc.text("Petugas,", signatureX, signatureY + 6, { align: 'center' });
      doc.text(reportConfig.signatoryName, signatureX, signatureY + 28, { align: 'center' });
      doc.text(reportConfig.signatoryNpa, signatureX, signatureY + 34, { align: 'center' });
      
      // Save PDF
      doc.save(`Laporan_Absensi_Harian_${format(date, "yyyy-MM-dd")}.pdf`);

    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        variant: "destructive",
        title: "Gagal Membuat PDF",
        description: "Terjadi kesalahan saat membuat laporan. Pastikan format logo valid.",
      });
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Absensi</h1>
          <p className="text-muted-foreground">Lacak dan kelola data absensi harian siswa.</p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal md:w-[240px]",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP", { locale: localeID }) : <span>Pilih tanggal</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  disabled={(d) => d > new Date() || d < new Date("2024-01-01")}
                />
              </PopoverContent>
            </Popover>
            <Select value={filterClass} onValueChange={setFilterClass}>
              <SelectTrigger className="w-full md:w-[280px]">
                <SelectValue placeholder="Filter berdasarkan kelas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Kelas</SelectItem>
                {["X", "XI", "XII"].map(grade => (
                  <SelectGroup key={grade}>
                    <SelectLabel>Kelas {grade}</SelectLabel>
                    {classes.filter(c => c.grade === grade).map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="w-full md:w-auto" onClick={handlePrintReport} disabled={isPrinting || isLoading}>
                {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {isPrinting ? 'Mencetak...' : 'Cetak Laporan Harian'}
            </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Data Absensi - {format(date, "eeee, dd MMMM yyyy", { locale: localeID })}</CardTitle>
          <CardDescription>
            Menampilkan {filteredRecords.length} dari {attendanceRecords.length} catatan absensi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NISN</TableHead>
                  <TableHead>Nama Siswa</TableHead>
                  <TableHead>Kelas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Jam Masuk</TableHead>
                  <TableHead>Jam Pulang</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredRecords.length > 0 ? (
                  filteredRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell>{record.nisn}</TableCell>
                      <TableCell className="font-medium">{record.studentName}</TableCell>
                      <TableCell>{record.classInfo?.name || 'N/A'} ({record.classInfo?.grade || 'N/A'})</TableCell>
                       <TableCell>
                          <Badge variant={statusBadgeVariant[record.status] || "outline"}>
                            {record.status}
                          </Badge>
                       </TableCell>
                      <TableCell className="font-mono">
                        {record.timestampMasuk ? format(record.timestampMasuk.toDate(), "HH:mm:ss") : " - "}
                      </TableCell>
                      <TableCell className="font-mono">
                        {record.timestampPulang ? format(record.timestampPulang.toDate(), "HH:mm:ss") : " - "}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      Tidak ada data absensi untuk tanggal ini.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
