
"use client"

import { useState, useEffect, type ChangeEvent, useMemo } from "react"
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, writeBatch, query, where } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import * as xlsx from "xlsx"
import { MoreHorizontal, PlusCircle, FileUp, Download, Loader2, Trash2, ChevronsRight, Award } from "lucide-react"

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
import { Checkbox } from "@/components/ui/checkbox"

const studentSchema = z.object({
  nisn: z.string().min(1, "NISN tidak boleh kosong."),
  nama: z.string().min(1, "Nama tidak boleh kosong."),
  classId: z.string({ required_error: "Kelas harus dipilih."}).min(1, "Kelas harus dipilih."),
  jenisKelamin: z.enum(["Laki-laki", "Perempuan"], {
    required_error: "Jenis kelamin harus dipilih.",
  }),
  parentWaNumber: z.string().optional().refine(val => !val || /^\d{10,15}$/.test(val), {
    message: "Nomor WhatsApp harus berupa angka 10-15 digit (contoh: 6281234567890)."
  }),
  status: z.enum(["Aktif", "Lulus", "Pindah"]).optional().default("Aktif"),
})

type Student = z.infer<typeof studentSchema> & { id: string }
type NewStudent = z.infer<typeof studentSchema>;
type Class = { id: string; name: string; grade: string };
type ImportStudent = NewStudent & { id?: string; importStatus: 'Baru' | 'Diperbarui' | 'Identik' }

export default function SiswaPage() {
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false)
  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [isGraduateAlertOpen, setIsGraduateAlertOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null)
  const [importedStudents, setImportedStudents] = useState<ImportStudent[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isGraduating, setIsGraduating] = useState(false);
  const [targetClassId, setTargetClassId] = useState<string>("");
  const [filterName, setFilterName] = useState("")
  const [filterClass, setFilterClass] = useState("all")
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
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
      parentWaNumber: "",
      status: "Aktif",
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
  
  useEffect(() => {
    setSelectedRowIds([]);
  }, [filterName, filterClass]);

  async function handleSaveStudent(values: NewStudent) {
    try {
      const existingStudentQuery = query(collection(db, "students"), where("nisn", "==", values.nisn));
      const querySnapshot = await getDocs(existingStudentQuery);
      
      let existingStudentId: string | null = null;
      if (!querySnapshot.empty) {
        existingStudentId = querySnapshot.docs[0].id;
      }
      
      if (editingStudent) {
        if (existingStudentId && existingStudentId !== editingStudent.id) {
          toast({ variant: "destructive", title: "Gagal Menyimpan", description: "NISN ini sudah digunakan oleh siswa lain." });
          return;
        }
        const studentRef = doc(db, "students", editingStudent.id);
        await updateDoc(studentRef, values);
        toast({ title: "Sukses", description: "Data siswa berhasil diperbarui." });
      } else {
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

  async function handleDeleteStudent(ids: string[]) {
    if (!ids || ids.length === 0) return
    try {
      const batch = writeBatch(db);
      ids.forEach(id => {
        const docRef = doc(db, "students", id);
        batch.delete(docRef);
      });
      await batch.commit();

      toast({ title: "Sukses", description: `${ids.length} data siswa berhasil dihapus.` })
      await fetchData();
      setIsAlertOpen(false)
      setDeletingStudentId(null)
      setSelectedRowIds([]);
    } catch (error) {
      console.error("Error deleting student: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menghapus",
        description: "Terjadi kesalahan saat menghapus data siswa.",
      })
    }
  }

  async function handleMoveClass() {
    if (!targetClassId) {
        toast({ variant: "destructive", title: "Gagal", description: "Anda harus memilih kelas tujuan." });
        return;
    }
    setIsMoving(true);
    try {
        const batch = writeBatch(db);
        selectedRowIds.forEach(studentId => {
            const studentRef = doc(db, "students", studentId);
            batch.update(studentRef, { classId: targetClassId });
        });
        await batch.commit();
        
        toast({ title: "Sukses", description: `${selectedRowIds.length} siswa berhasil dipindahkan.` });
        await fetchData();
        setIsMoveDialogOpen(false);
        setSelectedRowIds([]);
        setTargetClassId("");
    } catch (error) {
        console.error("Error moving students:", error);
        toast({ variant: "destructive", title: "Gagal Pindah Kelas", description: "Terjadi kesalahan saat memindahkan siswa." });
    } finally {
        setIsMoving(false);
    }
  }

  const handleGraduateStudents = async () => {
    setIsGraduating(true);
    try {
      const gradeXIIClasses = classes.filter(c => c.grade === 'XII').map(c => c.id);
      if (gradeXIIClasses.length === 0) {
        toast({ variant: "destructive", title: "Tidak ada kelas XII", description: "Tidak ditemukan kelas tingkat XII untuk diluluskan." });
        setIsGraduating(false);
        return;
      }
      
      const studentsToGraduateQuery = query(collection(db, "students"), where("classId", "in", gradeXIIClasses), where("status", "==", "Aktif"));
      const studentsSnapshot = await getDocs(studentsToGraduateQuery);
      
      if (studentsSnapshot.empty) {
        toast({ title: "Tidak ada siswa", description: "Tidak ada siswa aktif di kelas XII untuk diluluskan." });
        setIsGraduating(false);
        return;
      }
      
      const batch = writeBatch(db);
      studentsSnapshot.docs.forEach(doc => {
        batch.update(doc.ref, { status: "Lulus" });
      });
      await batch.commit();

      toast({ title: "Sukses", description: `${studentsSnapshot.size} siswa kelas XII telah berhasil diluluskan.` });
      await fetchData();
    } catch(error) {
      console.error("Error graduating students:", error);
      toast({ variant: "destructive", title: "Gagal Meluluskan", description: "Terjadi kesalahan saat memproses kelulusan." });
    } finally {
      setIsGraduating(false);
      setIsGraduateAlertOpen(false);
    }
  };

  const openDeleteAlert = (studentId: string | null) => {
    setDeletingStudentId(studentId);
    setIsAlertOpen(true);
  }

  const handleDownloadTemplate = () => {
    const header = ["NISN", "Nama", "Tingkat", "Nama Kelas", "Jenis Kelamin", "No WhatsApp Ortu", "Status"];
    const example = ["1234567890", "Budi Santoso", "X", "MIPA 1", "Laki-laki", "6281234567890", "Aktif"];
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
            "No WhatsApp Ortu": student.parentWaNumber || "",
            "Status": student.status || "Aktif",
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
        { wch: 20 }, // No WhatsApp Ortu
        { wch: 10 }, // Status
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
                    parentWaNumber: String(row[5] || "").trim() || undefined,
                    status: String(row[6] || "Aktif")
                };

                const validation = studentSchema.safeParse(studentData);
                if (validation.success) {
                    const validStudent = validation.data as NewStudent;
                    const existingStudent = studentNisnMap.get(validStudent.nisn);
                    
                    if (existingStudent) {
                        const isIdentical = existingStudent.nama === validStudent.nama &&
                                            existingStudent.classId === validStudent.classId &&
                                            existingStudent.jenisKelamin === validStudent.jenisKelamin &&
                                            (existingStudent.parentWaNumber || "") === (validStudent.parentWaNumber || "") &&
                                            (existingStudent.status || "Aktif") === (validStudent.status || "Aktif");

                        processedStudents.push({ 
                            ...validStudent, 
                            id: existingStudent.id, 
                            importStatus: isIdentical ? 'Identik' : 'Diperbarui' 
                        });
                    } else {
                        processedStudents.push({ ...validStudent, importStatus: 'Baru' });
                    }
                } else {
                    invalidCount++;
                }
            });
            
            setImportedStudents(processedStudents);
            
            const toImportCount = processedStudents.filter(s => s.importStatus !== 'Identik').length;
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
    const studentsToProcess = importedStudents.filter(s => s.importStatus !== 'Identik');
    if (studentsToProcess.length === 0) {
        toast({ variant: "destructive", title: "Tidak ada data untuk diimpor." });
        return;
    }
    setIsImporting(true);
    try {
        const batch = writeBatch(db);
        
        studentsToProcess.forEach(student => {
            const { id, importStatus, ...studentData } = student;
            const dataToSave = { ...studentData, parentWaNumber: studentData.parentWaNumber || "" };
            if (importStatus === 'Baru') {
                const docRef = doc(collection(db, "students"));
                batch.set(docRef, dataToSave);
            } else if (importStatus === 'Diperbarui' && id) {
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

  const openAddDialog = () => {
    setEditingStudent(null)
    form.reset({ nisn: "", nama: "", classId: undefined, jenisKelamin: undefined, parentWaNumber: "", status: "Aktif" })
    setIsFormDialogOpen(true)
  }

  const openEditDialog = (student: Student) => {
    setEditingStudent(student)
    form.reset(student)
    setIsFormDialogOpen(true)
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
            <Button onClick={() => setIsGraduateAlertOpen(true)} variant="secondary">
                <Award className="mr-2 h-4 w-4" />
                Luluskan Siswa XII
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
                name="status"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Status Siswa</FormLabel>
                         <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih status siswa" />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="Aktif">Aktif</SelectItem>
                                <SelectItem value="Lulus">Lulus</SelectItem>
                                <SelectItem value="Pindah">Pindah</SelectItem>
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
                  name="parentWaNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nomor WhatsApp Ortu (Opsional)</FormLabel>
                      <FormControl>
                        <Input placeholder="cth: 6281234567890" {...field} value={field.value ?? ''} />
                      </FormControl>
                      <FormDescription>
                        Gunakan format internasional (62) tanpa spasi atau simbol.
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
                    <h3 className="font-medium">Pratinjau Data ({importedStudents.filter(s => s.importStatus !== 'Identik').length} akan diproses)</h3>
                    <div className="max-h-60 overflow-auto rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status Impor</TableHead>
                                    <TableHead>NISN</TableHead>
                                    <TableHead>Nama</TableHead>
                                    <TableHead>Kelas</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {importedStudents.map((student, index) => (
                                    <TableRow key={index} className={student.importStatus === 'Identik' ? 'text-muted-foreground' : ''}>
                                        <TableCell>
                                            <Badge variant={student.importStatus === 'Baru' ? 'default' : student.importStatus === 'Diperbarui' ? 'secondary' : 'outline'}>
                                                {student.importStatus}
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
            <Button onClick={handleSaveImportedStudents} disabled={importedStudents.filter(s => s.importStatus !== 'Identik').length === 0 || isImporting}>
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
              Tindakan ini tidak dapat dibatalkan. Ini akan menghapus data {deletingStudentId ? '1 siswa' : `${selectedRowIds.length} siswa`} secara permanen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleDeleteStudent(deletingStudentId ? [deletingStudentId] : selectedRowIds)}>Hapus</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isGraduateAlertOpen} onOpenChange={setIsGraduateAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Konfirmasi Kelulusan</AlertDialogTitle>
            <AlertDialogDescription>
              Anda akan mengubah status semua siswa aktif di kelas XII menjadi "Lulus". Tindakan ini tidak dapat dibatalkan dengan mudah. Lanjutkan?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction onClick={handleGraduateStudents} disabled={isGraduating}>
              {isGraduating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ya, Luluskan Siswa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

       <Dialog open={isMoveDialogOpen} onOpenChange={setIsMoveDialogOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Pindahkan Kelas Siswa</DialogTitle>
                    <DialogDescription>
                        Anda akan memindahkan {selectedRowIds.length} siswa terpilih. Silakan pilih kelas tujuan.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="target-class">Kelas Tujuan</Label>
                        <Select onValueChange={setTargetClassId} value={targetClassId}>
                            <SelectTrigger id="target-class">
                                <SelectValue placeholder="Pilih kelas tujuan..." />
                            </SelectTrigger>
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
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsMoveDialogOpen(false)}>Batal</Button>
                    <Button onClick={handleMoveClass} disabled={isMoving}>
                        {isMoving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Pindahkan Siswa
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle>Daftar Siswa</CardTitle>
              <CardDescription>
                Tabel berisi semua siswa yang terdaftar. Gunakan filter di bawah untuk mencari data.
              </CardDescription>
            </div>
            <div className="flex gap-2">
                {selectedRowIds.length > 0 && (
                    <>
                        <Button variant="outline" onClick={() => setIsMoveDialogOpen(true)}>
                            <ChevronsRight className="mr-2 h-4 w-4" />
                            Pindahkan Kelas ({selectedRowIds.length})
                        </Button>
                        <Button variant="destructive" onClick={() => openDeleteAlert(null)}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Hapus ({selectedRowIds.length})
                        </Button>
                    </>
                )}
            </div>
          </div>
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
                    <TableHead padding="checkbox" className="w-[60px]">
                      <Checkbox
                        checked={selectedRowIds.length === filteredStudents.length && filteredStudents.length > 0}
                        onCheckedChange={(checked) => {
                          const isChecked = checked === true;
                          if (isChecked) {
                            setSelectedRowIds(filteredStudents.map((s) => s.id));
                          } else {
                            setSelectedRowIds([]);
                          }
                        }}
                        aria-label="Pilih semua baris"
                      />
                    </TableHead>
                    <TableHead>NISN</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead>Nama Kelas</TableHead>
                    <TableHead>Tingkat</TableHead>
                    <TableHead>Jenis Kelamin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredStudents.length > 0 ? (
                    filteredStudents.map((student) => {
                        const classInfo = classObjectMap.get(student.classId);
                        const isSelected = selectedRowIds.includes(student.id);
                        const status = student.status || "Aktif";
                        return (
                            <TableRow key={student.id} data-state={isSelected ? "selected" : ""}>
                             <TableCell padding="checkbox">
                                <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => {
                                        const isChecked = checked === true;
                                        if (isChecked) {
                                            setSelectedRowIds((prev) => [...prev, student.id]);
                                        } else {
                                            setSelectedRowIds((prev) => prev.filter((id) => id !== student.id));
                                        }
                                    }}
                                    aria-label={`Pilih baris ${student.nama}`}
                                />
                             </TableCell>
                            <TableCell>{student.nisn}</TableCell>
                            <TableCell className="font-medium">{student.nama}</TableCell>
                            <TableCell>{classInfo ? classInfo.name : 'Kelas Dihapus'}</TableCell>
                            <TableCell>{classInfo ? classInfo.grade : 'N/A'}</TableCell>
                            <TableCell>{student.jenisKelamin}</TableCell>
                            <TableCell>
                                <Badge variant={status === 'Lulus' ? 'secondary' : status === 'Pindah' ? 'outline' : 'default'}>{status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
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
                        <TableCell colSpan={8} className="h-24 text-center">
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

    