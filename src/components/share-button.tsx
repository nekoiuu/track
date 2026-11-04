"use client";

import { useTransition } from "react";
import { Link2Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { createShareLink } from "@/app/actions/share";
import type { ShareFilter } from "@/lib/share"; // type อย่างเดียว — ไม่ดึงโค้ด server มาฝั่งเว็บ
import { Button } from "@/components/ui/button";
import { copyText } from "./copy-trackings";

/** สร้างลิงก์สาธารณะแล้วคัดลอกให้ทันที (เอาไปแปะใน Sheets / LINE ได้เลย) */
export async function makeShareLink(input: { parcelIds?: string[]; filter?: ShareFilter; title?: string }) {
  const t = toast.loading("กำลังสร้างลิงก์…");
  const r = await createShareLink(input);
  if (!r.ok || !r.url) return void toast.error(r.message, { id: t });
  const copied = await copyText(r.url);
  toast.success(copied ? r.message : "สร้างลิงก์แล้ว (คัดลอกไม่ได้ — กดค้างที่ลิงก์เพื่อคัดลอก)", {
    id: t,
    description: r.url,
    duration: 10_000,
    action: { label: "เปิด", onClick: () => window.open(r.url, "_blank") },
  });
}

/** ปุ่ม "ลิงก์เคสนี้" ในหน้าติดตามสถานะ — ลิงก์แสดงรายการล่าสุดของเคสเสมอ */
export function ShareCaseButton({ filter }: { filter: ShareFilter }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="outline" disabled={pending} onClick={() => start(() => makeShareLink({ filter }))}>
      {pending ? <Loader2Icon className="animate-spin" /> : <Link2Icon />}
      ลิงก์เคสนี้
    </Button>
  );
}
