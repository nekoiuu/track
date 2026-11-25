"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { expandTails, pushHuntToSheets, receiveByQr, syncTodayCancels, type HuntSync, type QrReceiveResult } from "@/lib/cancel-hunt";
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

export type ManualReceive = QrReceiveResult & {
  /** เลขท้ายที่ตรงหลายใบ — ต้องพิมพ์ยาวขึ้น */
  ambiguous: { tail: string; hits: string[] }[];
  error?: string;
};

/**
 * ใส่เลขแทร็คเอง — รูปใน LINE อ่าน QR ไม่ได้ / ส่งตอนบอทไม่ได้เปิด
 * ใส่ได้หลายเลข (ขึ้นบรรทัด / เว้นวรรค / จุลภาค) · เลขสั้น (4–9 ตัว) = เลขท้าย จับคู่กับของยกเลิกที่ยังไม่ได้คืน
 * ตรงกับของยกเลิก → ได้รับสินค้ากลับมาแล้ว (ชื่อคนใส่ + เวลา) เหมือนสแกน QR
 */
export async function receiveManual(text: string): Promise<ManualReceive> {
  const user = await requireUser();
  const tokens = [...new Set(String(text ?? "").toUpperCase().split(/[\s,;]+/).map((t) => t.replace(/[^A-Z0-9]/g, "")).filter((t) => t.length >= 4))].slice(0, 500);
  const empty: ManualReceive = { matched: [], already: [], unknown: [], ambiguous: [] };
  if (!tokens.length) return { ...empty, error: "ใส่เลขแทร็ค (หรือเลขท้ายอย่างน้อย 4 ตัว)" };

  const tails = tokens.filter((t) => t.length < 10);
  const fulls = tokens.filter((t) => t.length >= 10);
  const ex = tails.length ? await expandTails(tails) : { full: [], ambiguous: [], none: [] };
  const r = await receiveByQr([...fulls, ...ex.full], { by: user.name, source: "manual" });
  const result: ManualReceive = { ...r, unknown: [...r.unknown, ...ex.none], ambiguous: ex.ambiguous };

  if (r.matched.length) {
    audit(user, "cancel.hunt", "cancelHunt", null, `ใส่เลขเอง ได้รับสินค้ากลับมาแล้ว ${r.matched.length}: ${r.matched.map((m) => m.trackingNo).join(", ")}`);
    revalidatePath("/cancel-hunt");
  }
  return result;
}
