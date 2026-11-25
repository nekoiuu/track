"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pushHuntToSheets, syncTodayCancels, type HuntSync } from "@/lib/cancel-hunt";
import type { CancelHuntStatus } from "@/generated/prisma/enums";

const LABEL: Record<CancelHuntStatus, string> = {
  PENDING: "ยังไม่หา",
  FOUND: "ได้รับสินค้ากลับมาแล้ว",
  MISSING: "หาไม่เจอ",
  SKIPPED: "ไม่ต้องหา",
};

/**
 * เจ้าหน้าที่กดผลการตามหา — เจอแล้ว / หาไม่เจอ / ไม่ต้องหา / ย้อนกลับเป็นยังไม่หา
 * บันทึกว่าใครกด เมื่อไหร่ (+ หมายเหตุ เช่น "อยู่กรง B")
 */
export async function setHuntStatus(id: string, status: CancelHuntStatus, note?: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  if (!(status in LABEL)) return { error: "สถานะไม่ถูกต้อง" };
  const h = await db.cancelHunt.findUnique({ where: { id }, select: { id: true, day: true, packageNo: true, trackingNo: true, orderNo: true, status: true } });
  if (!h) return { error: "ไม่พบรายการนี้ — รีเฟรชหน้า" };

  const reset = status === "PENDING";
  const text = note?.trim().slice(0, 500) || null;
  await db.cancelHunt.update({
    where: { id },
    data: {
      status,
      resolvedAt: reset ? null : new Date(),
      resolvedBy: reset ? null : user.name,
      ...(text !== null || reset ? { note: text } : {}),
    },
  });
  const ref = h.trackingNo ?? h.packageNo ?? h.orderNo ?? id;
  audit(user, "cancel.hunt", "cancelHunt", id, `${ref} · ${LABEL[h.status]} → ${LABEL[status]}${text ? ` · ${text}` : ""}`);
  // อัปเดตช่อง "ผลตามหา" ในชีตแถวนี้ (หลังตอบหน้าเว็บ — ไม่ทำให้ปุ่มช้า)
  after(() => pushHuntToSheets(h.day, [id]).catch((e) => console.warn("[cancel-hunt] อัปเดต Sheets ไม่สำเร็จ:", e)));
  revalidatePath("/cancel-hunt");
  return { ok: `${ref} · ${LABEL[status]}` };
}

/** ปุ่ม "ดึงตอนนี้" + เปิดหน้าแล้วข้อมูลเก่ากว่ารอบ — ดึงยกเลิกวันนี้จาก BigSeller (เว้นระยะ 30 วิ) */
export async function pullCancelsNow(): Promise<HuntSync> {
  await requireUser();
  const r = await syncTodayCancels({ manual: true });
  if (r.ran && r.ok) revalidatePath("/cancel-hunt");
  return r;
}
