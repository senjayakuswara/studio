import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PlusCircle } from "lucide-react"

export default function SiswaPage() {
  return (
    <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Manajemen Siswa</h1>
                <p className="text-muted-foreground">Kelola data siswa di sini.</p>
            </div>
            <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Tambah Siswa
            </Button>
        </div>
      <Card>
        <CardHeader>
          <CardTitle>Daftar Siswa</CardTitle>
          <CardDescription>
            Tabel berisi semua siswa yang terdaftar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Fungsionalitas tabel data siswa akan diimplementasikan di sini.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
