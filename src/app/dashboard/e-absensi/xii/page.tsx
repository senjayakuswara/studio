import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function EAbsensiXIIPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">E-Absensi Kelas XII</h1>
                <p className="text-muted-foreground">Lakukan absensi untuk siswa kelas XII.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Ambil Absensi</CardTitle>
           <CardDescription>
            Pilih siswa dan status absensi.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Fungsionalitas absensi akan diimplementasikan di sini.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
