"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { MoreHorizontal, PlusCircle } from "lucide-react"

import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"

const studentSchema = z.object({
  nis: z.string().min(1, "NIS tidak boleh kosong."),
  nama: z.string().min(1, "Nama tidak boleh kosong."),
  kelas: z.string().min(1, "Kelas harus dipilih."),
  jenisKelamin: z.enum(["Laki-laki", "Perempuan"], {
    required_error: "Jenis kelamin harus dipilih.",
  }),
})

type Student = z.infer<typeof studentSchema> & { id: string }

export default function SiswaPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null)
  const { toast } = useToast()

  const form = useForm<z.infer<typeof studentSchema>>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      nis: "",
      nama: "",
      kelas: "",
      jenisKelamin: undefined,
    },
  })

  async function fetchStudents() {
    setIsLoading(true)
    try {
      const querySnapshot = await getDocs(collection(db, "students"))
      const studentsList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Student[]
      setStudents(studentsList)
    } catch (error) {
      console.error("Error fetching students: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Memuat Data",
        description: "Tidak dapat mengambil data siswa dari server.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchStudents()
  }, [])

  async function handleSaveStudent(values: z.infer<typeof studentSchema>) {
    try {
      if (editingStudent) {
        const studentRef = doc(db, "students", editingStudent.id)
        await updateDoc(studentRef, values)
        toast({ title: "Sukses", description: "Data siswa berhasil diperbarui." })
      } else {
        await addDoc(collection(db, "students"), values)
        toast({ title: "Sukses", description: "Siswa baru berhasil ditambahkan." })
      }
      await fetchStudents()
      setIsDialogOpen(false)
      setEditingStudent(null)
      form.reset()
    } catch (error) {
      console.error("Error saving student: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan data siswa.",
      })
    }
  }

  async function handleDeleteStudent() {
    if (!deletingStudentId) return
    try {
      await deleteDoc(doc(db, "students", deletingStudentId))
      toast({ title: "Sukses", description: "Data siswa berhasil dihapus." })
      await fetchStudents()
      setIsAlertOpen(false)
      setDeletingStudentId(null)
    } catch (error) {
      console.error("Error deleting student: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menghapus",
        description: "Terjadi kesalahan saat menghapus data siswa.",
      })
    }
  }

  const openAddDialog = () => {
    setEditingStudent(null)
    form.reset({ nis: "", nama: "", kelas: "", jenisKelamin: undefined })
    setIsDialogOpen(true)
  }

  const openEditDialog = (student: Student) => {
    setEditingStudent(student)
    form.reset(student)
    setIsDialogOpen(true)
  }

  const openDeleteAlert = (studentId: string) => {
    setDeletingStudentId(studentId)
    setIsAlertOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Siswa</h1>
          <p className="text-muted-foreground">Kelola data siswa di sini.</p>
        </div>
        <Button onClick={openAddDialog}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Tambah Siswa
        </Button>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingStudent ? "Edit Siswa" : "Tambah Siswa"}</DialogTitle>
            <DialogDescription>
              {editingStudent ? "Ubah detail siswa di bawah ini." : "Isi formulir untuk menambahkan siswa baru."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSaveStudent)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="nis"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NIS</FormLabel>
                    <FormControl>
                      <Input placeholder="Nomor Induk Siswa" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="nama"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Lengkap</FormLabel>
                    <FormControl>
                      <Input placeholder="Nama Siswa" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="kelas"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Kelas</FormLabel>
                         <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih kelas" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="X">Kelas X</SelectItem>
                                <SelectItem value="XI">Kelas XI</SelectItem>
                                <SelectItem value="XII">Kelas XII</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="jenisKelamin"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Jenis Kelamin</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="flex flex-col space-y-1"
                      >
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Laki-laki" />
                          </FormControl>
                          <FormLabel className="font-normal">Laki-laki</FormLabel>
                        </FormItem>
                        <FormItem className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value="Perempuan" />
                          </FormControl>
                          <FormLabel className="font-normal">Perempuan</FormLabel>
                        </FormItem>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <DialogFooter>
                    <Button type="submit">Simpan</Button>
                </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anda Yakin?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak dapat dibatalkan. Ini akan menghapus data siswa secara permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStudent}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Siswa</CardTitle>
          <CardDescription>
            Tabel berisi semua siswa yang terdaftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
             <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
             </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>NIS</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kelas</TableHead>
                  <TableHead>Jenis Kelamin</TableHead>
                  <TableHead>
                    <span className="sr-only">Aksi</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.length > 0 ? (
                  students.map((student) => (
                    <TableRow key={student.id}>
                      <TableCell>{student.nis}</TableCell>
                      <TableCell className="font-medium">{student.nama}</TableCell>
                      <TableCell>{student.kelas}</TableCell>
                      <TableCell>{student.jenisKelamin}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Buka menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => openEditDialog(student)}>
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openDeleteAlert(student.id)}>
                              Hapus
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Belum ada data siswa.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
           )}
        </CardContent>
      </Card>
    </div>
  )
}
