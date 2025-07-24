
"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { collection, query, where, getDocs, addDoc, doc, getDoc, Timestamp, updateDoc } from "firebase/firestore"
import { Html5Qrcode } from "html5-qrcode"
import * as faceapi from 'face-api.js';
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
type Student = { 
    id: string; 
    nisn: string; 
    nama: string; 
    classId: string, 
    grade: string, 
    jenisKelamin: "Laki-laki" | "Perempuan", 
    parentWaNumber?: string,
    faceDescriptor?: number[] 
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

const MODELS_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

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
    const [isModelsLoading, setIsModelsLoading] = useState(true);
    const [isLoading, setIsLoading] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCameraInitializing, setIsCameraInitializing] = useState(false);
    const [isCameraActive, setIsCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [highlightedNisn, setHighlightedNisn] = useState<{ nisn: string; type: "success" | "error" | "warning" } | null>(null);
    const [feedbackOverlay, setFeedbackOverlay] = useState<FeedbackOverlayState>({ show: false, type: 'loading' });
    const [labeledFaceDescriptors, setLabeledFaceDescriptors] = useState<faceapi.LabeledFaceDescriptors[]>([]);
    
    const processingLock = useRef(false);
    const scannerInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const detectionIntervalRef = useRef<NodeJS.Timeout>();
    const scannerContainerId = `qr-reader-${grade.toLowerCase()}`;
    const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
    const { toast } = useToast()

    const classMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
    
    const sortedStudents = useMemo(() => {
        return [...allStudents].sort((a, b) => a.nama.localeCompare(b.nama));
    }, [allStudents]);

     useEffect(() => {
        const loadModels = async () => {
            try {
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
                ]);
                setIsModelsLoading(false);
            } catch (error) {
                console.error("Error loading models:", error);
                toast({ variant: "destructive", title: "Gagal Memuat Model AI" });
            }
        };
        loadModels();
    }, [toast]);

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
            status: record.status as any, 
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
                    toast({ variant: "destructive", title: "Pengaturan Jam Tidak Ditemukan" });
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

                    const descriptors = studentList
                        .filter(s => s.faceDescriptor && s.faceDescriptor.length > 0)
                        .map(s => new faceapi.LabeledFaceDescriptors(s.nisn, [new Float32Array(s.faceDescriptor!)]));
                    setLabeledFaceDescriptors(descriptors);
                    if (descriptors.length > 0) {
                        addLog(`${descriptors.length} data wajah siswa berhasil dimuat.`, 'info');
                    }


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
                })
            } finally {
                setIsLoading(false)
            }
        }
        if (!isModelsLoading) {
            fetchData();
        }
    }, [grade, toast, addLog, isModelsLoading])
    
    useEffect(() => {
        const scanner = new Html5Qrcode(scannerContainerId, { verbose: false });
        html5QrCodeRef.current = scanner;

        return () => {
            if (scanner?.isScanning) {
                scanner.stop().catch(err => {});
            }
            if (detectionIntervalRef.current) {
                clearInterval(detectionIntervalRef.current);
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
            }, 2000);
        };

        try {
            if (!schoolHours) {
                addLog("Error: Pengaturan jam belum dimuat.", "error");
                playSound('error');
                cleanup('error');
                return;
            }
    
            const student = allStudents.find(s => s.nisn === trimmedNisn);
    
            if (!student) {
                addLog(`NISN ${trimmedNisn} tidak ditemukan di tingkat ini.`, 'error');
                setHighlightedNisn({ nisn: trimmedNisn, type: 'error' });
                playSound('error');
                cleanup('error');
                return;
            }
            
            if (student.grade !== grade) {
                const studentClass = classMap.get(student.classId)
                addLog(`Siswa ${student.nama} (${studentClass?.name} - ${student.grade}) salah ruang absen.`, 'error');
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
                playSound('error');
                cleanup('error', student);
                return;
            }
    
            const existingRecord = attendanceData[student.id];
            const now = new Date();
    
            if (existingRecord && ["Sakit", "Izin", "Alfa", "Dispen"].includes(existingRecord.status)) {
                addLog(`Siswa ${student.nama} berstatus ${existingRecord.status}. Tidak bisa absen.`, "error");
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
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
                    playSound('error');
                    cleanup('error', student);
                    return;
                }
                 tempRecordForDb = { ...existingRecord, timestampPulang: Timestamp.fromDate(now) };
            } else {
                addLog(`Siswa ${student.nama} sudah absen masuk dan pulang.`, 'info');
                setHighlightedNisn({ nisn: student.nisn, type: 'error' });
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
                playSound('warning');
            } else {
                addLog(`Absen ${isAbsenMasuk ? 'Masuk' : 'Pulang'}: ${student.nama} berhasil.`, 'success');
                setHighlightedNisn({ nisn: student.nisn, type: 'success' });
                playSound('success');
            }
            
            cleanup('success', student);

        } catch (error) {
            console.error("Error handling scan:", error);
            addLog(`Gagal memproses NISN ${trimmedNisn}.`, 'error');
            setHighlightedNisn({ nisn: trimmedNisn, type: 'error' });
            playSound('error');
            cleanup('error');
        }
    }, [schoolHours, allStudents, grade, classMap, attendanceData, addLog, playSound, isCameraActive]);
    
    const stopScanner = useCallback(async () => {
        if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
        }
        if (html5QrCodeRef.current?.isScanning) {
            try {
                await html5QrCodeRef.current.stop();
            } catch (err) {}
        }
        
        if (videoRef.current?.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
        }

        if (canvasRef.current) {
            const context = canvasRef.current.getContext('2d');
            context?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }

        addLog("Kamera dinonaktifkan.", "info");
        setIsCameraActive(false);
        setCameraError(null);
    }, [addLog]);

    const startScanner = useCallback(async () => {
        if (isCameraActive || isCameraInitializing || !html5QrCodeRef.current || isModelsLoading || labeledFaceDescriptors.length === 0) {
             if (labeledFaceDescriptors.length === 0 && !isModelsLoading) {
                toast({ variant: "destructive", title: "Tidak Ada Data Wajah", description: "Tidak ada siswa di tingkat ini yang memiliki data wajah terdaftar." });
            }
            return;
        }

        setIsCameraInitializing(true);
        setCameraError(null);
        
        const startFaceRecognition = (videoElement: HTMLVideoElement) => {
            if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);

            const faceMatcher = new faceapi.FaceMatcher(labeledFaceDescriptors, 0.55);

            detectionIntervalRef.current = setInterval(async () => {
                if (processingLock.current) return;

                const detections = await faceapi.detectAllFaces(videoElement, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptors();
                
                if (canvasRef.current) {
                    canvasRef.current.innerHTML = "";
                    const displaySize = { width: videoElement.clientWidth, height: videoElement.clientHeight };
                    faceapi.matchDimensions(canvasRef.current, displaySize);
                    
                    const resizedDetections = faceapi.resizeResults(detections, displaySize);
                    const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));
                    
                    results.forEach((result, i) => {
                        const box = resizedDetections[i].detection.box;
                        const drawBox = new faceapi.draw.DrawBox(box, { label: result.toString() });
                        drawBox.draw(canvasRef.current!);
                        
                        if (result.label !== 'unknown' && result.distance < 0.5) {
                            handleScan(result.label);
                        }
                    });
                }
            }, 1000);
        }

        try {
            await html5QrCodeRef.current.start(
                { facingMode: "user" },
                { fps: 5, qrbox: { width: 200, height: 200 }, aspectRatio: 1.0 },
                (decodedText) => handleScan(decodedText),
                (errorMessage) => {}
            );
            
            const videoElement = document.getElementById(`${scannerContainerId}-video`) as HTMLVideoElement;
            if (videoElement) {
                videoRef.current = videoElement;
                startFaceRecognition(videoElement);
            }

            setIsCameraInitializing(false);
            setIsCameraActive(true);
            addLog("Kamera berhasil diaktifkan untuk QR & Wajah.", "success");
        } catch (err: any) {
            const errorMessage = err?.message || 'Gagal memulai kamera.';
            setCameraError(errorMessage);
            setIsCameraInitializing(false);
            setIsCameraActive(false);
            addLog(`Error kamera: ${errorMessage}`, "error");
        }
    }, [isCameraActive, isCameraInitializing, addLog, handleScan, toast, isModelsLoading, labeledFaceDescriptors]);
    

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

        } catch (error) {
            console.error("Error updating manual attendance: ", error);
            addLog(`Gagal menyimpan absensi manual untuk ${student.nama}.`, 'error');
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
            <p className="text-muted-foreground">Pindai barcode/wajah untuk absen masuk &amp; pulang.</p>
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
                        placeholder={isLoading || isModelsLoading ? "Memuat data..." : "Ketik NISN lalu tekan Enter..."}
                        disabled={isLoading || isProcessing || isModelsLoading}
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
                        Aktifkan kamera untuk memindai QR code dan wajah siswa.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <div className="w-full aspect-video rounded-md bg-muted border overflow-hidden flex items-center justify-center relative">
                        <div id={scannerContainerId} className="w-full h-full" />
                         <canvas ref={canvasRef} className="absolute inset-0 z-10" />
                        
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
                            ) : isModelsLoading ? (
                                <>
                                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                                    <p className="mt-2 text-muted-foreground">Memuat Model AI...</p>
                                </>
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
                        <Button size="sm" onClick={startScanner} disabled={isCameraActive || isCameraInitializing || isModelsLoading}>
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
