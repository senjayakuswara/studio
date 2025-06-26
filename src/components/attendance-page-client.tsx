"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { collection, query, where, getDocs, addDoc, doc, getDoc, Timestamp } from "firebase/firestore"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { MoreHorizontal, Activity, ShieldAlert, CheckCircle2, Clock, Info, BookUser } from "lucide-react"
import { format, startOfDay, endOfDay } from "date-fns"
import { id as localeID } from "date-fns/locale"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string, grade: string }
type SchoolHoursSettings = { jamMasuk: string; toleransi: string; jamPulang: string }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
type AttendanceRecord = {
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
    const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
    const [attendanceData, setAttendanceData] = useState<Record<string, AttendanceRecord>>({})
    const [logMessages, setLogMessages] = useState<LogMessage[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const scannerInputRef = useRef<HTMLInputElement>(null)
    const { toast } = useToast()

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

                const classMap = new Map(classList.map(c => [c.id, c]));

                // Fetch school hours settings
                const hoursDocRef = doc(db, "settings", "schoolHours");
                const hoursDocSnap = await getDoc(hoursDocRef);
                if (hoursDocSnap.exists()) {
                    setSchoolHours(hoursDocSnap.data() as SchoolHoursSettings);
                } else {
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
                            grade: classMap.get(data.classId)?.grade || 'N/A'
                        } as Student;
                    });
                    setAllStudents(studentList);

                    // Fetch today's attendance records for these students
                    const studentIds = studentList.map(s => s.id);
                    if (studentIds.length > 0) {
                        const todayStart = startOfDay(new Date());
                        const todayEnd = endOfDay(new Date());
                        const attendanceQuery = query(
                            collection(db, "attendance"),
                            where("studentId", "in", studentIds),
                            where("timestamp", ">=", todayStart),
                            where("timestamp", "<=", todayEnd)
                        );
                        const attendanceSnapshot = await getDocs(attendanceQuery);
                        const initialAttendanceData: Record<string, AttendanceRecord> = {};
                        attendanceSnapshot.forEach(doc => {
                            const data = doc.data();
                            initialAttendanceData[data.studentId] = {
                                status: data.status,
                                timestamp: data.timestamp,
                                notes: data.notes
                            };
                        });
                        setAttendanceData(initialAttendanceData);
                    }
                }

            } catch (error) {
                console.error("Error fetching data:", error)
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
        // Auto-focus on the scanner input when a class is selected
        if (selectedClassId) {
            setTimeout(() => scannerInputRef.current?.focus(), 100);
        }
    }, [selectedClassId]);

    const addLog = (message: string, type: LogMessage['type']) => {
        const newLog: LogMessage = {
            timestamp: format(new Date(), "HH:mm:ss"),
            message,
            type
        };
        setLogMessages(prev => [newLog, ...prev]);
    }

    const handleScan = async (nisn: string) => {
        if (!nisn.trim() || !schoolHours) {
            return;
        }

        const student = allStudents.find(s => s.nisn === nisn.trim());

        if (!student) {
            addLog(`NISN ${nisn} tidak ditemukan.`, 'error');
            toast({ variant: "destructive", title: "Siswa Tidak Ditemukan" });
            return;
        }
        
        if (student.grade !== grade) {
            addLog(`Siswa ${student.nama} (${student.grade}) salah ruang absen.`, 'error');
            toast({
                variant: "destructive",
                title: "Salah Ruang Absen!",
                description: `Siswa ini dari Kelas ${student.grade}. Harap absen di ruangan yang benar.`
            });
            return;
        }

        if (attendanceData[student.id]) {
            addLog(`Siswa ${student.nama} sudah melakukan absensi hari ini.`, 'info');
            toast({ title: "Sudah Absen", description: `${student.nama} sudah tercatat absen hari ini.`});
            return;
        }
        
        const now = new Date();
        const [hours, minutes] = schoolHours.jamMasuk.split(':').map(Number);
        const deadline = new Date();
        deadline.setHours(hours, minutes + parseInt(schoolHours.toleransi, 10), 0, 0);

        const status: AttendanceStatus = now > deadline ? "Terlambat" : "Hadir";

        try {
            const newRecord = {
                studentId: student.id,
                nisn: student.nisn,
                studentName: student.nama,
                classId: student.classId,
                status: status,
                timestamp: Timestamp.fromDate(now),
            }
            await addDoc(collection(db, "attendance"), newRecord)
            
            setAttendanceData(prev => ({
                ...prev,
                [student.id]: { status, timestamp: newRecord.timestamp }
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
        const student = filteredStudents.find(s => s.id === studentId);
        if (!student) return;

        // For now, this only updates the UI state.
        // TODO: Save to Firestore and send notifications.
        const now = new Date();
        const newRecord = {
            studentId: student.id,
            nisn: student.nisn,
            studentName: student.nama,
            classId: student.classId,
            status: status,
            timestamp: Timestamp.fromDate(now),
        }

        try {
             // Check if a record for today already exists
            const todayStart = startOfDay(new Date());
            const todayEnd = endOfDay(new Date());
            const attendanceQuery = query(
                collection(db, "attendance"),
                where("studentId", "==", studentId),
                where("timestamp", ">=", todayStart),
                where("timestamp", "<=", todayEnd)
            );
            const querySnapshot = await getDocs(attendanceQuery);

            if (!querySnapshot.empty) {
                // Update the existing document
                const docId = querySnapshot.docs[0].id;
                await doc(db, "attendance", docId).set(newRecord, { merge: true });
            } else {
                // Add a new document
                await addDoc(collection(db, "attendance"), newRecord);
            }

            setAttendanceData(prev => ({
                ...prev,
                [student.id]: { status, timestamp: newRecord.timestamp }
            }));
            addLog(`Manual: ${student.nama} ditandai ${status}.`, 'info');
            toast({ title: "Status Diperbarui", description: `${student.nama} ditandai sebagai ${status}.` });
        } catch (error) {
            console.error("Error updating manual attendance: ", error);
            addLog(`Gagal menyimpan absensi manual untuk ${student.nama}.`, 'error');
            toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Terjadi kesalahan pada database." });
        }
    }

    const filteredStudents = useMemo(() => {
        if (!selectedClassId) return []
        return allStudents
          .filter(student => student.classId === selectedClassId)
          .sort((a, b) => a.nama.localeCompare(b.nama))
    }, [allStudents, selectedClassId])

    const selectedClassName = useMemo(() => {
        if (!selectedClassId) return ""
        return classes.find(c => c.id === selectedClassId)?.name || ""
    }, [classes, selectedClassId])

    const getStudentStatus = (studentId: string): AttendanceRecord => {
        return attendanceData[studentId] || { status: 'Belum Absen', timestamp: Timestamp.now() };
    }

  return (
    <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div>
            <h1 className="font-headline text-3xl font-bold tracking-tight">E-Absensi Kelas {grade}</h1>
            <p className="text-muted-foreground">Pilih kelas untuk memulai sesi absensi.</p>
            </div>
            {classes.length > 0 && (
            <Select onValueChange={setSelectedClassId} disabled={isLoading}>
                <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Pilih Kelas" />
                </SelectTrigger>
                <SelectContent>
                {classes.map(cls => (
                    <SelectItem key={cls.id} value={cls.id}>
                    {cls.name}
                    </SelectItem>
                ))}
                </SelectContent>
            </Select>
            )}
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
                        placeholder={selectedClassId ? "Arahkan pemindai barcode..." : "Pilih kelas terlebih dahulu"}
                        disabled={!selectedClassId || isLoading}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleScan(e.currentTarget.value);
                                e.currentTarget.value = "";
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
                                    <span className="font-mono text-muted-foreground">{log.timestamp}</span>
                                    {log.type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                                    {log.type === 'error' && <ShieldAlert className="h-4 w-4 text-red-500" />}
                                    {log.type === 'info' && <Info className="h-4 w-4 text-blue-500" />}
                                    <span className="flex-1 truncate">{log.message}</span>
                                </div>
                            ))
                        ) : (
                             <div className="flex items-center justify-center h-full text-muted-foreground">
                                Belum ada aktivitas.
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
      
        <Card>
            <CardHeader>
            <CardTitle>Daftar Siswa {selectedClassName && `- ${selectedClassName}`}</CardTitle>
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
                            </TableRow>
                        ))
                        ) : selectedClassId ? (
                        filteredStudents.length > 0 ? (
                            filteredStudents.map((student) => {
                                const { status, timestamp } = getStudentStatus(student.id);
                                return (
                                    <TableRow key={student.id} data-status={status}>
                                        <TableCell>{student.nisn}</TableCell>
                                        <TableCell className="font-medium">{student.nama}</TableCell>
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
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Sakit')}>Tandai Sakit</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Izin')}>Tandai Izin</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Dispen')}>Tandai Dispen</DropdownMenuItem>
                                                    <DropdownMenuItem onClick={() => handleManualAttendance(student.id, 'Alfa')} className="text-destructive">Tandai Alfa</DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        ) : (
                            <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">
                                Tidak ada siswa di kelas ini.
                            </TableCell>
                            </TableRow>
                        )
                        ) : (
                        <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">
                                Silakan pilih kelas terlebih dahulu untuk memulai.
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
