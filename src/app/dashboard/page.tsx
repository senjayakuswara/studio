"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, query, where, Timestamp, limit, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, UserCheck, UserX, Clock, UserCog } from "lucide-react"
import { format, startOfDay, endOfDay } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type AttendanceStatus = "Hadir" | "Terlambat" | "Sakit" | "Izin" | "Alfa" | "Dispen"
type AttendanceRecord = {
  id: string
  studentId: string
  studentName: string
  nisn: string
  classId: string
  status: AttendanceStatus
  timestampMasuk: Timestamp | null
  timestampPulang: Timestamp | null
  recordDate: Timestamp
}
const statusBadgeVariant: Record<AttendanceStatus, 'default' | 'destructive' | 'secondary'> = {
    "Hadir": "default",
    "Terlambat": "destructive",
    "Sakit": "secondary",
    "Izin": "secondary",
    "Alfa": "destructive",
    "Dispen": "secondary",
}

type DashboardStats = {
  totalStudents: number
  presentToday: number
  permissionOrSick: number
  lateToday: number
  alfaToday: number
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    presentToday: 0,
    permissionOrSick: 0,
    lateToday: 0,
    alfaToday: 0,
  })
  const [recentActivities, setRecentActivities] = useState<AttendanceRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()
  
  const [adminName, setAdminName] = useState("Admin")

  useEffect(() => {
    async function fetchDashboardData() {
      setIsLoading(true)
      try {
        const todayStart = startOfDay(new Date())
        const todayEnd = endOfDay(new Date())

        // Fetch total students
        const studentsSnapshot = await getDocs(collection(db, "students"))
        const totalStudents = studentsSnapshot.size

        // Fetch today's attendance records
        const attendanceQuery = query(
          collection(db, "attendance"),
          where("recordDate", ">=", todayStart),
          where("recordDate", "<=", todayEnd)
        )
        const attendanceSnapshot = await getDocs(attendanceQuery)
        const records = attendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AttendanceRecord[]

        let presentToday = 0
        let permissionOrSick = 0
        let lateToday = 0
        let alfaToday = 0

        records.forEach(record => {
          if (record.status === "Hadir" || record.status === "Terlambat") {
            presentToday++
          }
          if (record.status === "Sakit" || record.status === "Izin" || record.status === "Dispen") {
            permissionOrSick++
          }
          if (record.status === "Terlambat") {
            lateToday++
          }
          if (record.status === "Alfa") {
              alfaToday++
          }
        })
        
        setStats({ totalStudents, presentToday, permissionOrSick, lateToday, alfaToday })

        // Fetch recent activities
        const recentActivityQuery = query(
          collection(db, "attendance"),
          orderBy("recordDate", "desc"),
          limit(5)
        )
        const recentActivitySnapshot = await getDocs(recentActivityQuery)
        setRecentActivities(recentActivitySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AttendanceRecord))

      } catch (error) {
        console.error("Error fetching dashboard data:", error)
        toast({
          variant: "destructive",
          title: "Gagal Memuat Data Dashboard",
          description: "Gagal mengambil data dari server. Periksa koneksi Anda.",
        })
      } finally {
        setIsLoading(false)
      }
    }
    fetchDashboardData()
  }, [toast])

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase()
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-headline text-3xl font-bold tracking-tight">
          Selamat Datang, {adminName}!
        </h1>
        <p className="text-muted-foreground">
          Berikut adalah ringkasan aktivitas sekolah hari ini, {format(new Date(), "eeee, dd MMMM yyyy", { locale: localeID })}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          [...Array(4)].map((_, i) => (
             <Card key={i}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-5 w-5 rounded-full" />
                </CardHeader>
                <CardContent>
                    <Skeleton className="h-8 w-1/3 mb-2" />
                    <Skeleton className="h-4 w-full" />
                </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Siswa</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalStudents}</div>
                <p className="text-xs text-muted-foreground">
                  Jumlah siswa terdaftar di sekolah
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Hadir Hari Ini</CardTitle>
                <UserCheck className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.presentToday}</div>
                <p className="text-xs text-muted-foreground">
                  dari {stats.totalStudents} siswa
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Izin / Sakit / Dispen</CardTitle>
                <UserCog className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.permissionOrSick}</div>
                <p className="text-xs text-muted-foreground">
                  Total absensi dengan keterangan
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Terlambat & Alfa</CardTitle>
                <UserX className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.lateToday + stats.alfaToday}</div>
                <p className="text-xs text-muted-foreground">
                  {stats.lateToday} terlambat, {stats.alfaToday} alfa
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Aktivitas Absensi Terbaru</CardTitle>
           <CardDescription>Menampilkan 5 aktivitas terakhir.</CardDescription>
        </CardHeader>
        <CardContent>
            {isLoading ? (
                 <div className="space-y-4">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center space-x-4">
                            <Skeleton className="h-10 w-10 rounded-full" />
                            <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-3/4" />
                                <Skeleton className="h-3 w-1/2" />
                            </div>
                        </div>
                    ))}
                 </div>
            ) : recentActivities.length > 0 ? (
                <div className="space-y-4">
                    {recentActivities.map(activity => (
                        <div key={activity.id} className="flex items-center space-x-4">
                            <Avatar className="h-10 w-10">
                                <AvatarFallback className={cn(
                                    {"bg-green-100 text-green-700": activity.status === 'Hadir'},
                                    {"bg-red-100 text-red-700": activity.status === 'Terlambat' || activity.status === 'Alfa'},
                                    {"bg-yellow-100 text-yellow-700": activity.status === 'Izin' || activity.status === 'Sakit' || activity.status === 'Dispen'},
                                )}>
                                    {getInitials(activity.studentName)}
                                </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                                <p className="font-medium">{activity.studentName}</p>
                                <p className="text-sm text-muted-foreground">
                                    Status: <Badge variant={statusBadgeVariant[activity.status] || 'outline'} className="ml-1">{activity.status}</Badge> 
                                    {activity.timestampMasuk && ` pada ${format(activity.timestampMasuk.toDate(), "dd/MM/yy HH:mm")}`}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="text-center text-muted-foreground py-8">Belum ada aktivitas absensi hari ini.</p>
            )}
        </CardContent>
      </Card>
    </div>
  )
}
