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
import { Separator } from "@/components/ui/separator"

type ReportSettings = {
  headerLine1: string
  headerLine2: string
  headerLine3: string
  schoolName: string
  address: string
  logoUrlLeft: string | null
  logoUrlRight: string | null
  reportTitle: string
  
  reportLocation: string
  signatoryName: string
  signatoryNpa: string
  principalName: string
  principalNpa: string
}

export default function LaporanPage() {
  const [settings, setSettings] = useState<ReportSettings>({
    headerLine1: "",
    headerLine2: "",
    headerLine3: "",
    schoolName: "",
    address: "",
    logoUrlLeft: null,
    logoUrlRight: null,
    reportTitle: "",
    reportLocation: "",
    signatoryName: "",
    signatoryNpa: "",
    principalName: "",
    principalNpa: "",
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
                headerLine1: "PERWAKILAN YAYASAN PEMBINA LEMBAGA PENDIDIKAN",
                headerLine2: "PERSATUAN GURU REPUBLIK INDONESIA (YPLP – PGRI)",
                headerLine3: "KABUPATEN CIANJUR",
                schoolName: "SMA PGRI NARINGGUL",
                address: "Jalan Raya Naringgul No.1. Desa Naringgul Kec. Naringgul. Kode Pos 43274",
                reportTitle: "Laporan Absensi Harian",
                logoUrlLeft: null,
                logoUrlRight: null,
                reportLocation: "Naringgul",
                signatoryName: "(.........................)",
                signatoryNpa: "NPA: .....................",
                principalName: "(.........................)",
                principalNpa: "NIP: ......................",
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

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, side: 'left' | 'right') => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const logoUrlKey = side === 'left' ? 'logoUrlLeft' : 'logoUrlRight';
        setSettings((prev) => ({ ...prev, [logoUrlKey]: reader.result as string }))
      }
      reader.readAsDataURL(file)
    }
  }
  
  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings(prev => ({...prev, [id]: value}));
  }

  const renderLogoUploader = (side: 'left' | 'right', label: string) => (
      <div className="space-y-2">
          <Label htmlFor={`logo-upload-${side}`}>{label}</Label>
          <div className="flex items-center justify-center w-full">
              <label htmlFor={`dropzone-file-${side}`} className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer bg-card hover:bg-muted relative">
                  {side === 'left' ? settings.logoUrlLeft : settings.logoUrlRight ? (
                      <Image src={side === 'left' ? settings.logoUrlLeft! : settings.logoUrlRight!} alt="Logo Preview" layout="fill" objectFit="contain" className="rounded-lg p-2" />
                  ) : (
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <UploadCloud className="w-8 h-8 mb-4 text-muted-foreground" />
                          <p className="mb-2 text-sm text-muted-foreground"><span className="font-semibold">Klik untuk unggah</span></p>
                          <p className="text-xs text-muted-foreground">PNG atau JPG</p>
                      </div>
                  )}
                  <Input id={`dropzone-file-${side}`} type="file" className="hidden" onChange={(e) => handleFileChange(e, side)} accept="image/png, image/jpeg" />
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
            Sesuaikan kop, logo, dan titimangsa pada laporan PDF yang dicetak.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Header / Kop Surat Laporan</CardTitle>
          <CardDescription>
            Informasi ini akan digunakan untuk membuat kop surat di bagian atas setiap laporan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64 w-full" /> : (
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {renderLogoUploader('left', 'Logo Kiri (Contoh: Logo Yayasan/PGRI)')}
                    {renderLogoUploader('right', 'Logo Kanan (Contoh: Logo Sekolah)')}
                </div>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="headerLine1">Baris Header 1</Label>
                        <Input id="headerLine1" value={settings.headerLine1} onChange={handleChange} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="headerLine2">Baris Header 2</Label>
                        <Input id="headerLine2" value={settings.headerLine2} onChange={handleChange} />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="headerLine3">Baris Header 3 (Besar & Tebal)</Label>
                        <Input id="headerLine3" value={settings.headerLine3} onChange={handleChange} />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="schoolName">Baris Header 4 / Nama Sekolah (Besar & Tebal)</Label>
                        <Input id="schoolName" value={settings.schoolName} onChange={handleChange} />
                    </div>
                </div>
                 <div className="space-y-2">
                    <Label htmlFor="address">Baris Header 5 / Alamat</Label>
                    <Input id="address" value={settings.address} onChange={handleChange} />
                </div>
                <Separator />
                 <div className="space-y-2">
                    <Label htmlFor="reportTitle">Judul Utama Laporan</Label>
                    <Input id="reportTitle" value={settings.reportTitle} onChange={handleChange} />
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
