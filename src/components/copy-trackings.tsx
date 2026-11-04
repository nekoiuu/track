"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** คัดลอกลงคลิปบอร์ด — เปิดผ่าน http ธรรมดา (เช่น IP ในวง LAN) clipboard API ใช้ไม่ได้ เลยมีทางสำรอง */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/**
 * แถวพัสดุที่ "เห็นอยู่" ใน scope — ตัดเฉพาะแถวที่ตัวกรอง/ค้นหาซ่อน (display:none ที่ตัวเองหรือกลุ่ม)
 * แถวในใบที่ "พับ" อยู่ยังนับ · แถวต้องใส่ data-tracking
 */
export function visibleRows(scope: string) {
  const root = document.getElementById(scope);
  if (!root) return [];
  const filteredOut = (el: HTMLElement) => {
    for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) if (getComputedStyle(n).display === "none") return true;
    return false;
  };
  return [...root.querySelectorAll<HTMLElement>("[data-tracking]")].filter((r) => !filteredOut(r));
}

/**
 * คัดลอกเลขแทร็คกิ้งทุกแถวที่ "เห็นอยู่" ในตาราง — บรรทัดละเลข วางใน Google Sheets ได้คอลัมน์เดียวทันที
 * กรองขนส่ง / สถานะ / ค้นหาอยู่ → ได้เฉพาะที่กรองไว้ · แถวต้องใส่ data-tracking={เลข}
 */
export function CopyTrackingsButton({
  scope,
  compact = false,
}: {
  /** id ของกล่องที่ครอบแถว — ทั้งตาราง หรือแค่ใบเดียวก็ได้ */
  scope: string;
  /** ปุ่มเล็กสำหรับหัวแต่ละใบ */
  compact?: boolean;
}) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    const nos = [...new Set(visibleRows(scope).map((r) => r.dataset.tracking!))];
    if (!nos.length) return void toast.error("ไม่มีเลขแทร็คกิ้งให้คัดลอก");
    if (!(await copyText(nos.join("\n")))) return void toast.error("คัดลอกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    toast.success(`คัดลอก ${nos.length} เลขแล้ว`);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };

  return (
    <Button
      type="button"
      variant={compact ? "ghost" : "outline"}
      size={compact ? "sm" : "default"}
      className={compact ? "no-print h-9 shrink-0 text-body" : "no-print mb-3 h-11"}
      // อยู่ในหัวใบที่พับได้ (summary) — กดคัดลอกแล้วไม่ให้ใบพับ/กางตาม
      onClick={(e) => {
        e.preventDefault();
        void copy();
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
      {compact ? "คัดลอก" : "คัดลอกเลขแทร็คกิ้ง"}
    </Button>
  );
}
