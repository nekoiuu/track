"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { audit, isAdmin, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fetchFlashPods } from "@/lib/flash";
import { flashOpenConfigured, flashOpenRoutes, flashOpenSetWebhook } from "@/lib/flash-open";
import type { SyncState } from "./manifests";

async function requireAdmin() {
  const user = await requireUser();
  if (!(await isAdmin(user))) throw new Error("เฉพาะผู้ดูแลระบบ");
  return user;
}

/**
 * ทดสอบ Flash Open API ด้วยเลขพัสดุจริงล่าสุด 5 เลข — ตอบคำถามสำคัญ: API ดูพัสดุของร้านได้ไหม
 * (พัสดุที่ Shopee/Lazada สร้างอาจอยู่ใต้บัญชีแพลตฟอร์ม → API ไม่ตอบ)
 */
export async function testFlashOpenApi(): Promise<SyncState> {
  const user = await requireAdmin();
  if (!flashOpenConfigured()) return { ok: false, message: "ยังไม่ได้ตั้ง FLASH_OPEN_MCH_ID / FLASH_OPEN_KEY ใน .env" };
  const sample = await db.manifestParcel.findMany({
    where: { flashState: { not: null }, flashNotFound: false },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { trackingNo: true },
  });
  if (!sample.length) return { ok: false, message: "ยังไม่มีพัสดุ Flash ในระบบให้ทดสอบ" };
  const r = await flashOpenRoutes(sample.map((s) => s.trackingNo));
  const message = r.errors.length
    ? `API พัง: ${r.errors[0]}`
    : r.found.length === 0
      ? `เชื่อมได้ แต่ API ไม่ตอบเลขของร้านเลย (0/${sample.length}) — พัสดุน่าจะอยู่ใต้บัญชีแพลตฟอร์ม ระบบจะใช้หน้าเว็บต่อไป`
      : `ใช้ได้ — API ตอบ ${r.found.length}/${sample.length} เลข${r.missing.length ? ` (ไม่ตอบ ${r.missing.length} เลข จะถามหน้าเว็บแทน)` : ""}`;
  audit(user, "flash.api.test", undefined, null, message);
  return { ok: !r.errors.length && r.found.length > 0, message };
}

/** ตั้ง webhook ความเคลื่อนไหว (routes) ให้ Flash ส่งมาที่ /api/flash/webhook · url ว่าง = ปิด */
export async function setFlashWebhook(enable: boolean): Promise<SyncState> {
  const user = await requireAdmin();
  if (!flashOpenConfigured()) return { ok: false, message: "ยังไม่ได้ตั้ง FLASH_OPEN_MCH_ID / FLASH_OPEN_KEY ใน .env" };
  // ใช้โดเมนที่เปิดหน้านี้อยู่ (ต้องเป็น https ที่ Flash เข้าถึงได้ — localhost ใช้ไม่ได้)
  const h = await headers();
  const host = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "") || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const url = `${host}/api/flash/webhook`;
  if (enable && !/^https:\/\//.test(url)) return { ok: false, message: `Flash ต้องการ https — ตอนนี้เป็น ${url} (ตั้ง PUBLIC_URL ใน .env เป็นโดเมนจริง)` };
  if (enable && /localhost|127\.0\.0\.1|192\.168\./.test(url)) return { ok: false, message: `${url} — Flash เข้าจากข้างนอกไม่ได้ ตั้ง PUBLIC_URL เป็นโดเมนจริงก่อน` };
  try {
    const d = await flashOpenSetWebhook(enable ? url : null, 4);
    const message = enable ? `ตั้ง webhook แล้ว → ${d?.url ?? url}` : "ปิด webhook แล้ว";
    audit(user, "flash.webhook", undefined, null, message);
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** ดึงหลักฐานการส่งถึงของชิ้นที่เซ็นรับแล้วแต่ยังไม่มีหลักฐาน (ทีละ 50) */
export async function runFlashPods(): Promise<SyncState> {
  const user = await requireUser();
  if (!flashOpenConfigured()) return { ok: false, message: "ยังไม่ได้ตั้ง Flash Open API" };
  const n = await fetchFlashPods(undefined, 50);
  audit(user, "flash.pod", undefined, null, `${n} ชิ้น`);
  revalidatePath("/", "layout");
  return { ok: true, message: n ? `ได้หลักฐานส่งถึง ${n} ชิ้น` : "ไม่มีชิ้นที่ต้องดึงหลักฐาน" };
}
