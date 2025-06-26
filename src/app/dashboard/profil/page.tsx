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

export default function ProfilPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">Profil Saya</h1>
          <p className="text-muted-foreground">Kelola informasi profil dan keamanan akun Anda.</p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi Admin</CardTitle>
            <CardDescription>
              Detail personal Anda. Email tidak dapat diubah.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nama">Nama</Label>
              <Input id="nama" defaultValue="Admin" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue="admin@absen.com" disabled />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ubah Password</CardTitle>
            <CardDescription>
              Pastikan untuk menggunakan password yang kuat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password-lama">Password Lama</Label>
              <Input id="password-lama" type="password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password-baru">Password Baru</Label>
              <Input id="password-baru" type="password" />
            </div>
             <div className="space-y-2">
              <Label htmlFor="konfirmasi-password">Konfirmasi Password Baru</Label>
              <Input id="konfirmasi-password" type="password" />
            </div>
          </CardContent>
        </Card>
      </div>
       <div className="flex justify-end">
          <Button>Simpan Perubahan</Button>
      </div>
    </div>
  )
}
