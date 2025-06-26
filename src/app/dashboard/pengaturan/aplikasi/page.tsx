import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UploadCloud } from "lucide-react"

export default function AppSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
       <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Aplikasi</h1>
                <p className="text-muted-foreground">Sesuaikan identitas dan tampilan aplikasi.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Informasi Aplikasi</CardTitle>
          <CardDescription>
            Pengaturan ini akan mengubah bagaimana aplikasi ditampilkan kepada pengguna, termasuk di halaman login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="app-name">Nama Aplikasi</Label>
                <Input id="app-name" defaultValue="AbTrack" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="app-logo">Logo Aplikasi</Label>
                 <div className="flex items-center justify-center w-full">
                    <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <UploadCloud className="w-8 h-8 mb-4 text-muted-foreground" />
                            <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Klik untuk unggah</span> atau seret dan lepas</p>
                            <p className="text-xs text-muted-foreground">SVG, PNG, JPG (REKOM: 200x200px)</p>
                        </div>
                        <Input id="dropzone-file" type="file" className="hidden" />
                    </label>
                </div>
            </div>
        </CardContent>
      </Card>
       <Card>
        <CardHeader>
          <CardTitle>Tema & Tampilan</CardTitle>
          <CardDescription>
            Ubah skema warna aplikasi. Anda dapat menggunakan HSL color picker online untuk mendapatkan nilai warna.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="primary-color">Warna Primer (HSL)</Label>
                <Input id="primary-color" defaultValue="222.2 47.4% 11.2%" placeholder="Contoh: 222.2 47.4% 11.2%" />
                <p className="text-xs text-muted-foreground">
                    Ini akan mengubah warna utama komponen seperti tombol.
                </p>
            </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
          <Button>Simpan Pengaturan</Button>
      </div>
    </div>
  )
}
