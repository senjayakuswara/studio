
"use client"

import * as React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { collection, getDocs, query, where, doc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import * as faceapi from 'face-api.js';

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
import { Loader2, Camera, UserCheck, UserX, ScanFace, CheckCircle2 } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"

// Types
type Class = { id: string; name: string; grade: string }
type Student = { 
    id: string; 
    nisn: string; 
    nama: string; 
    classId: string; 
    faceDescriptor?: number[];
}

const MODELS_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

export default function DaftarWajahPage() {
    const [classes, setClasses] = useState<Class[]>([]);
    const [students, setStudents] = useState<Student[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>("");
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [isModelsLoading, setIsModelsLoading] = useState(true);
    const [isClassDataLoading, setIsClassDataLoading] = useState(false);
    const [isCameraInitializing, setIsCameraInitializing] = useState(false);
    const [isRegistering, setIsRegistering] = useState(false);
    const [registrationProgress, setRegistrationProgress] = useState(0);
    const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const intervalRef = useRef<NodeJS.Timeout>();

    const { toast } = useToast();

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
                toast({ variant: "destructive", title: "Gagal Memuat Model AI", description: "Tidak dapat memuat model pengenalan wajah. Coba muat ulang halaman." });
            }
        };
        loadModels();
    }, [toast]);
    
    useEffect(() => {
        async function fetchClasses() {
            try {
                const classesSnapshot = await getDocs(collection(db, "classes"));
                const classList = classesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[];
                classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${a.name}`));
                setClasses(classList);
            } catch (error) {
                console.error("Error fetching classes:", error);
                toast({ variant: "destructive", title: "Gagal Memuat Kelas" });
            }
        }
        fetchClasses();
    }, [toast]);

    const handleClassChange = async (classId: string) => {
        setSelectedClass(classId);
        setSelectedStudent(null);
        setIsClassDataLoading(true);
        try {
            const studentQuery = query(collection(db, "students"), where("classId", "==", classId));
            const studentSnapshot = await getDocs(studentQuery);
            const studentList = studentSnapshot.docs.map(doc => {
                 const data = doc.data();
                 return {
                    id: doc.id,
                    nisn: data.nisn,
                    nama: data.nama,
                    classId: data.classId,
                    faceDescriptor: data.faceDescriptor || undefined,
                 } as Student;
            });
            setStudents(studentList.sort((a, b) => a.nama.localeCompare(b.nama)));
        } catch (error) {
            console.error("Error fetching students:", error);
            toast({ variant: "destructive", title: "Gagal Memuat Siswa" });
        } finally {
            setIsClassDataLoading(false);
        }
    };
    
    const startCamera = async () => {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && videoRef.current) {
            setIsCameraInitializing(true);
            setCameraError(null);
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
                videoRef.current.srcObject = stream;
            } catch (error) {
                console.error("Error starting camera:", error);
                setCameraError("Tidak dapat mengakses kamera. Harap izinkan akses di browser Anda.");
            } finally {
                setIsCameraInitializing(false);
            }
        }
    };
    
    const stopCamera = useCallback(() => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
            if (intervalRef.current) clearInterval(intervalRef.current);
             if(canvasRef.current) {
                const context = canvasRef.current.getContext('2d');
                context?.clearRect(0,0, canvasRef.current.width, canvasRef.current.height);
            }
        }
    }, []);

    useEffect(() => {
        return () => {
            stopCamera();
        };
    }, [stopCamera]);


    const handleRegistration = async () => {
        if (!selectedStudent || !videoRef.current?.srcObject) {
            toast({variant: "destructive", title: "Kamera Belum Aktif", description: "Harap nyalakan kamera terlebih dahulu."});
            return;
        }
        
        setIsRegistering(true);
        setRegistrationProgress(0);
        setFeedbackMessage("Tetap di posisi, jangan bergerak...");

        const descriptors: Float32Array[] = [];
        let captureCount = 0;
        const requiredCaptures = 5;

        const captureInterval = setInterval(async () => {
            if (videoRef.current && captureCount < requiredCaptures) {
                const detections = await faceapi.detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
                if (detections) {
                    descriptors.push(detections.descriptor);
                    captureCount++;
                    const progress = (captureCount / requiredCaptures) * 100;
                    setRegistrationProgress(progress);
                    setFeedbackMessage(`Pengambilan sampel ${captureCount} dari ${requiredCaptures} berhasil...`);
                }
            }

            if (captureCount >= requiredCaptures) {
                clearInterval(captureInterval);
                if (descriptors.length < requiredCaptures) {
                     setFeedbackMessage("Pendaftaran gagal, wajah tidak terdeteksi dengan jelas. Coba lagi.");
                     setIsRegistering(false);
                     return;
                }

                setFeedbackMessage("Memproses data wajah...");
                
                const avgDescriptor = descriptors.reduce((acc, val) => {
                    val.forEach((v, i) => acc[i] = (acc[i] || 0) + v);
                    return acc;
                }, [] as number[]).map(v => v / descriptors.length);

                try {
                    const studentRef = doc(db, "students", selectedStudent.id);
                    await updateDoc(studentRef, { faceDescriptor: avgDescriptor });
                    
                    setSelectedStudent(prev => prev ? { ...prev, faceDescriptor: avgDescriptor } : null);
                    setStudents(prev => prev.map(s => s.id === selectedStudent.id ? { ...s, faceDescriptor: avgDescriptor } : s));

                    setFeedbackMessage("Pendaftaran wajah berhasil!");
                    toast({ title: "Sukses", description: `Data wajah untuk ${selectedStudent.nama} berhasil disimpan.` });
                    stopCamera();

                } catch (error) {
                    console.error("Error saving descriptor:", error);
                    setFeedbackMessage("Gagal menyimpan data wajah ke database.");
                    toast({ variant: "destructive", title: "Gagal Menyimpan" });
                } finally {
                     setTimeout(() => {
                        setIsRegistering(false);
                        setFeedbackMessage(null);
                        setRegistrationProgress(0);
                    }, 2000);
                }
            }
        }, 800); 
    };

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pendaftaran Wajah Siswa</h1>
                <p className="text-muted-foreground">Daftarkan data wajah siswa untuk absensi menggunakan pengenalan wajah.</p>
            </div>

            <Alert>
                <ScanFace className="h-4 w-4" />
                <AlertTitle>Bagaimana Cara Kerjanya?</AlertTitle>
                <AlertDescription>
                    Pilih kelas dan siswa, lalu klik "Mulai Pendaftaran". Minta siswa untuk menghadap kamera dengan pencahayaan yang baik. Aplikasi akan mengambil 5 sampel wajah secara otomatis dan menyimpannya.
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Langkah 1: Pilih Siswa</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <Select value={selectedClass} onValueChange={handleClassChange} disabled={isModelsLoading}>
                        <SelectTrigger><SelectValue placeholder={isModelsLoading ? "Memuat model AI..." : "Pilih kelas"} /></SelectTrigger>
                        <SelectContent>
                            {["X", "XI", "XII"].map(grade => (
                                <SelectGroup key={grade}><SelectLabel>Kelas {grade}</SelectLabel>
                                    {classes.filter(c => c.grade === grade).map(c => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                     <Select 
                        value={selectedStudent?.id || ""} 
                        onValueChange={(studentId) => {
                            const student = students.find(s => s.id === studentId) || null;
                            setSelectedStudent(student);
                            stopCamera();
                            setFeedbackMessage(null);
                        }} 
                        disabled={!selectedClass || isClassDataLoading}
                    >
                        <SelectTrigger><SelectValue placeholder={isClassDataLoading ? "Memuat siswa..." : "Pilih siswa"} /></SelectTrigger>
                        <SelectContent>
                            {students.map(student => (
                                <SelectItem key={student.id} value={student.id}>
                                    <div className="flex items-center gap-2">
                                        {student.faceDescriptor ? <UserCheck className="h-4 w-4 text-green-500" /> : <UserX className="h-4 w-4 text-red-500" />}
                                        {student.nama}
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </CardContent>
            </Card>
            
            {selectedStudent && (
                 <Card>
                    <CardHeader>
                        <CardTitle>Langkah 2: Proses Pendaftaran untuk {selectedStudent.nama}</CardTitle>
                         {selectedStudent.faceDescriptor && (
                            <CardDescription className="flex items-center gap-2 text-green-600">
                                <CheckCircle2 /> Siswa ini sudah memiliki data wajah terdaftar. Anda bisa mendaftar ulang untuk memperbarui data.
                            </CardDescription>
                        )}
                    </CardHeader>
                    <CardContent className="flex flex-col items-center gap-4">
                        <div className="w-full max-w-md aspect-video rounded-md bg-muted border overflow-hidden flex items-center justify-center relative">
                            <video 
                                ref={videoRef} 
                                autoPlay 
                                playsInline 
                                muted 
                                className="w-full h-full object-cover transform -scale-x-100"
                                onPlay={async () => {
                                    if(canvasRef.current && videoRef.current){
                                        const video = videoRef.current;
                                        const canvas = canvasRef.current;
                                        const displaySize = { width: video.clientWidth, height: video.clientHeight };
                                        faceapi.matchDimensions(canvas, displaySize);
                                        
                                        intervalRef.current = setInterval(async () => {
                                             const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
                                             const resizedDetections = faceapi.resizeResults(detections, displaySize);
                                             const context = canvas.getContext('2d');
                                             if(context) {
                                                context.clearRect(0,0, canvas.width, canvas.height);
                                                faceapi.draw.drawDetections(canvas, resizedDetections);
                                             }
                                        }, 100);
                                    }
                                }}
                            />
                            <canvas ref={canvasRef} className="absolute inset-0 transform -scale-x-100" />
                             {!videoRef.current?.srcObject && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-background/80 backdrop-blur-sm">
                                    {isCameraInitializing ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Camera className="h-10 w-10 text-muted-foreground" />}
                                    <p className="mt-2 text-sm text-muted-foreground">{cameraError || "Kamera belum aktif."}</p>
                                </div>
                            )}
                        </div>
                        {isRegistering && (
                            <div className="w-full max-w-md space-y-2 text-center">
                                <Progress value={registrationProgress} />
                                <p className="text-sm text-muted-foreground">{feedbackMessage}</p>
                            </div>
                        )}
                        <div className="flex gap-2">
                             <Button onClick={startCamera} disabled={isModelsLoading || isRegistering || isCameraInitializing || !!videoRef.current?.srcObject}>
                                {isCameraInitializing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Nyalakan Kamera
                            </Button>
                            <Button onClick={handleRegistration} disabled={isModelsLoading || isRegistering || !videoRef.current?.srcObject}>
                                {isRegistering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanFace className="mr-2 h-4 w-4" />}
                                {isRegistering ? "Memproses..." : selectedStudent.faceDescriptor ? "Daftar Ulang Wajah" : "Mulai Pendaftaran"}
                            </Button>
                        </div>
                    </CardContent>
                 </Card>
            )}

             {isModelsLoading && (
                <div className="flex items-center justify-center gap-2 p-4">
                    <Loader2 className="animate-spin" />
                    <p className="text-muted-foreground">Mempersiapkan model AI untuk pengenalan wajah...</p>
                </div>
             )}
        </div>
    );
}
