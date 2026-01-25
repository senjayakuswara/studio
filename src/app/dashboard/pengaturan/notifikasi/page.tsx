
"use client"

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { id as localeID } from "date-fns/locale";
import { retryNotificationJob, deleteNotificationJob, type NotificationJob } from "@/ai/flows/notification-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Bot, Loader2, RefreshCw, Trash2, Send, Clock, CheckCircle2, XCircle, Hourglass, HelpCircle } from "lucide-react";
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const PAGE_SIZE = 50;

export default function NotifikasiPage() {
    const [jobs, setJobs] = useState<NotificationJob[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isProcessingAction, setIsProcessingAction] = useState<string | null>(null);
    
    const { toast } = useToast();

    useEffect(() => {
        setIsLoading(true);
        const q = query(collection(db, "notification_queue"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));

        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const fetchedJobs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as NotificationJob[];
            setJobs(fetchedJobs);
            setIsLoading(false);
        }, (error) => {
            console.error("Error fetching notification jobs:", error);
            toast({
                variant: "destructive",
                title: "Gagal Memuat Data",
                description: "Tidak dapat memuat antrean notifikasi dari server."
            });
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [toast]);

    const handleRetry = async (jobId: string) => {
        setIsProcessingAction(jobId);
        const result = await retryNotificationJob(jobId);
        if (result.success) {
            toast({ title: "Tugas Dikirim Ulang", description: "Notifikasi telah ditambahkan kembali ke antrean." });
        } else {
            toast({ variant: "destructive", title: "Gagal", description: result.error });
        }
        setIsProcessingAction(null);
    };

    const handleDelete = async (jobId: string) => {
        setIsProcessingAction(jobId);
        try {
            await deleteNotificationJob(jobId);
            toast({ title: "Dihapus", description: "Notifikasi telah dihapus dari antrean." });
        } catch (error) {
            toast({ variant: "destructive", title: "Gagal Menghapus" });
        }
        setIsProcessingAction(null);
    };
    
    const getStatusVariant = (status: NotificationJob['status']): 'default' | 'secondary' | 'destructive' | 'outline' => {
        switch (status) {
            case 'sent': return 'default';
            case 'pending': return 'secondary';
            case 'processing': return 'secondary';
            case 'failed': return 'destructive';
            default: return 'outline';
        }
    }

    const getStatusIcon = (status: NotificationJob['status']) => {
        switch (status) {
            case 'sent': return <CheckCircle2 className="h-4 w-4 mr-2" />;
            case 'pending': return <Clock className="h-4 w-4 mr-2" />;
            case 'processing': return <Hourglass className="h-4 w-4 mr-2 animate-spin" />;
            case 'failed': return <XCircle className="h-4 w-4 mr-2" />;
            default: return <HelpCircle className="h-4 w-4 mr-2"/>;
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="font-headline text-3xl font-bold tracking-tight">Antrean Notifikasi</h1>
                    <p className="text-muted-foreground">Kelola notifikasi yang tertunda atau gagal terkirim.</p>
                </div>
            </div>
            
            <Alert variant="default">
                <Bot className="h-4 w-4" />
                <AlertTitle>Pusat Kontrol Notifikasi</AlertTitle>
                <AlertDescription>
                    Halaman ini menampilkan status pengiriman pesan WhatsApp secara real-time. Jika server WhatsApp lokal Anda mati, tugas akan tetap berstatus "pending". Setelah server menyala, tugas akan diproses secara otomatis. Anda bisa mengirim ulang tugas yang "gagal" dengan tombol "Kirim Ulang".
                </AlertDescription>
            </Alert>
            
            <Card>
                <CardHeader>
                    <CardTitle>Daftar Tugas Notifikasi</CardTitle>
                    <CardDescription>Menampilkan {PAGE_SIZE} notifikasi terakhir secara real-time.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Tujuan</TableHead>
                                    <TableHead>Waktu Dibuat</TableHead>
                                    <TableHead>Pesan / Error</TableHead>
                                    <TableHead className="text-right">Aksi</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    [...Array(10)].map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                                        </TableRow>
                                    ))
                                ) : jobs.length > 0 ? (
                                    jobs.map(job => (
                                        <TableRow key={job.id}>
                                            <TableCell>
                                                <Badge variant={getStatusVariant(job.status)} className="capitalize flex items-center w-fit">
                                                    {getStatusIcon(job.status)}
                                                    {job.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                <div className='flex flex-col'>
                                                    <span>{job.phone}</span>
                                                    <span className='text-xs text-muted-foreground'>
                                                         {(job.metadata as any)?.studentName || 'N/A'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span>{format(job.createdAt.toDate(), "d MMM yyyy, HH:mm", { locale: localeID })}</span>
                                                    <span className="text-xs text-muted-foreground">{formatDistanceToNow(job.createdAt.toDate(), { addSuffix: true, locale: localeID })}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <p className="max-w-xs truncate text-xs cursor-help">
                                                                {job.status === 'failed' ? <span className='text-destructive'>{job.error}</span> : job.message}
                                                            </p>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p className="max-w-sm">{job.status === 'failed' ? job.error : job.message}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex gap-2 justify-end">
                                                    {job.status === 'failed' && (
                                                        <Button size="sm" variant="outline" onClick={() => handleRetry(job.id)} disabled={isProcessingAction !== null}>
                                                            {isProcessingAction === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                                        </Button>
                                                    )}
                                                     <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive" disabled={isProcessingAction !== null}>
                                                                 <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Anda Yakin?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    Tindakan ini akan menghapus tugas notifikasi secara permanen.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDelete(job.id)}>Hapus</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            Tidak ada tugas notifikasi ditemukan.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
