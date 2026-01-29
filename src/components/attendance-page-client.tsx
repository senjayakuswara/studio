
"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { collection, query, where, getDocs, addDoc, doc, getDoc, Timestamp, updateDoc } from "firebase/firestore"
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
import { MoreHorizontal, Info, ScanLine, Loader2, User, XCircle, CheckCircle2 } from "lucide-react"
import { format, startOfDay, endOfDay } from "date-fns"
import { cn } from "@/lib/utils"
import { notifyOnAttendance, type SerializableAttendanceRecord } from "@/ai/flows/notification-flow"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { 
    id: string; 
    nisn: string; 
    nama: string; 
    classId: string, 
    grade: string, 
    jenisKelamin: "Laki-laki" | "Perempuan", 
    status?: "Aktif" | "Lulus" | "Pindah",
    parentWaNumber?: string,
}
type SchoolHoursSettings = { jamMasuk: string; toleransi: string; jamPulang: string }
type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen" | "Belum Absen"
type AttendanceRecord = {
  id?: string
  studentId: string
  nisn: string
  studentName: string
  classId: string
  status: AttendanceStatus
  timestampMasuk: Timestamp | null
  timestampPulang: Timestamp | null
  recordDate: Timestamp
  notes?: string
}
type LogMessage = {
    timestamp: string
    message: string
    type: 'success' | 'error' | 'info' | 'warning'
}
type FeedbackOverlayState = {
    show: boolean;
    type: 'loading' | 'success' | 'error' | 'info';
    student?: Student;
    message?: string;
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
    const [isProcessing, setIsProcessing] = useState(false);
    const [highlightedNisn, setHighlightedNisn] = useState<{ nisn: string; type: "success" | "error" } | null>(null);
    const [feedbackOverlay, setFeedbackOverlay] = useState<FeedbackOverlayState>({ show: false, type: 'loading' });
    
    const recentlyScanned = useRef(new Set<string>());
    const processingLock = useRef(false);
    const scannerInputRef = useRef<HTMLInputElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const { toast } = useToast()

    const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
    
    const sortedStudents = useMemo(() => {
        return [...allStudents].sort((a, b) => a.nama.localeCompare(b.nama));
    }, [allStudents]);

    const addLog = useCallback((message: string, type: LogMessage['type']) => {
        const newLog: LogMessage = {
            timestamp: format(new Date(), "HH:mm:ss"),
            message,
            type
        };
        setLogMessages(prev => [newLog, ...prev].slice(0, 50));
    }, [])

    const getAttendanceRecord = useCallback((studentId: string): Partial<AttendanceRecord> => {
        return attendanceData[studentId] || {};
    }, [attendanceData]);

    useEffect(() => {
        if (!isProcessing) {
            scannerInputRef.current?.focus();
        }
    }, [isProcessing]);
    
    const playSound = useCallback(async (type: 'success' | 'error') => {
        try {
            if (!audioContextRef.current) {
                // @ts-ignore
                audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const audioContext = audioContextRef.current;
            if (!audioContext) {
                console.warn("Web Audio API is not supported.");
                return;
            }

            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            if (type === 'success') {
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            } else {
                oscillator.type = 'square';
                oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
                gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.3);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.3);
            }
        } catch (e) {
            console.error("Could not play sound due to an error:", e);
            addLog("Gagal memutar suara notifikasi.", "warning");
        }
    }, [addLog]);

    useEffect(() => {
        async function fetchData() {
            setIsLoading(true)
            try {
                const classQuery = query(collection(db, "classes"), where("grade", "==", grade))
                const classSnapshot = await getDocs(classQuery)
                const classList = classSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[]
                classList.sort((a, b) => a.name.localeCompare(b.name));
                setClasses(classList)

                const localClassMap = new Map(classList.map(c => [c.id, c]));

                const hoursDocRef = doc(db, "settings", "schoolHours");
                const hoursDocSnap = await getDoc(hoursDocRef);
                if (hoursDocSnap.exists()) {
                    setSchoolHours(hoursDocSnap.data() as SchoolHoursSettings);
                } else {
                    addLog("Pengaturan jam sekolah belum diatur.", "error")
                    toast({ variant: "destructive", title: "Pengaturan Jam Tidak Ditemukan" });
                }
                
                if (classList.length > 0) {
                    const studentQuery = query(collection(db, "students"), where("classId", "in", classList.map(c => c.id)), where("status", "==", "Aktif"));
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
                                where("recordDate", ">=", todayStart),
                                where("recordDate", "<=", todayEnd)
                            );
                            const attendanceSnapshot = await getDocs(attendanceQuery);
                            attendanceSnapshot.forEach(doc => {
                                const data = doc.data() as Omit<AttendanceRecord, 'id'>;
                                initialAttendanceData[data.studentId] = {
                                    id: doc.id,
                                    ...data,
                                } as AttendanceRecord;
                            });
                        }
                        setAttendanceData(initialAttendanceData);
                    }
                }

            } catch (error) {
                console.error("Error fetching data:", error);
                addLog("Gagal memuat data dari server.", "error")
                toast({
                    variant: "destructive",
                    title: "Gagal Memuat Data",
                })
            } finally {
                setIsLoading(false)
            }
        }
        fetchData();
    }, [grade, toast, addLog])
    
    const handleScan = useCallback(async (nisn: string) => {
        const trimmedNisn = nisn.trim();
        if (!trimmedNisn || processingLock.current || recentlyScanned.current.has(trimmedNisn)) return;
        
        processingLock.current = true;
        setIsProcessing(true);
        setFeedbackOverlay({ show: true, type: 'loading' });
        if (scannerInputRef.current) scannerInputRef.current.value = "";
    
        const cleanup = (type: FeedbackOverlayState['type'], student?: Student, message?: string) => {
            setFeedbackOverlay({ show: true, type, student, message });
            setTimeout(() => {
                setHighlightedNisn(null);
                setFeedbackOverlay({ show: false, type: 'loading' });
                processingLock.current = false;
                setIsProcessing(false);
            }, 2500);
        };
        
        let student: Student | undefined;
        try {
            if (!schoolHours) {
                throw new Error("Pengaturan jam sekolah belum dimuat.");
            }
    
            student = allStudents.find(s => s.nisn === trimmedNisn);
    
            if (!student) {
                throw new Error(`Siswa dengan NISN ${trimmedNisn} tidak ditemukan di tingkat ini.`);
            }
    
            const existingRecord = attendanceData[student.id];
            const now = new Date();
            const [pulangHours, pulangMinutes] = schoolHours.jamPulang.split(':').map(Number);
            const jamPulangTime = new Date();
            jamPulangTime.setHours(pulangHours, pulangMinutes, 0, 0);
    
            if (existingRecord && existingRecord.timestampMasuk && !existingRecord.timestampPulang && now < jamPulangTime) {
                throw new Error("Siswa sudah tercatat absen masuk hari ini.");
            }
            if (existingRecord && existingRecord.timestampPulang) {
                throw new Error("Siswa sudah tercatat absen masuk dan pulang hari ini.");
            }
            if (student.grade !== grade) {
                throw new Error(`Siswa salah ruang absen. Seharusnya di Kelas ${student.grade}.`);
            }
            if (existingRecord && ["Sakit", "Izin", "Alfa", "Dispen"].includes(existingRecord.status)) {
                throw new Error(`Siswa berstatus ${existingRecord.status}. Tidak bisa melakukan absensi.`);
            }
    
            recentlyScanned.current.add(student.nisn);
            setTimeout(() => { recentlyScanned.current.delete(student.nisn); }, 3000); 
    
            let tempRecordForDb: Omit<AttendanceRecord, 'id'> & { id?: string };
            let isAbsenMasuk = false;

            if (!existingRecord || !existingRecord.timestampMasuk) {
                isAbsenMasuk = true;
                if (now > jamPulangTime) {
                    throw new Error("Waktu absen masuk sudah berakhir.");
                }
    
                const [masukHours, masukMinutes] = schoolHours.jamMasuk.split(':').map(Number);
                const deadline = new Date();
                deadline.setHours(masukHours, masukMinutes + parseInt(schoolHours.toleransi, 10), 0, 0);
                const status: AttendanceStatus = now > deadline ? "Terlambat" : "Hadir";
                
                tempRecordForDb = {
                    studentId: student.id, nisn: student.nisn, studentName: student.nama, classId: student.classId,
                    status,
                    timestampMasuk: Timestamp.fromDate(now), timestampPulang: null,
                    recordDate: Timestamp.fromDate(startOfDay(now)),
                };
            } else if (!existingRecord.timestampPulang) {
                tempRecordForDb = { ...existingRecord, timestampPulang: Timestamp.fromDate(now) };
            } else {
                throw new Error("Siswa sudah tercatat absen penuh.");
            }
    
            let docId = existingRecord?.id;
            if (isAbsenMasuk) {
                if(docId) {
                    await updateDoc(doc(db, "attendance", docId), tempRecordForDb as any);
                } else {
                    const docRef = await addDoc(collection(db, "attendance"), tempRecordForDb);
                    docId = docRef.id;
                }
            } else if (docId) {
                 await updateDoc(doc(db, "attendance", docId), { timestampPulang: tempRecordForDb.timestampPulang });
            }

            const finalRecord = { ...tempRecordForDb, id: docId } as AttendanceRecord;
            setAttendanceData(prev => ({...prev, [student.id]: finalRecord }));
            
            const logMessage = `Absen ${isAbsenMasuk ? 'Masuk' : 'Pulang'}: ${student.nama} berhasil.`;
            addLog(logMessage, 'success');
            setHighlightedNisn({ nisn: student.nisn, type: 'success' });
            
            await playSound('success');
            
            cleanup('success', student, isAbsenMasuk ? `Absen Masuk: ${finalRecord.status}` : 'Absen Pulang');
            
            // Send notification after successful scan
            const serializableRecord: SerializableAttendanceRecord = {
                ...finalRecord,
                studentName: student.nama,
                timestampMasuk: finalRecord.timestampMasuk?.toDate().toISOString() ?? null,
                timestampPulang: finalRecord.timestampPulang?.toDate().toISOString() ?? null,
                recordDate: finalRecord.recordDate.toDate().toISOString(),
            };
            await notifyOnAttendance(serializableRecord);

        } catch (error: any) {
            const errorMessage = error.message || "Terjadi kesalahan sistem.";
            addLog(`${student ? student.nama + ': ' : ''}${errorMessage}`, 'error');
            setHighlightedNisn({ nisn: trimmedNisn, type: 'error' });
            await playSound('error');
            toast({
                variant: "destructive",
                title: "Absensi Gagal",
                description: errorMessage,
            })
            cleanup('error', student, errorMessage);
        }
    }, [schoolHours, allStudents, grade, attendanceData, addLog, playSound, toast]);

    const handleManualAttendance = async (studentId: string, status: AttendanceStatus) => {
        const student = allStudents.find(s => s.id === studentId);
        if (!student) return;

        const now = new Date();
        const existingRecord = attendanceData[studentId];
        
        const payload: Omit<AttendanceRecord, 'id' | 'timestampPulang'> & { timestampPulang: Timestamp | null } = {
            studentId: student.id, nisn: student.nisn, studentName: student.nama, classId: student.classId,
            status,
            timestampMasuk: null,
            timestampPulang: null,
            recordDate: existingRecord?.recordDate || Timestamp.fromDate(startOfDay(now)),
            notes: `Manual input: ${status}`,
        };

        try {
            let docId = existingRecord?.id;
            if (docId) {
                await updateDoc(doc(db, "attendance", docId), payload as any);
            } else {
                const docRef = await addDoc(collection(db, "attendance"), payload);
                docId = docRef.id;
            }

            const newRecord = { ...payload, id: docId } as AttendanceRecord;
            setAttendanceData(prev => ({ ...prev, [student.id]: newRecord }));
            addLog(`Manual: ${student.nama} ditandai ${status}.`, 'info');
            
            // Send notification for manual status change
            const serializableRecord: SerializableAttendanceRecord = {
                ...newRecord,
                studentName: student.nama,
                timestampMasuk: newRecord.timestampMasuk?.toDate().toISOString() ?? null,
                timestampPulang: newRecord.timestampPulang?.toDate().toISOString() ?? null,
                recordDate: newRecord.recordDate.toDate().toISOString(),
            };
            await notifyOnAttendance(serializableRecord);

        } catch (error: any) {
            console.error("Error updating manual attendance: ", error);
            addLog(`Gagal menyimpan absensi manual untuk ${student.nama}.`, 'error');
            toast({
                variant: "destructive",
                title: "Gagal Menyimpan Manual",
                description: error.message || "Terjadi kesalahan saat menyimpan data.",
            })
        }
    }

    const renderFeedbackIcon = () => {
        switch (feedbackOverlay.type) {
            case 'loading': return <Loader2 className="h-32 w-32 animate-spin text-white" />;
            case 'error': return <XCircle className="h-32 w-32 text-red-400" />;
            case 'info': return <Info className="h-32 w-32 text-blue-400" />;
            case 'success': return <User className="h-32 w-32 text-green-300" />;
            default: return null;
        }
    };

    return (
    <>
    {feedbackOverlay.show && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="p-8 rounded-full bg-white/10">
                {renderFeedbackIcon()}
            </div>
            {feedbackOverlay.student && (
                <h2 className="mt-4 text-4xl font-bold text-white drop-shadow-lg">{feedbackOverlay.student.nama}</h2>
            )}
             {feedbackOverlay.message && (
                <p className="mt-2 text-2xl text-white drop-shadow-md">{feedbackOverlay.message}</p>
            )}
        </div>
    )}
    <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div>
            <h1 className="font-headline text-3xl font-bold tracking-tight">E-Absensi Kelas {grade}</h1>
            <p className="text-muted-foreground">Fokuskan kursor pada kolom input untuk menggunakan pemindai barcode USB.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ScanLine />Input Pindai / Manual</CardTitle>
                </CardHeader>
                <CardContent>
                    <Input
                        ref={scannerInputRef}
                        id={`nisn-input-${grade}`}
                        placeholder={isLoading ? "Memuat data..." : "Pindai NISN atau ketik lalu tekan Enter..."}
                        disabled={isLoading || isProcessing}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleScan(e.currentTarget.value);
                            }
                        }}
                        autoFocus
                    />
                     <p className="text-xs text-muted-foreground mt-2">Sistem siap untuk pemindaian. Tidak perlu klik apapun.</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Log Aktivitas</CardTitle>
                    <CardDescription>Catatan pemindaian hari ini.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[125px] overflow-y-auto rounded-md border p-2 space-y-2">
                        {logMessages.length > 0 ? (
                            logMessages.map((log, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm">
                                    <span className="font-mono text-xs text-muted-foreground pt-0.5">{log.timestamp}</span>
                                    {log.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />}
                                    {log.type === 'error' && <XCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />}
                                    {log.type === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />}
                                    <span className="flex-1">{log.message}</span>
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
            <div className="border rounded-md max-h-[600px] overflow-y-auto">
                    <Table>
                    <TableHeader className="sticky top-0 bg-background">
                        <TableRow>
                        <TableHead className="w-[120px]">NISN</TableHead>
                        <TableHead>Nama Siswa</TableHead>
                        <TableHead>Kelas</TableHead>
                        <TableHead className="w-[120px] text-center">Status</TableHead>
                        <TableHead className="w-[120px] text-center">Jam Masuk</TableHead>
                        <TableHead className="w-[120px] text-center">Jam Pulang</TableHead>
                        <TableHead className="w-[50px] text-right">Aksi</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                        [...Array(10)].map((_, i) => (
                            <TableRow key={i}>
                                <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                            </TableRow>
                        ))
                        ) : sortedStudents.length > 0 ? (
                            sortedStudents.map((student) => {
                                const record = getAttendanceRecord(student.id);
                                const studentClass = classMap.get(student.classId);
                                const status = record.status || 'Belum Absen';
                                return (
                                    <TableRow 
                                      key={student.id} 
                                      data-status={status}
                                      className={cn({
                                          'animate-flash-success': highlightedNisn?.nisn === student.nisn && highlightedNisn?.type === 'success',
                                          'animate-flash-error': highlightedNisn?.nisn === student.nisn && highlightedNisn?.type === 'error',
                                      })}
                                    >
                                        <TableCell>{student.nisn}</TableCell>
                                        <TableCell className="font-medium">{student.nama}</TableCell>
                                        <TableCell>{studentClass?.name || 'N/A'}</TableCell>
                                        <TableCell className="text-center">
                                            <Badge variant={status ? statusBadgeVariant[status] : "outline"}>{status}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center font-mono">
                                            {record.timestampMasuk ? format(record.timestampMasuk.toDate(), "HH:mm:ss") : "--:--:--"}
                                        </TableCell>
                                        <TableCell className="text-center font-mono">
                                            {record.timestampPulang ? format(record.timestampPulang.toDate(), "HH:mm:ss") : "--:--:--"}
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
                                <TableCell colSpan={7} className="h-24 text-center">
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
    </>
  )
}

    