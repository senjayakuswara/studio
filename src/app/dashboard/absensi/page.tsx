
"use client"

import { useState, useEffect, useMemo } from "react"
import { collection, query, where, getDocs, Timestamp, doc, getDoc, updateDoc, writeBatch, setDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { format, startOfDay, endOfDay, setHours, setMinutes, setSeconds } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Calendar as CalendarIcon, Download, Loader2, MoreHorizontal, Users, LogOut } from "lucide-react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"

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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { notifyOnAttendance, type SerializableAttendanceRecord } from "@/ai/flows/notification-flow"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string; parentWaNumber?: string; status: "Aktif" | "Lulus" | "Pindah" }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
type AttendanceRecord = {
  id: string
  studentId: string
  studentName: string
  nisn: string
  classId: string
  status: AttendanceStatus
  timestampMasuk: Timestamp | null
  timestampPulang: Timestamp | null
  notes?: string
  recordDate: Timestamp;
}
type CombinedAttendanceRecord = Partial<AttendanceRecord> & { 
  studentId: string;
  studentName: string;
  nisn: string;
  classId: string;
  classInfo?: Class,
  parentWaNumber?: string;
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

type SchoolHoursSettings = {
  jamMasuk: string
  jamPulang: string
  toleransi: string
}

const attendanceEditSchema = z.object({
  status: z.enum(["Hadir", "Terlambat", "Sakit", "Izin", "Alfa", "Dispen"]),
  jamMasuk: z.string().optional(),
  jamPulang: z.string().optional(),
}).refine(data => {
    if ((data.status === "Hadir" || data.status === "Terlambat") && !data.jamMasuk) {
        return false;
    }
    return true;
}, {
    message: "Jam masuk harus diisi jika status Hadir atau Terlambat.",
    path: ["jamMasuk"],
})

const statusBadgeVariant: Record<AttendanceStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    "Hadir": "default",
    "Terlambat": "destructive",
    "Sakit": "secondary",
    "Izin": "secondary",
    "Alfa": "destructive",
    "Dispen": "secondary",
    "Belum Absen": "outline",
}

const ALL_STATUSES: AttendanceStatus[] = ["Hadir", "Terlambat", "Sakit", "Izin", "Alfa", "Dispen", "Belum Absen"];

export default function AbsensiPage() {
  const [date, setDate] = useState<Date>(new Date())
  const [classes, setClasses] = useState<Class[]>([])
  const [allStudents, setAllStudents] = useState<Student[]>([])
  const [attendanceRecords, setAttendanceRecords] = useState<CombinedAttendanceRecord[]>([])
  const [reportConfig, setReportConfig] = useState<ReportConfig | null>(null)
  const [schoolHours, setSchoolHours] = useState<SchoolHoursSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true)
  const [isPrinting, setIsPrinting] = useState(false)
  const [isMassProcessing, setIsMassProcessing] = useState(false);
  const [filterClass, setFilterClass] = useState("all")
  const [filterName, setFilterName] = useState("")
  const [filterStatus, setFilterStatus] = useState<AttendanceStatus | "all">("all")
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<CombinedAttendanceRecord | null>(null)
  const { toast } = useToast()

  const form = useForm<z.infer<typeof attendanceEditSchema>>({
    resolver: zodResolver(attendanceEditSchema),
  })

  const fetchData = async (selectedDate: Date) => {
    setIsLoading(true)
    try {
      const selectedDateStart = startOfDay(selectedDate)
      const selectedDateEnd = endOfDay(selectedDate)
      
      const [classesSnapshot, reportConfigSnap, studentsSnapshot, schoolHoursSnap] = await Promise.all([
          getDocs(collection(db, "classes")),
          getDoc(doc(db, "settings", "reportConfig")),
          getDocs(query(collection(db, "students"), where("status", "==", "Aktif"))),
          getDoc(doc(db, "settings", "schoolHours")),
      ]);

      if(reportConfigSnap.exists()) {
          setReportConfig(reportConfigSnap.data() as ReportConfig);
      }
      if(schoolHoursSnap.exists()) {
          setSchoolHours(schoolHoursSnap.data() as SchoolHoursSettings);
      }

      const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[]
      classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${a.name}`))
      setClasses(classList)
      const classMap = new Map(classList.map(c => [c.id, c]))

      const studentList = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[];
      setAllStudents(studentList);

      const attendanceQuery = query(
        collection(db, "attendance"),
        where("recordDate", ">=", selectedDateStart),
        where("recordDate", "<=", selectedDateEnd)
      )
      const attendanceSnapshot = await getDocs(attendanceQuery)
      const records = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AttendanceRecord[]
      
      const combinedRecords = records.map(record => {
        const studentInfo = studentList.find(s => s.id === record.studentId);
        return {
          ...record,
          classInfo: classMap.get(record.classId),
          parentWaNumber: studentInfo?.parentWaNumber,
        }
      }).sort((a,b) => {
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

  useEffect(() => {
    fetchData(date)
  }, [date, toast])

  const studentsBelumAbsen = useMemo(() => {
    const studentsWithAttendance = new Set(attendanceRecords.map(rec => rec.studentId));
    return allStudents.filter(student => !studentsWithAttendance.has(student.id))
  }, [allStudents, attendanceRecords]);
  
  const studentsSudahMasukTapiBelumPulang = useMemo(() => {
    return attendanceRecords.filter(rec => rec.timestampMasuk && !rec.timestampPulang);
  }, [attendanceRecords]);

  const studentsInSelectedClassBelumAbsen = useMemo(() => {
    if (filterClass === 'all') return [];
    return studentsBelumAbsen.filter(s => s.classId === filterClass);
  }, [studentsBelumAbsen, filterClass]);

  const studentsInSelectedClassBelumPulang = useMemo(() => {
    if (filterClass === 'all') return [];
    return studentsSudahMasukTapiBelumPulang.filter(rec => rec.classId === filterClass);
  }, [studentsSudahMasukTapiBelumPulang, filterClass]);

  const filteredRecords = useMemo(() => {
    const classMap = new Map(classes.map(c => [c.id, c]));

    const recordsToFilter = filterStatus === 'Belum Absen'
      ? studentsBelumAbsen.map(student => ({
          id: `manual-${student.id}`,
          studentId: student.id,
          nisn: student.nisn,
          studentName: student.nama,
          classId: student.classId,
          status: 'Belum Absen' as AttendanceStatus,
          timestampMasuk: null,
          timestampPulang: null,
          classInfo: classMap.get(student.classId),
          parentWaNumber: student.parentWaNumber,
        }))
      : attendanceRecords;

    return recordsToFilter
      .filter(record => filterClass === "all" || record.classId === filterClass)
      .filter(record => (record.studentName || '').toLowerCase().includes(filterName.toLowerCase()))
      .filter(record => filterStatus === "all" || record.status === filterStatus)
  }, [allStudents, attendanceRecords, studentsBelumAbsen, filterClass, filterName, filterStatus, classes])
  
  const handleMassCheckIn = async () => {
    if (!schoolHours || filterClass === 'all') {
        toast({ variant: "destructive", title: "Gagal", description: "Pengaturan jam sekolah belum diatur atau kelas belum dipilih." });
        return;
    }
    setIsMassProcessing(true);
    const studentsToAttend = studentsInSelectedClassBelumAbsen;
    
    if (studentsToAttend.length === 0) {
        toast({ title: "Informasi", description: "Semua siswa di kelas ini sudah memiliki catatan absensi hari ini." });
        setIsMassProcessing(false);
        return;
    }

    toast({ title: "Memulai Absen Masuk Massal", description: `Memproses ${studentsToAttend.length} siswa... Ini mungkin memakan waktu.` });
    
    let totalSuccessCount = 0;
    let totalFailCount = 0;

    const [hours, minutes] = schoolHours.jamMasuk.split(':').map(Number);
    const entryTime = setSeconds(setMinutes(setHours(date, hours), minutes), 0);
    
    for (const student of studentsToAttend) {
        try {
            const newRecordDocRef = doc(collection(db, "attendance"));
            const newRecord: Omit<AttendanceRecord, 'id'> = {
                studentId: student.id,
                nisn: student.nisn,
                studentName: student.nama,
                classId: student.classId,
                status: "Hadir",
                timestampMasuk: Timestamp.fromDate(entryTime),
                timestampPulang: null,
                notes: "Absensi massal oleh admin",
                recordDate: Timestamp.fromDate(startOfDay(date)),
            };
            await setDoc(newRecordDocRef, newRecord);

            const serializableRecord: SerializableAttendanceRecord = {
                id: newRecordDocRef.id,
                ...newRecord,
                timestampMasuk: newRecord.timestampMasuk?.toDate().toISOString() ?? null,
                timestampPulang: null,
                recordDate: newRecord.recordDate.toDate().toISOString(),
                parentWaNumber: student.parentWaNumber
            };
            
            await notifyOnAttendance(serializableRecord);
            totalSuccessCount++;
        } catch (error) {
            console.error(`Gagal memproses absen masuk untuk ${student.nama}:`, error);
            totalFailCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    let description = `${totalSuccessCount} notifikasi berhasil dijadwalkan.`;
    if (totalFailCount > 0) {
        description += ` ${totalFailCount} gagal karena masalah koneksi/database.`;
    }
    toast({ title: "Proses Absen Masuk Selesai", description });

    await fetchData(date);
    setIsMassProcessing(false);
  };

  const handleMassCheckOut = async () => {
    if (!schoolHours || filterClass === 'all') {
        toast({ variant: "destructive", title: "Gagal", description: "Pengaturan jam sekolah belum diatur atau kelas belum dipilih." });
        return;
    }
    setIsMassProcessing(true);
    const studentsToCheckOut = studentsInSelectedClassBelumPulang;

    if (studentsToCheckOut.length === 0) {
        toast({ title: "Informasi", description: "Tidak ada siswa di kelas ini yang bisa diabsen pulang." });
        setIsMassProcessing(false);
        return;
    }

    toast({ title: "Memulai Absensi Pulang Massal", description: `Memproses ${studentsToCheckOut.length} siswa...` });
    
    let totalSuccessCount = 0;
    let totalFailCount = 0;
    
    const [hours, minutes] = schoolHours.jamPulang.split(':').map(Number);
    const exitTime = setSeconds(setMinutes(setHours(date, hours), minutes), 0);
    
    for (const record of studentsToCheckOut) {
        try {
            if (!record.id) continue;
            const docRef = doc(db, "attendance", record.id);
            await updateDoc(docRef, { timestampPulang: Timestamp.fromDate(exitTime) });

            const serializableRecord: SerializableAttendanceRecord = {
                ...record,
                id: record.id,
                studentName: record.studentName!,
                timestampMasuk: record.timestampMasuk?.toDate().toISOString() ?? null,
                timestampPulang: exitTime.toISOString(),
                recordDate: (record.recordDate as Timestamp).toDate().toISOString(),
            };
            await notifyOnAttendance(serializableRecord);
            totalSuccessCount++;
        } catch (error) {
            console.error(`Gagal memproses absen pulang untuk ${record.studentName}:`, error);
            totalFailCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    let description = `${totalSuccessCount} notifikasi pulang berhasil dijadwalkan.`;
    if (totalFailCount > 0) {
        description += ` ${totalFailCount} gagal.`;
    }
    toast({ title: "Proses Absen Pulang Selesai", description });

    await fetchData(date);
    setIsMassProcessing(false);
  };

  const openEditDialog = (record: CombinedAttendanceRecord) => {
    if (!record.id || record.status === 'Belum Absen') {
      toast({
        variant: "destructive",
        title: "Aksi Tidak Diizinkan",
        description: "Status 'Belum Absen' tidak bisa diedit. Harap lakukan absensi manual dari halaman E-Absensi.",
      });
      return;
    }
    setEditingRecord(record);
    const formatTimestampToTime = (ts: Timestamp | null | undefined) => {
        if (!ts) return "";
        return format(ts.toDate(), "HH:mm");
    }
    form.reset({
      status: record.status as any,
      jamMasuk: formatTimestampToTime(record.timestampMasuk),
      jamPulang: formatTimestampToTime(record.timestampPulang),
    })
    setIsFormDialogOpen(true)
  }

  const handleSaveAttendance = async (values: z.infer<typeof attendanceEditSchema>) => {
    if (!editingRecord || !editingRecord.id) return
    setIsLoading(true);
    try {
        const { status, jamMasuk, jamPulang } = values;
        const docRef = doc(db, "attendance", editingRecord.id);

        const updatePayload: { [key: string]: any } = {};
        const recordDate = startOfDay(date);

        if (["Sakit", "Izin", "Alfa", "Dispen"].includes(status)) {
            updatePayload.timestampMasuk = null;
            updatePayload.timestampPulang = null;
            updatePayload.status = status;
        } else {
            const [hMasuk, mMasuk] = jamMasuk!.split(':').map(Number);
            const newTimestampMasuk = Timestamp.fromDate(setMinutes(setHours(recordDate, hMasuk), mMasuk));
            updatePayload.timestampMasuk = newTimestampMasuk;

            if (schoolHours) {
                const [shHours, shMinutes] = schoolHours.jamMasuk.split(':').map(Number);
                const deadlineTime = setMinutes(setHours(recordDate, shHours), shMinutes + parseInt(schoolHours.toleransi));
                updatePayload.status = newTimestampMasuk.toDate() > deadlineTime ? "Terlambat" : "Hadir";
            } else {
                updatePayload.status = status; // Fallback
            }

            if (jamPulang) {
                const [hPulang, mPulang] = jamPulang.split(':').map(Number);
                updatePayload.timestampPulang = Timestamp.fromDate(setMinutes(setHours(recordDate, hPulang), mPulang));
            } else {
                updatePayload.timestampPulang = null;
            }
        }
        
        await updateDoc(docRef, updatePayload);
        
        toast({ title: "Sukses", description: "Data absensi berhasil diperbarui." });
        await fetchData(date);
        setIsFormDialogOpen(false)

    } catch (error) {
      console.error("Error updating attendance:", error)
      toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Terjadi kesalahan saat menyimpan data." })
    } finally {
        setIsLoading(false);
    }
  }

  const handlePrintReport = () => {
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
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageMargin = 15;
      let lastY = 10;
      
      const recordsToPrint = [...filteredRecords].sort((a, b) => {
        const timeA = a.timestampMasuk?.toMillis() || Infinity;
        const timeB = b.timestampMasuk?.toMillis() || Infinity;
        if (timeA !== timeB) return timeA - timeB;
        return a.studentName.localeCompare(b.studentName);
      });

      if (reportConfig.headerImageUrl) {
          try {
              const imgWidth = pageWidth - pageMargin * 2;
              const imgHeight = imgWidth * (150 / 950);
              doc.addImage(reportConfig.headerImageUrl, 'PNG', pageMargin, 10, imgWidth, imgHeight);
              lastY = 10 + imgHeight + 5;
          } catch (e) {
              console.error("Could not add header image", e);
              toast({ variant: "destructive", title: "Gagal Memuat Kop Surat", description: "Pastikan gambar kop surat valid." });
              lastY = 40;
          }
      } else {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text("Laporan Absensi", pageWidth / 2, 20, { align: 'center' });
        doc.setLineWidth(0.5);
        doc.line(pageMargin, 25, pageWidth - pageMargin, 25);
        lastY = 35;
      }
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(reportConfig.reportTitle || "Laporan Absensi", pageWidth / 2, lastY, { align: 'center' });
      lastY += 6;

      doc.setFontSize(11);
      doc.text(`Tanggal: ${format(date, "dd MMMM yyyy", { locale: localeID })}`, pageWidth / 2, lastY, { align: 'center' });
      lastY += 10;
      
      if (recordsToPrint.length > 0) {
        const tableData = recordsToPrint.map((record) => [
          format(date, "dd/MM/yyyy"),
          record.studentName,
          record.nisn,
          record.classInfo?.name || 'N/A',
          record.classInfo?.grade || 'N/A',
          record.timestampMasuk ? format(record.timestampMasuk.toDate(), "HH:mm:ss") : "-",
          record.timestampPulang ? format(record.timestampPulang.toDate(), "HH:mm:ss") : "-",
          record.status || 'Belum Absen',
        ]);
        
        autoTable(doc, {
          startY: lastY,
          head: [['Tanggal', 'Nama Siswa', 'NISN', 'Kelas', 'Tingkat', 'Masuk', 'Pulang', 'Status']],
          body: tableData,
          theme: 'grid',
          headStyles: { fillColor: [22, 163, 74], textColor: 255 },
          styles: { cellPadding: 2, fontSize: 8 },
          margin: { left: pageMargin, right: pageMargin }
        });

        lastY = (doc as any).lastAutoTable.finalY || lastY + 20;
      } else {
        doc.setFontSize(10);
        doc.text("Tidak ada data absensi untuk ditampilkan berdasarkan filter yang dipilih.", pageWidth / 2, lastY + 10, { align: 'center' });
        lastY = lastY + 20;
      }

      let signatureY = lastY + 15;
      
      if (signatureY > doc.internal.pageSize.getHeight() - 60) {
          doc.addPage();
          signatureY = 40;
      }

      const leftX = pageWidth / 4;
      const rightX = (pageWidth / 4) * 3;

      doc.setFontSize(10);
      doc.setFont('times', 'normal');

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
      
      doc.save(`Laporan_Absensi_Harian_${format(date, "yyyy-MM-dd")}.pdf`);

    } catch (error) {
      console.error("Error generating PDF:", error);
      toast({
        variant: "destructive",
        title: "Gagal Membuat PDF",
        description: "Terjadi kesalahan saat membuat laporan. Pastikan format kop surat valid.",
      });
    } finally {
      setIsPrinting(false);
    }
  };
  
  const statusValue = form.watch("status");

  return (
    <>
      <Dialog open={isFormDialogOpen} onOpenChange={setIsFormDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Absensi</DialogTitle>
            <DialogDescription>
              Ubah status dan waktu absensi untuk siswa <span className="font-semibold">{editingRecord?.studentName}</span>.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSaveAttendance)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status Kehadiran</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                          <SelectItem value="Hadir">Hadir</SelectItem>
                          <SelectItem value="Terlambat">Terlambat</SelectItem>
                          <SelectItem value="Sakit">Sakit</SelectItem>
                          <SelectItem value="Izin">Izin</SelectItem>
                          <SelectItem value="Alfa">Alfa</SelectItem>
                          <SelectItem value="Dispen">Dispen</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {(statusValue === "Hadir" || statusValue === "Terlambat") && (
                <>
                  <FormField
                    control={form.control}
                    name="jamMasuk"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jam Masuk</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="jamPulang"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Jam Pulang (Opsional)</FormLabel>
                        <FormControl>
                          <Input type="time" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan Perubahan
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    
      <div className="flex flex-col gap-6">
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Absensi</h1>
                        <p className="text-muted-foreground">Lacak dan kelola data absensi harian siswa.</p>
                    </div>
                     <Button variant="outline" className="w-full md:w-auto" onClick={handlePrintReport} disabled={isPrinting || isLoading}>
                        {isPrinting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        {isPrinting ? 'Mencetak...' : 'Cetak Laporan Harian'}
                    </Button>
                </div>
            </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data Absensi - {format(date, "eeee, dd MMMM yyyy", { locale: localeID })}</CardTitle>
            <CardDescription>
              Menampilkan {filteredRecords.length} dari {attendanceRecords.length + studentsBelumAbsen.length} total catatan harian. Gunakan filter untuk mencari data.
            </CardDescription>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Popover>
                    <PopoverTrigger asChild>
                    <Button
                        variant={"outline"}
                        className={cn(
                        "w-full justify-start text-left font-normal",
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
                    <SelectTrigger className="w-full">
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
                    <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as AttendanceStatus | "all")}>
                    <SelectTrigger className="w-full">
                    <SelectValue placeholder="Filter berdasarkan status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Semua Status</SelectItem>
                        {ALL_STATUSES.map(status => (
                            <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                    <Input
                    placeholder="Cari berdasarkan nama siswa..."
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    className="w-full"
                />
            </div>
             <div className="mt-4 flex flex-col md:flex-row gap-2">
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="secondary" className="w-full md:w-auto" disabled={isMassProcessing || isLoading || filterClass === 'all' || studentsInSelectedClassBelumAbsen.length === 0}>
                            {isMassProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                            {isMassProcessing ? 'Memproses...' : `Absen Masuk Massal (${studentsInSelectedClassBelumAbsen.length})`}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Konfirmasi Absen Masuk Massal</AlertDialogTitle>
                            <AlertDialogDescription>
                                Anda akan menandai {studentsInSelectedClassBelumAbsen.length} siswa di kelas <span className="font-bold">{classes.find(c => c.id === filterClass)?.name}</span> sebagai 'Hadir' dan mengirim notifikasi. Lanjutkan?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={handleMassCheckIn}>Ya, Lanjutkan</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                    <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="secondary" className="w-full md:w-auto" disabled={isMassProcessing || isLoading || filterClass === 'all' || studentsInSelectedClassBelumPulang.length === 0}>
                            {isMassProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                            {isMassProcessing ? 'Memproses...' : `Absen Pulang Massal (${studentsInSelectedClassBelumPulang.length})`}
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Konfirmasi Absen Pulang Massal</AlertDialogTitle>
                            <AlertDialogDescription>
                                Anda akan mencatat jam pulang untuk {studentsInSelectedClassBelumPulang.length} siswa di kelas <span className="font-bold">{classes.find(c => c.id === filterClass)?.name}</span> dan mengirim notifikasi. Lanjutkan?
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction onClick={handleMassCheckOut}>Ya, Lanjutkan</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
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
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : filteredRecords.length > 0 ? (
                    filteredRecords.map((record) => (
                      <TableRow key={record.studentId}>
                        <TableCell>{record.nisn}</TableCell>
                        <TableCell className="font-medium">{record.studentName}</TableCell>
                        <TableCell>{record.classInfo?.name || 'N/A'}</TableCell>
                         <TableCell>
                            <Badge variant={statusBadgeVariant[record.status || 'Belum Absen'] || "outline"}>
                              {record.status || 'Belum Absen'}
                            </Badge>
                         </TableCell>
                        <TableCell className="font-mono">
                          {record.timestampMasuk ? format(record.timestampMasuk.toDate(), "HH:mm:ss") : " - "}
                        </TableCell>
                        <TableCell className="font-mono">
                          {record.timestampPulang ? format(record.timestampPulang.toDate(), "HH:mm:ss") : " - "}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" className="h-8 w-8 p-0">
                                      <span className="sr-only">Buka menu</span>
                                      <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                  <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                                  <DropdownMenuItem onClick={() => openEditDialog(record)} disabled={record.status === 'Belum Absen'}>
                                      Edit
                                  </DropdownMenuItem>
                              </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        Tidak ada data absensi untuk tanggal ini atau siswa tidak ditemukan.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
