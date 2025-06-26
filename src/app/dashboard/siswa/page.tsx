"use client"

import { useState, useEffect, type ChangeEvent, useMemo } from "react"
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch, query, where } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import * as xlsx from "xlsx"
import { MoreHorizontal, PlusCircle, FileUp, Download, Loader2 } from "lucide-react"

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
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectLabel,
} from "@/components/ui/select"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

const studentSchema = z.object({
  nisn: z.string().min(1, "NISN tidak boleh kosong."),
  nama: z.string().min(1, "Nama tidak boleh kosong."),
  classId: z.string({ required_error: "Kelas harus dipilih."}).min(1, "Kelas harus dipilih."),
  jenisKelamin: z.enum(["Laki-laki", "Perempuan"], {
    required_error: "Jenis kelamin harus dipilih.",
  }),
  parentChatId: z.string().optional(),
})

type Student = z.infer<typeof studentSchema> & { id: string }
type NewStudent = z.infer<typeof studentSchema>;
type Class = { id: string; name: string; grade: string };
type ImportStudent = NewStudent & { id?: string; status: 'Baru' | 'Diperbarui' | 'Identik' }

export default function SiswaPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null)
  const [importedStudents, setImportedStudents] = useState<ImportStudent[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [filterName, setFilterName] = useState("")
  const [filterClass, setFilterClass] = useState("all")
  const { toast } = useToast()

  const classObjectMap = useMemo(() => new Map(classes.map(c => [c.id, c])), [classes]);
  const classLookupMap = useMemo(() => new Map(classes.map(c => [`${c.grade.toUpperCase()}|${c.name.toUpperCase()}`, c.id])), [classes]);
  const classMapForPreview = useMemo(() => new Map(classes.map(c => [c.id, `${c.name} (${c.grade})`])), [classes]);
  
  const filteredStudents = useMemo(() => {
    return students
      .filter(student => student.nama.toLowerCase().includes(filterName.toLowerCase()))
      .filter(student => filterClass === "all" || student.classId === filterClass)
  }, [students, filterName, filterClass]);

  const form = useForm<NewStudent>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      nisn: "",
      nama: "",
      classId: undefined,
      jenisKelamin: undefined,
      parentChatId: "",
    },
  })

  async function fetchData() {
    setIsLoading(true)
    try {
      const [studentsSnapshot, classesSnapshot] = await Promise.all([
        getDocs(collection(db, "students")),
        getDocs(collection(db, "classes"))
      ]);
      
      const studentsList = studentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Student[]
      setStudents(studentsList.sort((a, b) => a.nama.localeCompare(b.nama)))

      const classList = classesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Class[]
      setClasses(classList.sort((a, b) => `${a.grade}-${a.name}`.localeCompare(`${b.grade}-${b.name}`)));

    } catch (error) {
      console.error("Error fetching data: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Memuat Data",
        description: "Tidak dapat mengambil data siswa atau kelas dari server.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleSaveStudent(values: NewStudent) {
    try {
      const existingStudentQuery = query(collection(db, "students"), where("nisn", "==", values.nisn));
      const querySnapshot = await getDocs(existingStudentQuery);
      
      let existingStudentId: string | null = null;
      if (!querySnapshot.empty) {
        existingStudentId = querySnapshot.docs[0].id;
      }
      
      if (editingStudent) {
        // Editing an existing student
        if (existingStudentId && existingStudentId !== editingStudent.id) {
          toast({ variant: "destructive", title: "Gagal Menyimpan", description: "NISN ini sudah digunakan oleh siswa lain." });
          return;
        }
        const studentRef = doc(db, "students", editingStudent.id);
        await updateDoc(studentRef, values);
        toast({ title: "Sukses", description: "Data siswa berhasil diperbarui." });
      } else {
        // Adding a new student
        if (existingStudentId) {
          toast({ variant: "destructive", title: "Gagal Menyimpan", description: "Siswa dengan NISN ini sudah terdaftar." });
          return;
        }
        await addDoc(collection(db, "students"), values);
        toast({ title: "Sukses", description: "Siswa baru berhasil ditambahkan." });
      }

      await fetchData();
      setIsFormDialogOpen(false);
      setEditingStudent(null);
      form.reset();
    } catch (error) {
      console.error("Error saving student: ", error);
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan data siswa.",
      });
    }
  }

  async function handleDeleteStudent() {
    if (!deletingStudentId) return
    try {
      await deleteDoc(doc(db, "students", deletingStudentId))
      toast({ title: "Sukses", description: "Data siswa berhasil dihapus." })
      await fetchData()
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
    form.reset({ nisn: "", nama: "", classId: undefined, jenisKelamin: undefined, parentChatId: "" })
    setIsFormDialogOpen(true)
  }

  const openEditDialog = (student: Student) => {
    setEditingStudent(student)
    form.reset(student)
    setIsFormDialogOpen(true)
  }

  const openDeleteAlert = (studentId: string) => {
    setDeletingStudentId(studentId)
    setIsAlertOpen(true)
  }

  const handleDownloadTemplate = () => {
    const header = ["NISN", "Nama", "Tingkat", "Nama Kelas", "Jenis Kelamin", "Parent Chat ID"];
    const example = ["1234567890", "Budi Santoso", "X", "MIPA 1", "Laki-laki", ""];
    const data = [header, example];
    const worksheet = xlsx.utils.aoa_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Siswa");
    xlsx.writeFile(workbook, "template_import_siswa.xlsx");
  };

  const handleDownloadData = () => {
    if (filteredStudents.length === 0) {
      toast({
        variant: "destructive",
        title: "Tidak Ada Data",
        description: "Tidak ada data siswa untuk diunduh.",
      });
      return;
    }

    const dataToExport = filteredStudents.map(student => {
        const classInfo = classObjectMap.get(student.classId);
        return {
            "NISN": student.nisn,
            "Nama": student.nama,
            "Tingkat": classInfo?.grade || "N/A",
            "Nama Kelas": classInfo?.name || "Kelas Dihapus",
            "Jenis Kelamin": student.jenisKelamin,
            "Parent Chat ID": student.parentChatId || "",
        }
    });
    
    const worksheet = xlsx.utils.json_to_sheet(dataToExport);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Data Siswa");
    
    const columnWidths = [
        { wch: 15 }, // NISN
        { wch: 30 }, // Nama
        { wch: 10 }, // Tingkat
        { wch: 20 }, // Nama Kelas
        { wch: 15 }, // Jenis Kelamin
        { wch: 15 }, // Parent Chat ID
    ];
    worksheet['!cols'] = columnWidths;

    xlsx.writeFile(workbook, "data_siswa.xlsx");
  };

  const handleFileImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = event.target?.result;
            const workbook = xlsx.read(data, { type: 'binary' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json: any[] = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
            
            json.shift();

            const studentNisnMap = new Map(students.map(s => [s.nisn, s]));
            let processedStudents: ImportStudent[] = [];
            let invalidCount = 0;

            json.forEach((row: any[]) => {
                const grade = String(row[2] || "").toUpperCase();
                const className = String(row[3] || "").toUpperCase();
                const classId = classLookupMap.get(`${grade}|${className}`);

                const studentData = {
                    nisn: String(row[0] || ""),
                    nama: String(row[1] || ""),
                    classId: classId,
                    jenisKelamin: String(row[4] || ""),
                    parentChatId: String(row[5] || "").trim() || undefined,
                };

                const validation = studentSchema.safeParse(studentData);
                if (validation.success) {
                    const validStudent = validation.data as NewStudent;
                    const existingStudent = studentNisnMap.get(validStudent.nisn);
                    
                    if (existingStudent) {
                        const isIdentical = existingStudent.nama === validStudent.nama &&
                                            existingStudent.classId === validStudent.classId &&
                                            existingStudent.jenisKelamin === validStudent.jenisKelamin &&
                                            (existingStudent.parentChatId || "") === (validStudent.parentChatId || "");
                        
                        processedStudents.push({ 
                            ...validStudent, 
                            id: existingStudent.id, 
                            status: isIdentical ? 'Identik' : 'Diperbarui' 
                        });
                    } else {
                        processedStudents.push({ ...validStudent, status: 'Baru' });
                    }
                } else {
                    invalidCount++;
                }
            });
            
            setImportedStudents(processedStudents);
            
            const toImportCount = processedStudents.filter(s => s.status !== 'Identik').length;
            if (toImportCount > 0) {
                toast({
                    title: "File Diproses",
                    description: `Ditemukan ${toImportCount} data untuk diimpor/diperbarui. ${invalidCount > 0 ? `${invalidCount} baris tidak valid.` : ''}`,
                });
            } else if (processedStudents.length > 0) {
                 toast({
                    title: "Tidak Ada Perubahan",
                    description: "Semua data siswa di file sudah sesuai dengan data di database.",
                });
            } else {
                 toast({
                    variant: "destructive",
                    title: "Gagal Memproses File",
                    description: "Tidak ada data siswa yang valid ditemukan. Pastikan 'Tingkat' dan 'Nama Kelas' di file Excel sudah terdaftar di Manajemen Kelas.",
                });
            }

        } catch (error) {
            console.error("Error parsing excel file: ", error);
            toast({
                variant: "destructive",
                title: "File Tidak Valid",
                description: "Terjadi kesalahan saat membaca file Excel.",
            });
            setImportedStudents([]);
        }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  }
  
  const handleSaveImportedStudents = async () => {
    const studentsToProcess = importedStudents.filter(s => s.status !== 'Identik');
    if (studentsToProcess.length === 0) {
        toast({ variant: "destructive", title: "Tidak ada data untuk diimpor." });
        return;
    }
    setIsImporting(true);
    try {
        const batch = writeBatch(db);
        
        studentsToProcess.forEach(student => {
            const { id, status, ...studentData } = student;
            const dataToSave = { ...studentData, parentChatId: studentData.parentChatId || "" };
            if (status === 'Baru') {
                const docRef = doc(collection(db, "students"));
                batch.set(docRef, dataToSave);
            } else if (status === 'Diperbarui' && id) {
                const docRef = doc(db, "students", id);
                batch.update(docRef, dataToSave);
            }
        });

        await batch.commit();
        toast({
            title: "Impor Berhasil",
            description: `${studentsToProcess.length} data siswa berhasil disimpan ke database.`,
        });
        await fetchData();
        setIsImportDialogOpen(false);
        setImportedStudents([]);
    } catch (error) {
         console.error("Error importing students: ", error);
         toast({
            variant: "destructive",
            title: "Gagal Mengimpor",
            description: "Terjadi kesalahan saat menyimpan data ke database.",
        });
    } finally {
        setIsImporting(false);
    }
  }


  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Siswa</h1>
          <p className="text-muted-foreground">Kelola data siswa di sini.</p>
        </div>
        <div className="flex gap-2">
            <Button variant="outline" onClick={handleDownloadData}>
                <Download className="mr-2 h-4 w-4" />
                Unduh Data
            </Button>
            <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
                <FileUp className="mr-2 h-4 w-4" />
                Impor Siswa
            </Button>
            <Button onClick={openAddDialog}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Tambah Siswa
            </Button>
        </div>
      </div>

      <Dialog open={isFormDialogOpen} onOpenChange={setIsFormDialogOpen}>
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
                name="nisn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>NISN</FormLabel>
                    <FormControl>
                      <Input placeholder="Nomor Induk Siswa Nasional" {...field} />
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
                name="classId"
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
              <FormField
                  control={form.control}
                  name="parentChatId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Chat ID Orang Tua (Opsional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Akan terisi otomatis via bot" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormDescription>
                        ID ini digunakan untuk mengirim notifikasi. Biarkan kosong jika orang tua akan mendaftar via bot.
                      </FormDescription>
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
      
      <Dialog open={isImportDialogOpen} onOpenChange={(isOpen) => { setIsImportDialogOpen(isOpen); if (!isOpen) setImportedStudents([]); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Impor Data Siswa</DialogTitle>
            <DialogDescription>
              Unggah file Excel untuk menambah atau memperbarui data siswa secara massal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="p-4 border rounded-md space-y-3">
                <h3 className="font-medium">Langkah 1: Unduh Template</h3>
                <p className="text-sm text-muted-foreground">Unduh template dan isi dengan data siswa. Pastikan kolom 'Tingkat' dan 'Nama Kelas' sesuai dengan yang ada di Manajemen Kelas.</p>
                <Button variant="secondary" onClick={handleDownloadTemplate}>
                    <Download className="mr-2 h-4 w-4" />
                    Unduh Template Excel
                </Button>
            </div>
             <div className="p-4 border rounded-md space-y-3">
                <h3 className="font-medium">Langkah 2: Unggah File</h3>
                <p className="text-sm text-muted-foreground">Pilih file Excel yang sudah Anda isi untuk diunggah.</p>
                <Input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileImport}
                    className="file:font-medium file:text-primary"
                />
            </div>
            {importedStudents.length > 0 && (
                <div className="space-y-3">
                    <h3 className="font-medium">Pratinjau Data ({importedStudents.filter(s => s.status !== 'Identik').length} akan diproses)</h3>
                    <div className="max-h-60 overflow-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>NISN</TableHead>
                                    <TableHead>Nama</TableHead>
                                    <TableHead>Kelas</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {importedStudents.map((student, index) => (
                                    <TableRow key={index} className={student.status === 'Identik' ? 'text-muted-foreground' : ''}>
                                        <TableCell>
                                            <Badge variant={student.status === 'Baru' ? 'default' : student.status === 'Diperbarui' ? 'secondary' : 'outline'}>
                                                {student.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>{student.nisn}</TableCell>
                                        <TableCell>{student.nama}</TableCell>
                                        <TableCell>{classMapForPreview.get(student.classId) || "Error"}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsImportDialogOpen(false)}>Batal</Button>
            <Button onClick={handleSaveImportedStudents} disabled={importedStudents.filter(s => s.status !== 'Identik').length === 0 || isImporting}>
              {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan ke Database
            </Button>
          </DialogFooter>
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
            Tabel berisi semua siswa yang terdaftar. Gunakan filter di bawah untuk mencari data.
          </CardDescription>
          <div className="mt-4 flex flex-col md:flex-row gap-4">
              <Input
                  placeholder="Cari berdasarkan nama siswa..."
                  value={filterName}
                  onChange={(e) => setFilterName(e.target.value)}
                  className="max-w-sm"
              />
              <Select value={filterClass} onValueChange={setFilterClass}>
                  <SelectTrigger className="w-full md:w-[280px]">
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
          </div>
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
                    <TableHead>NISN</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Tingkat</TableHead>
                    <TableHead>Kelas</TableHead>
                    <TableHead>Jenis Kelamin</TableHead>
                    <TableHead>
                        <span className="sr-only">Aksi</span>
                    </TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredStudents.length > 0 ? (
                    filteredStudents.map((student) => {
                        const classInfo = classObjectMap.get(student.classId);
                        return (
                            <TableRow key={student.id}>
                            <TableCell>{student.nisn}</TableCell>
                            <TableCell className="font-medium">{student.nama}</TableCell>
                            <TableCell>{classInfo?.grade || 'N/A'}</TableCell>
                            <TableCell>{classInfo?.name || 'Kelas Dihapus'}</TableCell>
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
                        )
                    })
                    ) : (
                    <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center">
                          {students.length > 0 ? "Tidak ada siswa yang cocok dengan filter." : "Belum ada data siswa."}
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
