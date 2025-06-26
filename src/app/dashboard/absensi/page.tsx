import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function AbsensiPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Absensi</h1>
                <p className="text-muted-foreground">Lacak dan kelola absensi siswa.</p>
            </div>
            <Button variant="outline">
                Cetak Laporan
            </Button>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Data Absensi Hari Ini</CardTitle>
           <CardDescription>
            Tabel berisi data absensi untuk hari ini.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Fungsionalitas tabel data absensi akan diimplementasikan di sini.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
