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

export default function JamPage() {
  return (
    <div className="flex flex-col gap-6">
       <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Jam Sekolah</h1>
                <p className="text-muted-foreground">Atur jam masuk, pulang, dan toleransi keterlambatan.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Jadwal Umum</CardTitle>
          <CardDescription>
            Pengaturan ini akan berlaku untuk semua siswa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="jam-masuk">Jam Masuk</Label>
                    <Input id="jam-masuk" type="time" defaultValue="07:00" />
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="jam-pulang">Jam Pulang</Label>
                    <Input id="jam-pulang" type="time" defaultValue="15:00" />
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor="toleransi">Toleransi Keterlambatan (menit)</Label>
                <Input id="toleransi" type="number" defaultValue="15" />
            </div>
             <div className="flex justify-end">
                <Button>Simpan Pengaturan</Button>
            </div>
        </CardContent>
      </Card>
    </div>
  )
}
