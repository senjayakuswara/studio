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
import { Switch } from "@/components/ui/switch"

export default function NotifikasiPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Pengaturan Notifikasi</h1>
                <p className="text-muted-foreground">Konfigurasi notifikasi Telegram.</p>
            </div>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Integrasi Telegram</CardTitle>
          <CardDescription>
            Hubungkan bot Telegram untuk mengirim notifikasi absensi otomatis.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
            <div className="space-y-2">
                <Label htmlFor="telegram-token">Token Bot Telegram</Label>
                <Input id="telegram-token" placeholder="Masukkan token bot Anda" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="chat-id">Chat ID Grup/Channel</Label>
                <Input id="chat-id" placeholder="Masukkan Chat ID tujuan" />
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="notif-terlambat" />
                <Label htmlFor="notif-terlambat">Kirim notifikasi untuk siswa terlambat</Label>
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="notif-absen" />
                <Label htmlFor="notif-absen">Kirim notifikasi untuk siswa yang tidak hadir</Label>
            </div>
            <div className="flex justify-end gap-2">
                <Button variant="outline">Test Notifikasi</Button>
                <Button>Simpan Pengaturan</Button>
            </div>
        </CardContent>
      </Card>
    </div>
  )
}
