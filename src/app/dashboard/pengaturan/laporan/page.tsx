import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function LaporanPage() {
  return (
     <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Desain Laporan</h1>
                <p className="text-muted-foreground">Sesuaikan tampilan laporan PDF.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Template Laporan</CardTitle>
          <CardDescription>
            Ubah logo, kop surat, dan elemen lain pada laporan yang dicetak.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Fungsionalitas kustomisasi laporan akan diimplementasikan di sini.
          </p>
          <Button>Unggah Logo Sekolah</Button>
        </CardContent>
      </Card>
    </div>
  )
}
