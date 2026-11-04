"use client";

import { useRef, useTransition } from "react";
import { Loader2Icon, RefreshCwIcon, SheetIcon } from "lucide-react";
import { toast } from "sonner";
import { updateSentToSheets, type SheetsUpdateState } from "@/app/actions/sheets";
import { Button } from "@/components/ui/button";

/** กันวนไม่จบ */
const MAX_ROUNDS = 40;

/**
 * ปุ่มส่ง Sheets แบบทำเป็นรอบ — server ทำรอบละไม่เกิน ~40 วิ แล้วบอกจุดถัดไป → ปุ่มเรียกต่อเองจนครบ · กดซ้อนไม่ได้
 * พังกลางทาง: แจ้งว่าค้างตรงไหน กดใหม่ทำต่อจากจุดนั้น
 * @param run server action ที่รับ "เริ่มจากลำดับที่" (bind ค่าอื่นไว้แล้ว)
 */
export function ChunkedSheetsButton({
  run,
  label,
  confirmText,
  unit,
  icon = "refresh",
  variant = "outline",
}: {
  run: (from: number) => Promise<SheetsUpdateState>;
  label: string;
  confirmText: string;
  /** หน่วยที่นับรอบ เช่น "แท็บ" / "คัน" */
  unit: string;
  icon?: "refresh" | "sheet";
  variant?: "outline" | "default";
}) {
  const [pending, start] = useTransition();
  const resumeFrom = useRef(0);

  const go = () => {
    if (!window.confirm(confirmText)) return;
    start(async () => {
      const t = toast.loading(`${label}…`);
      let from = resumeFrom.current;
      let rows = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let r: SheetsUpdateState;
        try {
          r = await run(from);
        } catch {
          // เน็ตหลุด / server ตัด — จำจุดไว้ กดใหม่ทำต่อ
          resumeFrom.current = from;
          toast.error(`ค้างที่${unit}ที่ ${from + 1} — กดอีกครั้งเพื่อทำต่อ`, { id: t });
          return;
        }
        rows += r.updated;
        if (r.next == null) {
          resumeFrom.current = 0;
          toast[r.ok ? "success" : "warning"](r.ok ? `เสร็จครบ ${r.total} ${unit} · ${rows} แถว` : r.message, { id: t, duration: 10_000 });
          return;
        }
        if (r.next === from) {
          // ไม่ขยับเลย — หยุด ไม่วนไม่จบ
          resumeFrom.current = from;
          toast.error(r.message, { id: t });
          return;
        }
        from = r.next;
        toast.loading(`${label} ${r.done}/${r.total} ${unit} · ${rows} แถว…`, { id: t });
      }
      resumeFrom.current = from;
      toast.warning(`ยังไม่ครบ — กดอีกครั้งเพื่อทำต่อ (${rows} แถวแล้ว)`, { id: t });
    });
  };

  const Icon = icon === "sheet" ? SheetIcon : RefreshCwIcon;
  return (
    <Button type="button" variant={variant} disabled={pending} onClick={go}>
      {pending ? <Loader2Icon className="animate-spin" /> : <Icon />}
      {label}
    </Button>
  );
}

/** ปุ่ม "อัปเดต Sheets" — เขียนสถานะล่าสุดทับทุกแถวที่เคยส่งไปแท็บรายวัน (ไม่เพิ่มแถว) */
export function SheetsUpdateAllButton({ days = 30 }: { days?: number }) {
  return (
    <ChunkedSheetsButton
      run={(from) => updateSentToSheets(from, days)}
      label="อัปเดต Sheets"
      unit="แท็บ"
      confirmText={`อัปเดตสถานะทุกแถวที่เคยส่งไป Google Sheets (แท็บรายวัน ${days} แท็บล่าสุด)?\nไม่เพิ่มแถวใหม่ · ใช้เวลาสักครู่`}
    />
  );
}
