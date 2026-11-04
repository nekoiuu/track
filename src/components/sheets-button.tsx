"use client";

import { useState, useTransition } from "react";
import { Loader2Icon, SheetIcon } from "lucide-react";
import { toast } from "sonner";
import { exportParcelsToSheets } from "@/app/actions/sheets";
import { SHEET_COLUMNS, dailyTabName } from "@/lib/sheets-columns";
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
import { Button } from "@/components/ui/button";
import { visibleRows } from "./copy-trackings";

/**
 * ส่งแถวที่เห็นอยู่ (ตามตัวกรอง/ค้นหา) ไป Google Sheets (เคยส่งแล้ว = อัปเดตแถวเดิม) — แท็บรายวัน (8OCT26) ตามคอลัมน์ใน SHEET_COLUMNS
 * แถวต้องใส่ data-pid={id ของกล่อง} · กดแล้วขึ้นกล่องยืนยัน (จำนวนแถว + คอลัมน์) ก่อนส่งจริง
 * ยังไม่ได้ตั้งค่า .env → ปุ่มยังอยู่ แต่กดแล้วบอกว่าต้องตั้งค่าอะไร
 */
export function SendToSheetsButton({
  scope,
  sheetUrl,
  configured,
  pickupId,
  compact = false,
}: {
  scope: string;
  sheetUrl: string;
  configured: boolean;
  /** ส่งจากหน้ารอบรถ — ใช้รถคันนี้ (วันที่/ทะเบียน) เสมอ */
  pickupId?: string;
  /** ปุ่มเล็กสำหรับหัวแต่ละใบ */
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [ids, setIds] = useState<string[] | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);

  const ask = () => {
    if (!configured) {
      return void toast.error("ยังไม่ได้ตั้งค่า Google Sheets", {
        description: "ใส่ GOOGLE_SHEETS_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_KEY ใน .env (วิธีดูใน .env.example)",
        duration: 10_000,
      });
    }
    const rows = visibleRows(scope).filter((r) => r.dataset.pid);
    if (!rows.length) return void toast.error("ไม่มีรายการให้ส่ง");
    // แท็บที่จะไปลง (ตามวันที่รถเข้ารับ — server คำนวณแบบเดียวกัน)
    setTabs([...new Set(rows.map((r) => r.dataset.tab ?? dailyTabName(new Date())))]);
    setIds([...new Set(rows.map((r) => r.dataset.pid!))]);
  };

  const send = () =>
    start(async () => {
      const res = await exportParcelsToSheets(ids ?? [], pickupId);
      setIds(null);
      if (!res?.ok) return void toast.error(res?.message ?? "ส่งไม่สำเร็จ", { duration: 10_000 });
      toast.success(res.message, { action: { label: "เปิดชีต", onClick: () => window.open(sheetUrl, "_blank", "noopener") } });
    });

  return (
    <>
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "sm" : "default"}
        className={compact ? "no-print h-9 shrink-0 text-body" : "no-print mb-3 h-11"}
        // อยู่ในหัวใบที่พับได้ (summary) — กดแล้วไม่ให้ใบพับ/กางตาม
        onClick={(e) => {
          e.preventDefault();
          ask();
        }}
        disabled={pending}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <SheetIcon />}
        {pending ? "กำลังส่ง…" : compact ? "Sheets" : "ส่งไป Google Sheets"}
      </Button>

      <AlertDialog open={ids !== null} onOpenChange={(o) => !o && !pending && setIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ส่ง {ids?.length ?? 0} แถวไป Google Sheets?</AlertDialogTitle>
            <AlertDialogDescription>
              แถวละ 1 กล่อง ลงแท็บของวันที่รถเข้ารับ: <b className="font-mono text-ink">{tabs.join(", ")}</b>
              <br />
              เคยส่งแล้ว = อัปเดตแถวเดิม (ไม่ซ้ำ) · ยังไม่เคย = ต่อท้าย · ยังไม่มีแท็บวันนั้นจะสร้างให้พร้อมหัวตาราง
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {SHEET_COLUMNS.map((c, i) => (
              <span key={i} className="rounded-md bg-canvas-soft-2 px-2 py-1 text-xs text-body">
                {c.split("\n")[0]}
              </span>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                send();
              }}
            >
              {pending && <Loader2Icon className="animate-spin" />}
              ส่งเลย
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
