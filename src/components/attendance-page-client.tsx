"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { collection, query, where, getDocs, addDoc, doc, getDoc, Timestamp, writeBatch } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, ShieldAlert, CheckCircle2, Info } from "lucide-react"
import { format, startOfDay, endOfDay } from "date-fns"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string, grade: string }
type SchoolHoursSettings = { jamMasuk: string; toleransi: string; jamPulang: string }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
type AttendanceRecord = {
  id?: string
  status: AttendanceStatus
  timestamp: Timestamp
  notes?: string
}
type LogMessage = {
    timestamp: string
    message: string
    type: 'success' | 'error' | 'info'
}

type AttendancePageClientProps = {
  grade: "X" | "XI" | "XII"
}

const statusBadgeVariant: Record<AttendanceStatus, 'default' | 'destructive' | 'secondary' | 'outline'> = {
    "Hadir": "default",
    "Terlambat": "destructive",
    "Sakit": "secondary",
    "Izin": "secondary",
    "Alfa": "destructive",
    "Dispen": "secondary",
    "Belum Absen": "outline",
}

export function AttendancePageClient({ grade }: AttendancePageClientProps) {
    const [classes, setClasses] = useState<Class[]>([])
    const [allStudents, setAllStudents] = useState<Student[]>([])
    const [schoolHours, setSchoolHours] = useState<SchoolHoursSettings | null>(null)
    const [attendanceData, setAttendanceData] = useState<Record<string, AttendanceRecord>>({})
    const [logMessages, setLogMessages] = useState<LogMessage[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const scannerInputRef = useRef<HTMLInputElement>(null)
    const { toast } = useToast()

    const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);

    useEffect(() => {
        async function fetchData() {
            setIsLoading(true)
            try {
                // Fetch classes for the specific grade
                const classQuery = query(collection(db, "classes"), where("grade", "==", grade))
                const classSnapshot = await getDocs(classQuery)
                const classList = classSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[]
                classList.sort((a, b) => a.name.localeCompare(b.name));
                setClasses(classList)

                const localClassMap = new Map(classList.map(c => [c.id, c]));

                // Fetch school hours settings
                const hoursDocRef = doc(db, "settings", "schoolHours");
                const hoursDocSnap = await getDoc(hoursDocRef);
                if (hoursDocSnap.exists()) {
                    setSchoolHours(hoursDocSnap.data() as SchoolHoursSettings);
                } else {
                    addLog("Pengaturan jam sekolah belum diatur.", "error")
                    toast({ variant: "destructive", title: "Pengaturan Jam Tidak Ditemukan", description: "Harap atur jam sekolah terlebih dahulu di menu pengaturan." });
                }
                
                // Fetch students if classes exist
                if (classList.length > 0) {
                    const studentQuery = query(collection(db, "students"), where("classId", "in", classList.map(c => c.id)));
                    const studentSnapshot = await getDocs(studentQuery);
                    const studentList = studentSnapshot.docs.map(doc => {
                        const data = doc.data();
                        return { 
                            id: doc.id,
                            ...data,
                            grade: localClassMap.get(data.classId)?.grade || 'N/A'
                        } as Student;
                    });
                    setAllStudents(studentList);

                    // Fetch today's attendance records for these students
                    const studentIds = studentList.map(s => s.id);
                    if (studentIds.length > 0) {
                        const todayStart = startOfDay(new Date());
                        const todayEnd = endOfDay(new Date());
                        const chunks = [];
                        for (let i = 0; i < studentIds.length; i += 30) {
                            chunks.push(studentIds.slice(i, i + 30));
                        }

                        const initialAttendanceData: Record<string, AttendanceRecord> = {};

                        for (const chunk of chunks) {
                             const attendanceQuery = query(
                                collection(db, "attendance"),
                                where("studentId", "in", chunk),
                                where("timestamp", ">=", todayStart),
                                where("timestamp", "<=", todayEnd)
                            );
                            const attendanceSnapshot = await getDocs(attendanceQuery);
                            attendanceSnapshot.forEach(doc => {
                                const data = doc.data();
                                initialAttendanceData[data.studentId] = {
                                    id: doc.id,
                                    status: data.status,
                                    timestamp: data.timestamp,
                                    notes: data.notes
                                };
                            });
                        }
                        setAttendanceData(initialAttendanceData);
                    }
                }

            } catch (error) {
                console.error("Error fetching data:", error)
                addLog("Gagal memuat data dari server.", "error")
                toast({
                    variant: "destructive",
                    title: "Gagal Memuat Data",
                    description: "Gagal mengambil data dari server. Periksa koneksi dan coba lagi.",
                })
            } finally {
                setIsLoading(false)
            }
        }
        fetchData()
    }, [grade, toast])
    
    useEffect(() => {
        // Auto-focus on the scanner input when data is ready
        if (!isLoading) {
            setTimeout(() => scannerInputRef.current?.focus(), 100);
        }
    }, [isLoading]);

    const addLog = (message: string, type: LogMessage['type']) => {
        const newLog: LogMessage = {
            timestamp: format(new Date(), "HH:mm:ss"),
            message,
            type
        };
        setLogMessages(prev => [newLog, ...prev].slice(0, 50)); // Keep last 50 logs
    }

    const handleScan = async (nisn: string) => {
        if (!nisn.trim()) return;

        if (!schoolHours) {
            addLog("Error: Pengaturan jam belum dimuat.", "error");
            toast({ variant: "destructive", title: "Pengaturan Jam Belum Siap", description: "Tunggu sebentar hingga pengaturan jam berhasil dimuat." });
            return;
        }

        const student = allStudents.find(s => s.nisn === nisn.trim());

        if (!student) {
            addLog(`NISN ${nisn} tidak ditemukan di tingkat ini.`, 'error');
            toast({ variant: "destructive", title: "Siswa Tidak Ditemukan" });
            return;
        }
        
        if (student.grade !== grade) {
            const studentClass = classMap.get(student.classId)
            addLog(`Siswa ${student.nama} (${studentClass?.name} - ${student.grade}) salah ruang absen.`, 'error');
            toast({
                variant: "destructive",
                title: "Salah Ruang Absen!",
                description: `Siswa ini dari Kelas ${student.grade}. Harap absen di ruangan yang benar.`
            });
            return;
        }

        if (attendanceData[student.id]) {
            addLog(`Siswa ${student.nama} sudah absen hari ini.`, 'info');
            toast({ title: "Sudah Absen", description: `${student.nama} sudah tercatat absen hari ini.`});
            return;
        }
        
        const now = new Date();
        const [hours, minutes] = schoolHours.jamMasuk.split(':').map(Number);
        const deadline = new Date();
        deadline.setHours(hours, minutes + parseInt(schoolHours.toleransi, 10), 0, 0);

        const status: AttendanceStatus = now > deadline ? "Terlambat" : "Hadir";
        const newTimestamp = Timestamp.fromDate(now);

        try {
            const newRecord = {
                studentId: student.id,
                nisn: student.nisn,
                studentName: student.nama,
                classId: student.classId,
                status: status,
                timestamp: newTimestamp,
            }
            const docRef = await addDoc(collection(db, "attendance"), newRecord)
            
            setAttendanceData(prev => ({
                ...prev,
                [student.id]: { id: docRef.id, status, timestamp: newTimestamp }
            }));
            
            addLog(`Berhasil: ${student.nama} (${student.nisn}) tercatat ${status}.`, 'success');
            toast({ title: "Absen Berhasil", description: `${student.nama} tercatat ${status}.` });

        } catch (error) {
            console.error("Error saving attendance: ", error);
            addLog(`Gagal menyimpan absensi untuk ${student.nama}.`, 'error');
            toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Terjadi kesalahan pada database." });
        } finally {
            if (scannerInputRef.current) scannerInputRef.current.value = "";
        }
    }

    const handleManualAttendance = async (studentId: string, status: AttendanceStatus) => {
        const student = allStudents.find(s => s.id === studentId);
        if (!student) return;

        const now = new Date();
        const newTimestamp = Timestamp.fromDate(now);
        const newRecordPayload = {
            studentId: student.id,
            nisn: student.nisn,
            studentName: student.nama,
            classId: student.classId,
            status: status,
            timestamp: newTimestamp,
        }

        try {
            const existingRecord = attendanceData[student.id];
            
            if (existingRecord?.id) {
                // Update the existing document
                const docRef = doc(db, "attendance", existingRecord.id);
                await writeBatch(db).update(docRef, newRecordPayload).commit();
            } else {
                // Add a new document
                const docRef = await addDoc(collection(db, "attendance"), newRecordPayload);
                existingRecord.id = docRef.id;
            }

            setAttendanceData(prev => ({
                ...prev,
                [student.id]: { ...prev[student.id], status, timestamp: newTimestamp }
            }));

            addLog(`Manual: ${student.nama} ditandai ${status}.`, 'info');
            toast({ title: "Status Diperbarui", description: `${student.nama} ditandai sebagai ${status}.` });
        } catch (error) {
            console.error("Error updating manual attendance: ", error);
            addLog(`Gagal menyimpan absensi manual untuk ${student.nama}.`, 'error');
            toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Terjadi kesalahan pada database." });
        }
    }

    const sortedStudents = useMemo(() => {
       return [...allStudents].sort((a, b) => {
            const classA = classMap.get(a.classId)?.name || '';
            const classB = classMap.get(b.classId)?.name || '';
            if (classA < classB) return -1;
            if (classA > classB) return 1;
            return a.nama.localeCompare(b.nama);
        })
    }, [allStudents, classMap]);

    const getStudentStatus = (studentId: string): AttendanceRecord => {
        return attendanceData[studentId] || { status: 'Belum Absen', timestamp: Timestamp.now() };
    }

  return (
    <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div>
            <h1 className="font-headline text-3xl font-bold tracking-tight">E-Absensi Kelas {grade}</h1>
            <p className="text-muted-foreground">Pindai barcode siswa untuk mencatat kehadiran.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Pemindai Barcode / QR Code</CardTitle>
                    <CardDescription>
                        Gunakan pemindai USB untuk memasukkan NISN siswa.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Input
                        ref={scannerInputRef}
                        placeholder={isLoading ? "Memuat data siswa..." : "Arahkan pemindai barcode..."}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleScan(e.currentTarget.value);
                            }
                        }}
                    />
                </CardContent>
            </Card>

             <Card>
                <CardHeader>
                    <CardTitle>Log Aktivitas</CardTitle>
                    <CardDescription>Catatan pemindaian absensi hari ini.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-24 overflow-y-auto rounded-md border p-2 space-y-2">
                        {logMessages.length > 0 ? (
                            logMessages.map((log, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm">
                                    <span className="font-mono text-xs text-muted-foreground">{log.timestamp}</span>
                                    {log.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                                    {log.type === 'error' && <ShieldAlert className="h-4 w-4 shrink-0 text-red-500" />}
                                    {log.type === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-500" />}
                                    <span className="flex-1 truncate">{log.message}</span>
                                </div>
                            ))
                        ) : (
                             <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                                Belum ada aktivitas.
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
      
        <Card>
            <CardHeader>
            <CardTitle>Daftar Hadir Siswa Kelas {grade}</CardTitle>
            <CardDescription>
                Daftar absensi akan diperbarui secara otomatis setelah pemindaian.
            </CardDescription>
            </CardHeader>
            <CardContent>
            <div className="border rounded-md">
                    <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead className="w-[150px]">NISN</TableHead>
                        <TableHead>Nama Siswa</TableHead>
                        <TableHead>Kelas</TableHead>
                        <TableHead className="w-[150px] text-center">Status</TableHead>
                        <TableHead className="w-[150px] text-center">Jam Absen</TableHead>
                        <TableHead className="w-[50px] text-right">Aksi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                        [...Array(5)].map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                            </TableRow>
                        ))
                        ) : sortedStudents.length > 0 ? (
                            sortedStudents.map((student) => {
                                const { status, timestamp } = getStudentStatus(student.id);
                                const studentClass = classMap.get(student.classId);
                                return (
                                    <TableRow key={student.id} data-status={status}>
                                        <TableCell>{student.nisn}</TableCell>
                                        <TableCell className="font-medium">{student.nama}</TableCell>
                                        <TableCell>{studentClass?.name || 'N/A'}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={statusBadgeVariant[status]}>{status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center font-mono">
                                            {status !== 'Belum Absen' ? format(timestamp.toDate(), "HH:mm:ss") : "--:--:--"}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <span className="sr-only">Aksi Manual</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Sakit')}>Tandai Sakit</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Izin')}>Tandai Izin</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Dispen')}>Tandai Dispen</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Alfa')} className="text-destructive focus:text-destructive">Tandai Alfa</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        ) : (
                            <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center">
                                    Tidak ada siswa terdaftar untuk Kelas {grade}.
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
