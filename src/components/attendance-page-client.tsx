"use client"

import { useState, useEffect, useMemo } from "react"
import { collection, query, where, getDocs } from "firebase/firestore"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Camera } from "lucide-react"

type Class = { id: string; name: string; grade: string }
type Student = { id: string; nisn: string; nama: string; classId: string }
type AttendancePageClientProps = {
  grade: "X" | "XI" | "XII"
}

export function AttendancePageClient({ grade }: AttendancePageClientProps) {
  const [classes, setClasses] = useState<Class[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true)
      try {
        const classQuery = query(collection(db, "classes"), where("grade", "==", grade))
        const classSnapshot = await getDocs(classQuery)
        const classList = classSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Class[]
        setClasses(classList.sort((a, b) => a.name.localeCompare(b.name)))

        if (classList.length > 0) {
          const studentQuery = query(collection(db, "students"), where("classId", "in", classList.map(c => c.id)))
          const studentSnapshot = await getDocs(studentQuery)
          const studentList = studentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Student[]
          setStudents(studentList)
        }
      } catch (error) {
        console.error("Error fetching data:", error)
        toast({
          variant: "destructive",
          title: "Gagal Memuat Data",
          description: "Gagal mengambil data kelas atau siswa dari server.",
        })
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [grade, toast])

  const filteredStudents = useMemo(() => {
    if (!selectedClassId) return []
    return students
      .filter(student => student.classId === selectedClassId)
      .sort((a, b) => a.nama.localeCompare(b.nama))
  }, [students, selectedClassId])

  const selectedClassName = useMemo(() => {
    if (!selectedClassId) return ""
    return classes.find(c => c.id === selectedClassId)?.name || ""
  }, [classes, selectedClassId])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">
            E-Absensi Kelas {grade}
          </h1>
          <p className="text-muted-foreground">
            Pilih kelas untuk memulai sesi absensi.
          </p>
        </div>
        {classes.length > 0 && (
           <Select onValueChange={setSelectedClassId} value={selectedClassId || undefined}>
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

      <Card>
        <CardHeader>
          <CardTitle>Pemindai Barcode / QR Code</CardTitle>
          <CardDescription>
            Arahkan barcode siswa ke kamera atau gunakan alat pemindai USB.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/50 p-8 text-center">
            <Camera className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              Fungsionalitas kamera dan pemindai barcode akan diimplementasikan di sini.
            </p>
          </div>
        </CardContent>
      </Card>
      
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
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {isLoading ? (
                      [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                          <TableCell><Skeleton className="h-5 w-full" /></TableCell>
                        </TableRow>
                      ))
                    ) : selectedClassId ? (
                      filteredStudents.length > 0 ? (
                        filteredStudents.map((student) => (
                            <TableRow key={student.id}>
                              <TableCell>{student.nisn}</TableCell>
                              <TableCell className="font-medium">{student.nama}</TableCell>
                              <TableCell className="text-center">
                                 <Badge variant="outline">Belum Absen</Badge>
                              </TableCell>
                            </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={3} className="h-24 text-center">
                            Tidak ada siswa di kelas ini.
                          </TableCell>
                        </TableRow>
                      )
                    ) : (
                       <TableRow>
                          <TableCell colSpan={3} className="h-24 text-center">
                            Silakan pilih kelas terlebih dahulu.
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
