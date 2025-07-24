
"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { collection, query, where, getDocs, addDoc, doc, getDoc, Timestamp, updateDoc } from "firebase/firestore"
import { Html5Qrcode } from "html5-qrcode"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { notifyOnAttendance, type SerializableAttendanceRecord } from "@/ai/flows/notification-flow"
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
import { MoreHorizontal, ShieldAlert, CheckCircle2, Info, Camera, ScanLine, Loader2, Video, VideoOff, User, XCircle, MessageSquareWarning } from "lucide-react"
import { format, startOfDay, endOfDay } from "date-fns"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { cn } from "@/lib/utils"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string, grade: string, jenisKelamin: "Laki-laki" | "Perempuan", parentWaNumber?: string }
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
  parentWaNumber?: string
}
type LogMessage = {
    timestamp: string
    message: string
    type: 'success' | 'error' | 'info' | 'warning'
}
type FeedbackOverlayState = {
    show: boolean;
    type: 'loading' | 'success' | 'error';
    student?: Student;
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
    const [isCameraInitializing, setIsCameraInitializing] = useState(false);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [highlightedNisn, setHighlightedNisn] = useState<{ nisn: string; type: "success" | "error" | "warning" } | null>(null);
    const [feedbackOverlay, setFeedbackOverlay] = useState<FeedbackOverlayState>({ show: false, type: 'loading' });
    
    const processingLock = useRef(false);
    const scannerInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const scannerContainerId = `qr-reader-${grade.toLowerCase()}`;
    const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
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
        // This effect ensures the input is focused whenever processing is finished
        if (!isProcessing) {
            scannerInputRef.current?.focus();
        }
    }, [isProcessing]);

    const playSound = useCallback((type: 'success' | 'error' | 'warning') => {
        try {
            const soundFile = type === 'success' ? '/sounds/success.wav' : type === 'warning' ? '/sounds/warning.wav' : '/sounds/error.wav';
            const audio = new Audio(soundFile);
            audio.play().catch(e => console.error("Error playing sound:", e));
        } catch(e) {
            console.error("Could not play sound:", e);
        }
    }, []);

    const serializableRecordForNotification = (record: AttendanceRecord, photoDataUri?: string): SerializableAttendanceRecord => {
        return {
            id: record.id ?? undefined,
            studentId: record.studentId,
            nisn: record.nisn,
            studentName: record.studentName,
            classId: record.classId,
            status: record.status as any, // Cast because AttendanceStatus includes "Belum Absen"
            timestampMasuk: record.timestampMasuk?.toDate().toISOString() ?? null,
            timestampPulang: record.timestampPulang?.toDate().toISOString() ?? null,
            recordDate: record.recordDate.toDate().toISOString(),
            parentWaNumber: record.parentWaNumber,
            photoDataUri: photoDataUri
        }
    }

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
                    toast({ variant: "destructive", title: "Pengaturan Jam Tidak Ditemukan", description: "Harap atur jam sekolah terlebih dahulu di menu pengaturan." });
                }
                
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
                                const studentInfo = studentList.find(s => s.id === data.studentId);
                                initialAttendanceData[data.studentId] = {
                                    id: doc.id,
                                    ...data,
                                    parentWaNumber: studentInfo?.parentWaNumber
                                } as AttendanceRecord;
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
    }, [grade, toast, addLog])
    
    useEffect(() => {
        const scanner = new Html5Qrcode(scannerContainerId, { verbose: false });
        html5QrCodeRef.current = scanner;

        return () => {
            if (scanner?.isScanning) {
                scanner.stop().catch(err => {
                    console.error("Failed to stop QR scanner on component unmount.", err);
                });
            }
        };
    }, [scannerContainerId]);

    const handleScan = useCallback(async (nisn: string) => {
        const trimmedNisn = nisn.trim();
        if (!trimmedNisn || processingLock.current) return;
        
        processingLock.current = true;
        setIsProcessing(true);
        setFeedbackOverlay({ show: true, type: 'loading' });
        if (scannerInputRef.current) scannerInputRef.current.value = "";

        const cleanup = (type: FeedbackOverlayState['type'], student?: Student) => {
            setFeedbackOverlay({ show: true, type, student });
            setTimeout(() => {
                setHighlightedNisn(null);
                setFeedbackOverlay({ show: false, type: 'loading' });
                processingLock.current = false;
                setIsProcessing(false);
            }, 1500);
        };

        try {
            if (!schoolHours) {
                addLog("Error: Pengaturan jam belum dimuat.", "error");
                toast({ variant: "destructive", title: "Pengaturan Jam Belum Siap" });
                playSound('error');
                cleanup('error');
                return;
            }
    
            const student = allStudents.find(s => s.nisn === trimmedNisn);
    
            if (!student) {
                addLog(`NISN ${trimmedNisn} tidak ditemukan di tingkat ini.`, 'error');
                setHighlightedNisn({ nisn: trimmedNisn, type: 'error' });
                toast({ variant: "destructive", title: "Siswa Tidak Ditemukan" });
                playSound('error');
                cleanup('error');
                return;
            }
            
            if (student.grade !== grade) {
                const studentClass = classMap.get(student.classId)
                addLog(`Siswa ${student.nama} (${studentClass?.name} - ${student.grade}) salah ruang absen.`, 'error');
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                toast({ variant: "destructive", title: "Salah Ruang Absen!", description: `Siswa ini dari Kelas ${student.grade}.` });
                playSound('error');
                cleanup('error', student);
                return;
            }
    
            const existingRecord = attendanceData[student.id];
            const now = new Date();
    
            if (existingRecord && ["Sakit", "Izin", "Alfa", "Dispen"].includes(existingRecord.status)) {
                addLog(`Siswa ${student.nama} berstatus ${existingRecord.status}. Tidak bisa absen.`, "error");
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                toast({ variant: "destructive", title: "Aksi Diblokir", description: `Status siswa adalah ${existingRecord.status}.` });
                playSound('error');
                cleanup('error', student);
                return;
            }
    
            const [pulangHours, pulangMinutes] = schoolHours.jamPulang.split(':').map(Number);
            const jamPulangTime = new Date();
            jamPulangTime.setHours(pulangHours, pulangMinutes, 0, 0);
    
            let tempRecordForDb: Omit<AttendanceRecord, 'id'> & { id?: string };
            let isAbsenMasuk = false;

            if (!existingRecord || !existingRecord.timestampMasuk) {
                isAbsenMasuk = true;
                 if (now > jamPulangTime) {
                    addLog(`Waktu absen masuk sudah berakhir untuk ${student.nama}.`, 'error');
                    setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                    toast({ variant: "destructive", title: "Absen Masuk Gagal", description: "Sudah melewati jam pulang sekolah." });
                    playSound('error');
                    cleanup('error', student);
                    return;
                }
    
                const [masukHours, masukMinutes] = schoolHours.jamMasuk.split(':').map(Number);
                const deadline = new Date();
                deadline.setHours(masukHours, masukMinutes + parseInt(schoolHours.toleransi, 10), 0, 0);
                const status: AttendanceStatus = now > deadline ? "Terlambat" : "Hadir";
                
                tempRecordForDb = {
                    studentId: student.id, nisn: student.nisn, studentName: student.nama, classId: student.classId,
                    parentWaNumber: student.parentWaNumber, status,
                    timestampMasuk: Timestamp.fromDate(now), timestampPulang: null,
                    recordDate: Timestamp.fromDate(startOfDay(now)),
                };
            } 
            else if (!existingRecord.timestampPulang) {
                if (now < jamPulangTime) {
                    addLog(`Belum waktunya absen pulang untuk ${student.nama}.`, 'error');
                    setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                    toast({ variant: "destructive", title: "Absen Pulang Gagal", description: `Jam pulang adalah pukul ${schoolHours.jamPulang}.` });
                    playSound('error');
                    cleanup('error', student);
                    return;
                }
                 tempRecordForDb = { ...existingRecord, timestampPulang: Timestamp.fromDate(now) };
            } else {
                addLog(`Siswa ${student.nama} sudah absen masuk dan pulang.`, 'info');
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                toast({ title: "Sudah Lengkap", description: "Siswa sudah tercatat absen masuk dan pulang hari ini." });
                playSound('error');
                cleanup('error', student);
                return;
            }
            
            let photoDataUri: string | undefined = undefined;
            if (isCameraActive && videoRef.current && canvasRef.current) {
                const video = videoRef.current;
                const canvas = canvasRef.current;
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const context = canvas.getContext('2d');
                if (context) {
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    photoDataUri = canvas.toDataURL('image/jpeg');
                }
            }

            let notificationFailed = false;
            try {
                await notifyOnAttendance(serializableRecordForNotification(tempRecordForDb as AttendanceRecord, photoDataUri));
            } catch (error) {
                 notificationFailed = true;
            }

            let docId = existingRecord?.id;
            if (isAbsenMasuk) {
                if(docId) {
                    await updateDoc(doc(db, "attendance", docId), tempRecordForDb as any);
                } else {
                    const docRef = await addDoc(collection(db, "attendance"), tempRecordForDb);
                    docId = docRef.id;
                }
            } else {
                 await updateDoc(doc(db, "attendance", docId!), { timestampPulang: tempRecordForDb.timestampPulang });
            }

            const finalRecord = { ...tempRecordForDb, id: docId };
            setAttendanceData(prev => ({...prev, [student.id]: finalRecord as AttendanceRecord }));
            
            if (notificationFailed) {
                addLog(`Absen ${isAbsenMasuk ? 'Masuk' : 'Pulang'} ${student.nama} BERHASIL, tapi notifikasi GAGAL & diantrekan.`, 'warning');
                setHighlightedNisn({ nisn: student.nisn, type: 'warning' });
                toast({ 
                    variant: "destructive",
                    title: `Absen Sukses, Notifikasi Gagal`,
                    description: `Notifikasi untuk ${student.nama} telah dimasukkan ke antrean. Periksa di menu Pengaturan.`,
                });
                playSound('warning');
            } else {
                addLog(`Absen ${isAbsenMasuk ? 'Masuk' : 'Pulang'}: ${student.nama} berhasil.`, 'success');
                setHighlightedNisn({ nisn: student.nisn, type: 'success' });
                toast({ title: `Absen ${isAbsenMasuk ? 'Masuk' : 'Pulang'} Berhasil` });
                playSound('success');
            }
            
            cleanup('success', student);


        } catch (error) {
            console.error("Error handling scan:", error);
            addLog(`Gagal memproses NISN ${trimmedNisn}.`, 'error');
            setHighlightedNisn({ nisn: trimmedNisn, type: 'error' });
            toast({ variant: "destructive", title: "Proses Gagal", description: "Terjadi kesalahan saat memproses absensi." });
            playSound('error');
            cleanup('error');
        }
    }, [schoolHours, allStudents, grade, classMap, attendanceData, addLog, toast, playSound, isCameraActive]);
    
    const stopScanner = useCallback(async () => {
        if (!html5QrCodeRef.current?.isScanning) return;

        try {
            await html5QrCodeRef.current.stop();
            addLog("Kamera dinonaktifkan.", "info");
            setIsCameraActive(false);
            setCameraError(null);
            if (videoRef.current) videoRef.current.srcObject = null;
        } catch (err) {
            console.warn("Gagal menghentikan pemindai dengan bersih.", err);
            setIsCameraActive(false);
        }
    }, [addLog]);

    const startScanner = useCallback(async () => {
        if (isCameraActive || isCameraInitializing || !html5QrCodeRef.current) return;

        setIsCameraInitializing(true);
        setCameraError(null);
        
        try {
            await html5QrCodeRef.current.start(
                { facingMode: "user" },
                { fps: 5, qrbox: { width: 250, height: 250 } },
                (decodedText) => handleScan(decodedText),
                (errorMessage) => { /* ignore scan failure */ }
            );

            // Assign the video stream to our visible video element for photo capture
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }

            setIsCameraInitializing(false);
            setIsCameraActive(true);
            addLog("Kamera berhasil diaktifkan.", "success");
        } catch (err: any) {
            const errorMessage = err?.message || 'Gagal memulai kamera.';
            setCameraError(errorMessage);
            setIsCameraInitializing(false);
            setIsCameraActive(false);
            addLog(`Error kamera: ${errorMessage}`, "error");
            toast({
                variant: 'destructive',
                title: 'Gagal Mengakses Kamera',
                description: 'Harap izinkan akses kamera di pengaturan browser Anda dan coba lagi.'
            });
        }
    }, [isCameraActive, isCameraInitializing, addLog, handleScan, toast]);
    

    const handleManualAttendance = async (studentId: string, status: AttendanceStatus) => {
        const student = allStudents.find(s => s.id === studentId);
        if (!student) return;

        const now = new Date();
        const existingRecord = attendanceData[studentId];
        
        const payload: Omit<AttendanceRecord, 'id' | 'timestampPulang'> & { timestampPulang: Timestamp | null } = {
            studentId: student.id, nisn: student.nisn, studentName: student.nama, classId: student.classId,
            parentWaNumber: student.parentWaNumber,
            status,
            timestampMasuk: null,
            timestampPulang: null,
            recordDate: existingRecord?.recordDate || Timestamp.fromDate(startOfDay(now)),
            notes: `Manual input: ${status}`
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
            toast({ title: "Status Diperbarui", description: `${student.nama} ditandai sebagai ${status}.` });

        } catch (error) {
            console.error("Error updating manual attendance: ", error);
            addLog(`Gagal menyimpan absensi manual untuk ${student.nama}.`, 'error');
            toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Terjadi kesalahan saat menyimpan data." });
        }
    }

    const renderFeedbackIcon = () => {
        if (feedbackOverlay.type === 'loading') {
            return <Loader2 className="h-32 w-32 animate-spin text-white" />;
        }
        if (feedbackOverlay.type === 'error') {
            return <XCircle className="h-32 w-32 text-red-400" />;
        }
        if (feedbackOverlay.type === 'success' && feedbackOverlay.student) {
             return <User className="h-32 w-32 text-green-300" />;
        }
        return null;
    };


    return (
    <>
    <canvas ref={canvasRef} className="hidden"></canvas>
    {feedbackOverlay.show && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="p-8 rounded-full bg-white/10">
                {renderFeedbackIcon()}
            </div>
            {feedbackOverlay.student && (
                <h2 className="mt-4 text-4xl font-bold text-white drop-shadow-lg">{feedbackOverlay.student.nama}</h2>
            )}
        </div>
    )}
    <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div>
            <h1 className="font-headline text-3xl font-bold tracking-tight">E-Absensi Kelas {grade}</h1>
            <p className="text-muted-foreground">Pindai barcode untuk absen masuk &amp; pulang.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ScanLine /> Input Manual</CardTitle>
                    <CardDescription>
                        Gunakan barcode scanner atau ketik NISN manual lalu tekan Enter.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Input
                        ref={scannerInputRef}
                        id={`nisn-input-${grade}`}
                        placeholder={isLoading ? "Memuat data..." : "Ketik NISN lalu tekan Enter..."}
                        disabled={isLoading || isProcessing}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                handleScan(e.currentTarget.value);
                            }
                        }}
                        autoFocus
                    />
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Camera /> Kontrol Kamera</CardTitle>
                        <CardDescription>
                        Aktifkan kamera untuk memindai QR code atau barcode dari siswa.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="w-full aspect-video rounded-md bg-muted border overflow-hidden flex items-center justify-center relative">
                        <div id={scannerContainerId} className="w-full h-full" />
                        <video ref={videoRef} autoPlay playsInline muted className="hidden" />
                        
                        {!isCameraActive && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-background/80 backdrop-blur-sm">
                            {isCameraInitializing ? (
                                <>
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="mt-2 text-muted-foreground">Memulai kamera...</p>
                                </>
                            ) : cameraError ? (
                                <Alert variant="destructive">
                                    <ShieldAlert className="h-4 w-4" />
                                    <AlertTitle>Gagal Mengakses Kamera</AlertTitle>
                                    <AlertDescription>{cameraError}</AlertDescription>
                                </Alert>
                            ) : (
                                <>
                                    <Video className="h-10 w-10 text-muted-foreground" />
                                    <p className="mt-2 text-sm text-muted-foreground">Kamera tidak aktif.</p>
                                    <p className="text-xs text-muted-foreground">Klik "Aktifkan Kamera" untuk memulai.</p>
                                </>
                            )}
                        </div>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 justify-center">
                        <Button size="sm" onClick={startScanner} disabled={isCameraActive || isCameraInitializing}>
                            <Video className="mr-2"/> Aktifkan Kamera
                        </Button>
                        <Button size="sm" onClick={stopScanner} variant="destructive" disabled={!isCameraActive || isCameraInitializing}>
                            <VideoOff className="mr-2"/> Matikan Kamera
                        </Button>
                    </div>
                </CardContent>
            </Card>
             <Card>
                <CardHeader>
                    <CardTitle>Log Aktivitas</CardTitle>
                    <CardDescription>Catatan pemindaian absensi hari ini.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-80 overflow-y-auto rounded-md border p-2 space-y-2">
                        {logMessages.length > 0 ? (
                            logMessages.map((log, i) => (
                                <div key={i} className="flex items-start gap-2 text-sm">
                                    <span className="font-mono text-xs text-muted-foreground pt-0.5">{log.timestamp}</span>
                                    {log.type === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />}
                                    {log.type === 'error' && <ShieldAlert className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />}
                                    {log.type === 'info' && <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />}
                                    {log.type === 'warning' && <MessageSquareWarning className="h-4 w-4 shrink-0 text-yellow-500 mt-0.5" />}
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
            <div className="border rounded-md">
                    <Table>
                    <TableHeader>
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
                        [...Array(5)].map((_, i) => (
                            <TableRow key={i}>
                                <TableCell><Skeleton className="h-5 w-full" /></TableCell>
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
                                const record = getAttendanceRecord(student.id);
                                const studentClass = classMap.get(student.classId);
                                const status = record.status || 'Belum Absen';
                                return (
                                    <TableRow 
                                      key={student.id} 
                                      data-status={status}
                                      className={cn({
                                          'animate-flash-success': highlightedNisn?.nisn === student.nisn && highlightedNisn?.type === 'success',
                                          'animate-flash-error': highlightedNisn?.nisn === student.nisn && (highlightedNisn?.type === 'error' || highlightedNisn?.type === 'warning'),
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
