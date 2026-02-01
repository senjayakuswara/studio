
"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where, limit } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { MoreHorizontal, PlusCircle, Loader2 } from "lucide-react"

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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"

const classSchema = z.object({
  name: z.string().min(1, "Nama kelas tidak boleh kosong."),
  grade: z.enum(["X", "XI", "XII", "Staf"], { required_error: "Tingkat kelas harus dipilih."}),
  whatsappGroupName: z.string().optional(),
  waliKelas: z.string().optional(),
})

type Class = z.infer<typeof classSchema> & { id: string }
type NewClass = z.infer<typeof classSchema>

export default function KelasPage() {
  const [classes, setClasses] = useState<Class[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false)
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [deletingClassId, setDeletingClassId] = useState<string | null>(null)
  const { toast } = useToast()

  const form = useForm<NewClass>({
    resolver: zodResolver(classSchema),
    defaultValues: {
      name: "",
      grade: undefined,
      whatsappGroupName: "",
      waliKelas: "",
    },
  })

  async function fetchClasses() {
    setIsLoading(true)
    try {
      const querySnapshot = await getDocs(collection(db, "classes"))
      const classList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Class[]
      setClasses(classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`)))
    } catch (error) {
      console.error("Error fetching classes: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Memuat Data",
        description: "Tidak dapat mengambil data kelas dari server.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchClasses()
  }, [])

  async function handleSaveClass(values: NewClass) {
    try {
      if (editingClass) {
        const classRef = doc(db, "classes", editingClass.id)
        await updateDoc(classRef, values)
        toast({ title: "Sukses", description: "Data kelas berhasil diperbarui." })
      } else {
        await addDoc(collection(db, "classes"), values)
        toast({ title: "Sukses", description: "Kelas baru berhasil ditambahkan." })
      }
      await fetchClasses()
      setIsFormDialogOpen(false)
      setEditingClass(null)
      form.reset()
    } catch (error) {
      console.error("Error saving class: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan data kelas.",
      })
    }
  }

  async function handleDeleteClass() {
    if (!deletingClassId) return

    try {
      // Security Check: Ensure class is empty before deleting
      const studentQuery = query(collection(db, "students"), where("classId", "==", deletingClassId), limit(1));
      const studentSnapshot = await getDocs(studentQuery);

      if (!studentSnapshot.empty) {
          toast({
              variant: "destructive",
              title: "Gagal Menghapus Kelas",
              description: `Masih ada siswa terdaftar di kelas ini. Pindahkan siswa terlebih dahulu sebelum menghapus kelas.`,
          });
          setIsAlertOpen(false);
          return;
      }
      
      await deleteDoc(doc(db, "classes", deletingClassId))
      toast({ title: "Sukses", description: "Data kelas berhasil dihapus." })
      await fetchClasses()
      setIsAlertOpen(false)
      setDeletingClassId(null)
    } catch (error) {
      console.error("Error deleting class: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menghapus",
        description: "Terjadi kesalahan saat menghapus data kelas.",
      })
    }
  }

  const openAddDialog = () => {
    setEditingClass(null)
    form.reset({ name: "", grade: undefined, whatsappGroupName: "", waliKelas: "" })
    setIsFormDialogOpen(true)
  }

  const openEditDialog = (cls: Class) => {
    setEditingClass(cls)
    form.reset({
      ...cls,
      whatsappGroupName: cls.whatsappGroupName || "",
      waliKelas: cls.waliKelas || "",
    })
    setIsFormDialogOpen(true)
  }

  const openDeleteAlert = (classId: string) => {
    setDeletingClassId(classId)
    setIsAlertOpen(true)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Kelas</h1>
          <p className="text-muted-foreground">Kelola daftar kelas, tingkatan, dan grup WhatsApp notifikasi.</p>
        </div>
        <Button onClick={openAddDialog}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Tambah Kelas
        </Button>
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={setIsFormDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{editingClass ? "Edit Kelas" : "Tambah Kelas"}</DialogTitle>
            <DialogDescription>
              {editingClass ? "Ubah detail kelas di bawah ini." : "Isi formulir untuk menambahkan kelas baru."}
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSaveClass)} className="space-y-4 py-4">
              <FormField
                control={form.control}
                name="grade"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tingkat Kelas</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih tingkat" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="X">Kelas X</SelectItem>
                        <SelectItem value="XI">Kelas XI</SelectItem>
                        <SelectItem value="XII">Kelas XII</SelectItem>
                        <SelectItem value="Staf">Staf / Guru</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Kelas</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: MIPA 1, atau Dewan Guru" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="waliKelas"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Wali Kelas (Opsional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: Budi Santoso, S.Pd." {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="whatsappGroupName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nama Grup WhatsApp (Opsional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Contoh: Info Kelas X MIPA 1" {...field} value={field.value || ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Simpan
                </Button>
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
              Tindakan ini tidak dapat dibatalkan. Pastikan tidak ada siswa yang terdaftar di kelas ini sebelum menghapusnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteClass}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Kelas</CardTitle>
          <CardDescription>
            Tabel berisi semua kelas yang terdaftar di sekolah.
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
            <div className="border rounded-md">
                <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Tingkat</TableHead>
                    <TableHead>Nama Kelas</TableHead>
                    <TableHead>Wali Kelas</TableHead>
                    <TableHead>Grup WhatsApp</TableHead>
                    <TableHead>
                        <span className="sr-only">Aksi</span>
                    </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {classes.length > 0 ? (
                    classes.map((cls) => (
                        <TableRow key={cls.id}>
                        <TableCell className="font-medium">{cls.grade}</TableCell>
                        <TableCell>{cls.name}</TableCell>
                        <TableCell className="text-muted-foreground">{cls.waliKelas || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{cls.whatsappGroupName || "-"}</TableCell>
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
                                <DropdownMenuItem onClick={() => openEditDialog(cls)}>
                                Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openDeleteAlert(cls.id)}>
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
                        Belum ada data kelas. Silakan tambahkan kelas baru.
                        </TableCell>
                    </TableRow>
                    )}
                </TableBody>
                </Table>
            </div>
           )}
        </CardContent>
      </Card>
    </div>
  )
}
