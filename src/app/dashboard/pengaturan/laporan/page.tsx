"use client"

import { useState, useEffect, type ChangeEvent } from "react"
import { doc, getDoc, setDoc } from "firebase/firestore"
import Image from "next/image"
import { UploadCloud, Loader2 } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"

type ReportSettings = {
  title: string
  signatoryName: string
  signatoryNpa: string
  principalName: string
  principalNpa: string
  logoUrl: string | null
}

export default function LaporanPage() {
  const [settings, setSettings] = useState<ReportSettings>({
    title: "",
    signatoryName: "",
    signatoryNpa: "",
    principalName: "",
    principalNpa: "",
    logoUrl: null,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    async function fetchSettings() {
      setIsLoading(true)
      try {
        const docRef = doc(db, "settings", "reportConfig")
        const docSnap = await getDoc(docRef)
        if (docSnap.exists()) {
          setSettings(docSnap.data() as ReportSettings)
        } else {
            setSettings({
                title: "Laporan E-Absensi SMAS PGRI Naringgul",
                signatoryName: "(.........................)",
                signatoryNpa: "NPA: .....................",
                principalName: "(.........................)",
                principalNpa: "NIP: ......................",
                logoUrl: null
            })
        }
      } catch (error) {
        console.error("Error fetching report settings:", error)
        toast({
          variant: "destructive",
          title: "Gagal Memuat Pengaturan",
          description: "Gagal mengambil data pengaturan laporan dari server.",
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
      const docRef = doc(db, "settings", "reportConfig")
      await setDoc(docRef, settings, { merge: true })
      toast({
        title: "Pengaturan Disimpan",
        description: "Pengaturan desain laporan telah berhasil diperbarui.",
      })
    } catch (error) {
      console.error("Error saving report settings:", error)
      toast({
        variant: "destructive",
        title: "Gagal Menyimpan",
        description: "Terjadi kesalahan saat menyimpan pengaturan.",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setSettings((prev) => ({ ...prev, logoUrl: reader.result as string }))
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings(prev => ({...prev, [id]: value}));
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">
            Pengaturan Desain Laporan
          </h1>
          <p className="text-muted-foreground">
            Sesuaikan kop, logo, dan titimangsa pada laporan PDF yang dicetak.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Template Laporan</CardTitle>
          <CardDescription>
            Informasi ini akan digunakan setiap kali Anda mencetak laporan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Skeleton className="h-32 w-full" />
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                    <Label htmlFor="app-logo">Logo Sekolah/Laporan</Label>
                    <div className="flex items-center justify-center w-full">
                        <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted relative">
                            {settings.logoUrl ? (
                                <Image src={settings.logoUrl} alt="Logo Preview" layout="fill" objectFit="contain" className="rounded-lg p-2" />
                            ) : (
                                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                    <UploadCloud className="w-8 h-8 mb-4 text-muted-foreground" />
                                    <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Klik untuk unggah</span></p>
                                    <p className="text-xs text-muted-foreground">PNG atau JPG</p>
                                </div>
                            )}
                            <Input id="dropzone-file" type="file" className="hidden" onChange={handleFileChange} accept="image/png, image/jpeg" />
                        </label>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="title">Judul / Kop Laporan</Label>
                        <Textarea id="title" placeholder="Contoh: Laporan Kehadiran Siswa&#10;SMK Teknologi Bangsa" value={settings.title} onChange={handleChange} />
                    </div>
                </div>
                
                <div className="space-y-4">
                    <h3 className="text-sm font-medium">Penandatangan (Kolom Kiri)</h3>
                     <div className="space-y-2">
                        <Label htmlFor="principalName">Nama Kepala Sekolah</Label>
                        <Input id="principalName" placeholder="(.........................)" value={settings.principalName} onChange={handleChange} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="principalNpa">NIP/NPA Kepala Sekolah</Label>
                        <Input id="principalNpa" placeholder="NIP: ........................" value={settings.principalNpa} onChange={handleChange} />
                    </div>
                </div>
                
                <div className="space-y-4">
                     <h3 className="text-sm font-medium">Penandatangan (Kolom Kanan)</h3>
                     <div className="space-y-2">
                        <Label htmlFor="signatoryName">Nama Petugas</Label>
                        <Input id="signatoryName" placeholder="(.........................)" value={settings.signatoryName} onChange={handleChange} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="signatoryNpa">NPA/NIP Petugas</Label>
                        <Input id="signatoryNpa" placeholder="NPA: ....................." value={settings.signatoryNpa} onChange={handleChange} />
                    </div>
                </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Laporan Bulanan</CardTitle>
          <CardDescription>Fitur ini sedang dalam pengembangan.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Fungsionalitas untuk mencetak laporan rekapitulasi bulanan akan segera tersedia di sini.</p>
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
