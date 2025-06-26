
"use client"

import { useState, useEffect } from "react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import { Loader2 } from "lucide-react"

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
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

type SchoolHoursSettings = {
  jamMasuk: string
  jamPulang: string
  toleransi: string
}

export default function JamPage() {
  const [settings, setSettings] = useState<SchoolHoursSettings>({
    jamMasuk: "07:00",
    jamPulang: "15:00",
    toleransi: "15",
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true)
      try {
        const docRef = doc(db, "settings", "schoolHours")
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          setSettings(docSnap.data() as SchoolHoursSettings)
        }
      } catch (error) {
        console.error("Error fetching settings:", error)
        toast({
          variant: "destructive",
          title: "Gagal Memuat Pengaturan",
          description: "Gagal terhubung ke server. Silakan coba lagi nanti.",
        })
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [toast])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const docRef = doc(db, "settings", "schoolHours")
      await setDoc(docRef, settings, { merge: true })
      toast({
        title: "Pengaturan Disimpan",
        description: "Pengaturan jam sekolah telah berhasil diperbarui.",
      })
    } catch (error) {
      console.error("Error saving settings:", error)
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan pengaturan.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target
    setSettings((prev) => ({ ...prev, [id]: value }))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">
            Pengaturan Jam Sekolah
          </h1>
          <p className="text-muted-foreground">
            Atur jam masuk, pulang, dan toleransi keterlambatan.
          </p>
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
          {isLoading ? (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
                <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="jamMasuk">Jam Masuk</Label>
                  <Input
                    id="jamMasuk"
                    type="time"
                    value={settings.jamMasuk}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jamPulang">Jam Pulang</Label>
                  <Input
                    id="jamPulang"
                    type="time"
                    value={settings.jamPulang}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="toleransi">
                  Toleransi Keterlambatan (menit)
                </Label>
                <Input
                  id="toleransi"
                  type="number"
                  value={settings.toleransi}
                  onChange={handleChange}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving || isLoading}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Simpan Pengaturan
        </Button>
      </div>
    </div>
  )
}
