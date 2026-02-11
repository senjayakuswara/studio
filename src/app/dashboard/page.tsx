
"use client"

import { useState, useEffect } from "react"
import { collection, getDocs, query, where, Timestamp, limit, orderBy } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useToast } from "@/hooks/use-toast"
import { onAuthChange } from "@/lib/auth"
import type { User } from "firebase/auth"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, UserCheck, UserX, Clock, UserCog, HeartPulse, FileText, BarChart3 } from "lucide-react"
import { startOfDay, endOfDay, subDays, format, eachDayOfInterval } from "date-fns"
import { id as localeID } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

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
  lateToday: number
  alfaToday: number
  sickToday: number
  permissionToday: number
  dispensationToday: number
}

type ChartData = {
  date: string;
  Hadir: number;
  Terlambat: number;
  Absen: number; // Sakit + Izin + Alfa + Dispen
}

const chartConfig = {
  Hadir: { label: "Hadir", color: "hsl(var(--chart-2))" },
  Terlambat: { label: "Terlambat", color: "hsl(var(--chart-5))" },
  Absen: { label: "Absen", color: "hsl(var(--chart-3))" },
} satisfies ChartConfig

// --- Caching Logic ---
type DashboardCache = {
  stats: DashboardStats;
  recentActivities: AttendanceRecord[];
  chartData: ChartData[];
  timestamp: number;
}
let dashboardCache: DashboardCache | null = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache
// --- End Caching Logic ---


export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    presentToday: 0,
    lateToday: 0,
    alfaToday: 0,
    sickToday: 0,
    permissionToday: 0,
    dispensationToday: 0,
  })
  const [recentActivities, setRecentActivities] = useState<AttendanceRecord[]>([])
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()
  
  const [adminName, setAdminName] = useState("Admin")

  useEffect(() => {
    const unsubscribe = onAuthChange((user: User | null) => {
        if (user) {
            setAdminName(user.displayName || "Admin");
        }
    });

    async function fetchDashboardData() {
      const now = Date.now();
      // Check if valid cache exists
      if (dashboardCache && (now - dashboardCache.timestamp < CACHE_DURATION_MS)) {
          setStats(dashboardCache.stats);
          setRecentActivities(dashboardCache.recentActivities);
          setChartData(dashboardCache.chartData);
          setIsLoading(false);
          return;
      }
      
      setIsLoading(true)
      try {
        const todayStart = startOfDay(new Date())
        const todayEnd = endOfDay(new Date())

        // Fetch total students
        const studentsSnapshot = await getDocs(collection(db, "students"))
        const totalStudents = studentsSnapshot.size

        // Fetch today's attendance records for stats cards
        const todayAttendanceQuery = query(
          collection(db, "attendance"),
          where("recordDate", ">=", todayStart),
          where("recordDate", "<=", todayEnd)
        )
        const todayAttendanceSnapshot = await getDocs(todayAttendanceQuery)
        const todayRecords = todayAttendanceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AttendanceRecord[]

        let presentToday = 0
        let lateToday = 0
        let alfaToday = 0
        let sickToday = 0
        let permissionToday = 0
        let dispensationToday = 0

        todayRecords.forEach(record => {
            switch(record.status) {
                case "Hadir":
                    presentToday++;
                    break;
                case "Terlambat":
                    presentToday++;
                    lateToday++;
                    break;
                case "Sakit": sickToday++; break;
                case "Izin": permissionToday++; break;
                case "Dispen": dispensationToday++; break;
                case "Alfa": alfaToday++; break;
            }
        })
        
        const newStats = { totalStudents, presentToday, lateToday, alfaToday, sickToday, permissionToday, dispensationToday };
        setStats(newStats);

        // Fetch recent activities
        const recentActivityQuery = query(collection(db, "attendance"), orderBy("recordDate", "desc"), limit(5))
        const recentActivitySnapshot = await getDocs(recentActivityQuery)
        const newRecentActivities = recentActivitySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AttendanceRecord);
        setRecentActivities(newRecentActivities);

        // Fetch last 7 days attendance for chart
        const sevenDaysAgo = subDays(todayStart, 6);
        const last7DaysAttendanceQuery = query(collection(db, "attendance"), where("recordDate", ">=", sevenDaysAgo), where("recordDate", "<=", todayEnd));
        const last7DaysSnapshot = await getDocs(last7DaysAttendanceQuery);
        const last7DaysRecords = last7DaysSnapshot.docs.map(doc => doc.data() as AttendanceRecord);
        
        const dateInterval = eachDayOfInterval({ start: sevenDaysAgo, end: todayStart });
        const processedChartData = dateInterval.map(day => {
            const dayString = format(day, "yyyy-MM-dd");
            const recordsForDay = last7DaysRecords.filter(r => format(r.recordDate.toDate(), "yyyy-MM-dd") === dayString);
            
            return {
                date: format(day, "dd/MM"),
                Hadir: recordsForDay.filter(r => r.status === "Hadir").length,
                Terlambat: recordsForDay.filter(r => r.status === "Terlambat").length,
                Absen: recordsForDay.filter(r => ["Sakit", "Izin", "Alfa", "Dispen"].includes(r.status)).length,
            };
        });
        setChartData(processedChartData);

        // Update cache
        dashboardCache = {
            stats: newStats,
            recentActivities: newRecentActivities,
            chartData: processedChartData,
            timestamp: Date.now()
        };


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

    return () => unsubscribe();
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
          [...Array(7)].map((_, i) => (
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
                <CardTitle className="text-sm font-medium">Terlambat</CardTitle>
                <Clock className="h-4 w-4 text-orange-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.lateToday}</div>
                <p className="text-xs text-muted-foreground">
                  Siswa datang terlambat hari ini
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Alfa</CardTitle>
                <UserX className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.alfaToday}</div>
                <p className="text-xs text-muted-foreground">
                  Siswa tidak hadir tanpa keterangan
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Sakit</CardTitle>
                <HeartPulse className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.sickToday}</div>
                <p className="text-xs text-muted-foreground">
                  Siswa dengan keterangan sakit
                </p>
              </CardContent>
            </Card>
             <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Izin</CardTitle>
                <FileText className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.permissionToday}</div>
                <p className="text-xs text-muted-foreground">
                  Siswa dengan keterangan izin
                </p>
              </CardContent>
            </Card>
             <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Dispen</CardTitle>
                <UserCog className="h-4 w-4 text-yellow-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.dispensationToday}</div>
                <p className="text-xs text-muted-foreground">
                  Siswa dengan dispensasi
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 /> Tren Kehadiran Mingguan</CardTitle>
             <CardDescription>Menampilkan data kehadiran selama 7 hari terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
              {isLoading ? (
                  <Skeleton className="w-full h-[350px]" />
              ) : chartData.length > 0 ? (
                 <ChartContainer config={chartConfig} className="w-full h-[350px]">
                  <BarChart accessibilityLayer data={chartData} margin={{ top: 20, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) => value.slice(0, 5)}
                    />
                    <YAxis allowDecimals={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="Hadir" stackId="a" fill="var(--color-Hadir)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Terlambat" stackId="a" fill="var(--color-Terlambat)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Absen" stackId="a" fill="var(--color-Absen)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                  <div className="flex h-[350px] items-center justify-center text-muted-foreground">
                      Tidak cukup data untuk menampilkan grafik.
                  </div>
              )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Aktivitas Absensi Terbaru</CardTitle>
             <CardDescription>Menampilkan 5 aktivitas terakhir.</CardDescription>
          </CardHeader>
          <CardContent>
              {isLoading ? (
                   <div className="space-y-4">
                      {[...Array(5)].map((_, i) => (
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
                                      {"bg-orange-100 text-orange-700": activity.status === 'Terlambat'},
                                      {"bg-red-100 text-red-700": activity.status === 'Alfa'},
                                      {"bg-yellow-100 text-yellow-700": ['Izin', 'Sakit', 'Dispen'].includes(activity.status)},
                                  )}>
                                      {getInitials(activity.studentName)}
                                  </AvatarFallback>
                              </Avatar>
                              <div className="flex-1">
                                  <p className="font-medium">{activity.studentName}</p>
                                  <div className="text-sm text-muted-foreground">
                                      Status: <Badge variant={statusBadgeVariant[activity.status] || 'outline'} className="ml-1">{activity.status}</Badge> 
                                      {activity.timestampMasuk && ` pada ${format(activity.timestampMasuk.toDate(), "dd/MM/yy HH:mm")}`}
                                  </div>
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
    </div>
  )
}
