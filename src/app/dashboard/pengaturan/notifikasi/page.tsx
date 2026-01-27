"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Trash2 } from "lucide-react";

export default function NotifikasiPage() {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="font-headline text-3xl font-bold tracking-tight">Antrean Notifikasi</h1>
                <p className="text-muted-foreground">Fitur ini telah dihapus.</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>Fitur Dihapus</CardTitle>
                    <CardDescription>Fitur antrean notifikasi telah dihapus dari aplikasi.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Alert variant="destructive">
                        <Trash2 className="h-4 w-4" />
                        <AlertTitle>Fungsionalitas Dihapus</AlertTitle>
                        <AlertDescription>
                            Seluruh fungsionalitas terkait server notifikasi WhatsApp telah dihapus dari proyek ini untuk meningkatkan stabilitas. Halaman ini sudah tidak aktif.
                        </AlertDescription>
                    </Alert>
                </CardContent>
            </Card>
        </div>
    );
}
