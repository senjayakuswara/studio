
"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, addDoc, doc, deleteDoc, Timestamp } from "firebase/firestore"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { format } from "date-fns"
import { id as localeID } from "date-fns/locale"
import type { DateRange } from "react-day-picker"
import { Loader2, PlusCircle, Trash2, CalendarDays } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Skeleton } from "@/components/ui/skeleton"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const holidaySchema = z.object({
  name: z.string().min(1, "Nama hari libur tidak boleh kosong."),
  dateRange: z.object({
    from: z.date({ required_error: "Tanggal mulai harus dipilih." }),
    to: z.date().optional(),
  }),
})

type Holiday = {
  id: string
  name: string
  startDate: Timestamp
  endDate: Timestamp
}

export default function JadwalPage() {
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const { toast } = useToast()

  const form = useForm<z.infer<typeof holidaySchema>>({
    resolver: zodResolver(holidaySchema),
  })

  useEffect(() => {
    fetchHolidays()
  }, [])

  async function fetchHolidays() {
    setIsLoading(true)
    try {
      const querySnapshot = await getDocs(collection(db, "holidays"))
      const holidayList = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      })) as Holiday[]
      setHolidays(holidayList.sort((a, b) => a.startDate.toMillis() - b.startDate.toMillis()))
    } catch (error) {
      console.error("Error fetching holidays: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Memuat Data",
        description: "Tidak dapat mengambil data hari libur dari server.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSaveHoliday(values: z.infer<typeof holidaySchema>) {
    try {
      const { name, dateRange } = values
      const payload = {
        name,
        startDate: Timestamp.fromDate(dateRange.from),
        endDate: Timestamp.fromDate(dateRange.to || dateRange.from),
      }
      await addDoc(collection(db, "holidays"), payload)
      toast({ title: "Sukses", description: "Hari libur berhasil ditambahkan." })
      await fetchHolidays()
      setIsFormOpen(false)
      form.reset()
    } catch (error) {
      console.error("Error saving holiday: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan data.",
      })
    }
  }

  async function handleDeleteHoliday(id: string) {
    try {
      await deleteDoc(doc(db, "holidays", id))
      toast({ title: "Sukses", description: "Hari libur berhasil dihapus." })
      fetchHolidays()
    } catch (error) {
      console.error("Error deleting holiday: ", error)
      toast({
        variant: "destructive",
        title: "Gagal Menghapus",
        description: "Terjadi kesalahan saat menghapus data.",
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Jadwal Sekolah</h1>
          <p className="text-muted-foreground">Kelola hari libur dan jadwal khusus lainnya.</p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              Tambah Hari Libur
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Tambah Hari Libur Baru</DialogTitle>
              <DialogDescription>
                Pilih tanggal atau rentang tanggal dan beri nama. Contoh: Libur Idul Fitri.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSaveHoliday)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nama Hari Libur</FormLabel>
                      <FormControl>
                        <Input placeholder="Contoh: Libur Semester Ganjil" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dateRange"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Tanggal Libur</FormLabel>
                      <DateRangePicker
                        date={field.value}
                        onDateChange={field.onChange}
                      />
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
      </div>

      <Alert>
        <CalendarDays className="h-4 w-4" />
        <AlertTitle>Informasi</AlertTitle>
        <AlertDescription>
          Hari libur yang ditambahkan di sini akan secara otomatis mengecualikan siswa dari absensi "Alfa" pada tanggal tersebut di laporan rekapitulasi. Hari Sabtu dan Minggu juga secara otomatis dianggap sebagai hari libur.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Daftar Hari Libur Terdaftar</CardTitle>
          <CardDescription>
            Berikut adalah daftar semua hari libur yang telah dijadwalkan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-8 w-full mb-2" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : holidays.length > 0 ? (
              <ul className="divide-y">
                {holidays.map((holiday) => (
                  <li key={holiday.id} className="flex items-center justify-between p-4">
                    <div>
                      <p className="font-semibold">{holiday.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {format(holiday.startDate.toDate(), "d MMM yyyy", { locale: localeID })} - {format(holiday.endDate.toDate(), "d MMM yyyy", { locale: localeID })}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteHoliday(holiday.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-8 text-center text-muted-foreground">
                Belum ada hari libur yang ditambahkan.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
