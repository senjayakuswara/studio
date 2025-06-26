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
import { Separator } from "@/components/ui/separator"

type ReportSettings = {
  headerImageUrl: string | null
  reportTitle: string
  reportLocation: string
  signatoryName: string
  signatoryNpa: string
  principalName: string
  principalNpa: string
}

export default function LaporanPage() {
  const [settings, setSettings] = useState<ReportSettings>({
    headerImageUrl: null,
    reportTitle: "Laporan Absensi Harian",
    reportLocation: "Naringgul",
    signatoryName: "(.........................)",
    signatoryNpa: "NPA: .....................",
    principalName: "(.........................)",
    principalNpa: "NIP: ......................",
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
          // Merge fetched data with defaults to avoid missing fields if DB is old
          const fetchedData = docSnap.data() as Partial<ReportSettings>;
          setSettings(prev => ({...prev, ...fetchedData}));
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
      if (file.size > 2 * 1024 * 1024) { // 2MB limit
        toast({
          variant: "destructive",
          title: "Ukuran File Terlalu Besar",
          description: "Ukuran gambar kop surat tidak boleh melebihi 2MB.",
        });
        return;
      }
      const reader = new FileReader()
      reader.onloadend = () => {
        setSettings((prev) => ({ ...prev, headerImageUrl: reader.result as string }))
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setSettings(prev => ({...prev, [id]: value}));
  }

  const renderLogoUploader = () => (
      <div className="space-y-2">
          <Label htmlFor="header-image-upload">Gambar Kop Surat</Label>
          <p className="text-sm text-muted-foreground">Unggah gambar kop surat dalam format PNG atau JPG. Ukuran rekomendasi 2100x350 piksel (lebar A4).</p>
          <div className="flex items-center justify-center w-full">
              <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted relative">
                  {settings.headerImageUrl ? (
                      <Image src={settings.headerImageUrl} alt="Header Preview" layout="fill" objectFit="contain" className="rounded-lg p-2" />
                  ) : (
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <UploadCloud className="w-8 h-8 mb-4 text-muted-foreground" />
                          <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Klik untuk unggah</span> atau seret dan lepas</p>
                          <p className="text-xs text-muted-foreground">PNG atau JPG (Maks. 2MB)</p>
                      </div>
                  )}
                  <Input id="dropzone-file" type="file" className="hidden" onChange={handleFileChange} accept="image/png, image/jpeg" />
              </label>
          </div>
      </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-headline text-3xl font-bold tracking-tight">
            Pengaturan Desain Laporan
          </h1>
          <p className="text-muted-foreground">
            Sesuaikan kop surat, judul, dan titimangsa pada laporan PDF yang dicetak.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Desain Laporan Global</CardTitle>
          <CardDescription>
            Pengaturan ini akan digunakan untuk semua laporan yang dicetak dari sistem.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <div className="space-y-6">
                {renderLogoUploader()}
                <Separator />
                <div className="space-y-2">
                    <Label htmlFor="reportTitle">Judul Utama Laporan</Label>
                    <Input id="reportTitle" value={settings.reportTitle} onChange={handleChange} placeholder="Contoh: Laporan Absensi Harian"/>
                     <p className="text-xs text-muted-foreground">Judul ini akan tampil di bawah kop surat.</p>
                </div>
            </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle>Titimangsa / Penandatangan</CardTitle>
          <CardDescription>
            Atur detail untuk area tanda tangan di bagian bawah laporan.
          </CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <div className="space-y-6">
                <div className="space-y-2">
                    <Label htmlFor="reportLocation">Lokasi Penerbitan Laporan</Label>
                    <Input id="reportLocation" placeholder="Contoh: Jakarta, Bandung" value={settings.reportLocation} onChange={handleChange} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
            </div>
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
