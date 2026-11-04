"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SquareIcon } from "lucide-react";
import { toast } from "sonner";
import type { FlashRoundState } from "@/app/actions/manifests";
import { Button } from "@/components/ui/button";

/** ไม่ขยับกี่รอบติดกันแล้วหยุด (Flash บล็อก / เน็ตหลุด) — กันวนไม่จบ */
const STUCK_ROUNDS = 2;

export type FlashRunning = { label: string; text: string } | null;

/**
 * ดึงสถานะ Flash ทีละรอบ (~400 ชิ้น) จน remaining = 0 — พักระหว่างรอบตามที่ server บอก กันโดน Flash บล็อก · กดหยุดได้
 * ใช้ในหน้ารอบรถ (PickupsStatusPanel) และหน้าติดตามสถานะ (TrackingFlashButtons)
 */
export function useFlashRounds() {
  const router = useRouter();
  const [running, setRunning] = useState<FlashRunning>(null);
  const stop = useRef(false);

  const pull = async (label: string, round: () => Promise<FlashRoundState>) => {
    stop.current = false;
    let checked = 0;
    let lastRemaining = Infinity;
    let stuck = 0;
    setRunning({ label, text: "เริ่ม…" });
    try {
      for (;;) {
        const r = await round();
        checked += r.checked;
        router.refresh();
        if (r.remaining === 0) {
          toast.success(checked ? `${label}: ครบแล้ว (เช็ค ${checked} ชิ้น)` : `${label}: ${r.message}`);
          break;
        }
        stuck = r.remaining >= lastRemaining ? stuck + 1 : 0;
        lastRemaining = r.remaining;
        if (stuck >= STUCK_ROUNDS) {
          toast.error(`${label}: Flash ไม่ตอบ — หยุดไว้ก่อน (เหลือ ${r.remaining} ชิ้น) · ${r.message}`);
          break;
        }
        // พักตามที่ server บอก พร้อมนับถอยหลัง · กดหยุดได้ระหว่างรอ
        for (let s = Math.ceil(r.waitMs / 1000); s > 0; s--) {
          if (stop.current) break;
          setRunning({ label, text: `เช็คแล้ว ${checked} · เหลือ ${r.remaining} ชิ้น · รอบต่อไปใน ${s} วิ (กัน Flash บล็อก)` });
          await new Promise((res) => setTimeout(res, 1000));
        }
        if (stop.current) {
          toast(`${label}: หยุดแล้ว (เช็คไป ${checked} ชิ้น · เหลือ ${r.remaining})`);
          break;
        }
        setRunning({ label, text: `เช็คแล้ว ${checked} · เหลือ ${r.remaining} ชิ้น · กำลังถาม Flash…` });
      }
    } catch {
      toast.error(`${label}: ขาดการเชื่อมต่อ — กดอีกครั้งเพื่อทำต่อ (เช็คไป ${checked} ชิ้น)`);
    } finally {
      setRunning(null);
      router.refresh();
    }
  };

  return { running, pull, stop: () => (stop.current = true) };
}

/** แถบ "กำลังเช็ค…" + ปุ่มหยุด ระหว่าง useFlashRounds ทำงาน */
export function FlashRunningBar({ running, onStop }: { running: NonNullable<FlashRunning>; onStop: () => void }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-body">
        <Loader2Icon className="size-4 shrink-0 animate-spin" /> {running.label}: {running.text}
      </span>
      <Button type="button" variant="outline" onClick={onStop}>
        <SquareIcon /> หยุด
      </Button>
    </>
  );
}
