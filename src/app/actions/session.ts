"use server";

import { audit, requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { keepAlive, saveCookie } from "@/lib/bigseller-session";
import { ERROR_HINT } from "@/lib/bigseller";
import type { SyncState } from "./manifests";

/** ไม่ส่งข้อความ error ดิบไปหน้าเว็บ — บอกแค่สาเหตุแบบสั้น */
const reasonOf = (res: { ok?: boolean; reason: string; errorKind?: string }) =>
  res.ok || !res.errorKind ? res.reason : (ERROR_HINT[res.errorKind] ?? "ทดสอบไม่ผ่าน — ลองใหม่อีกครั้ง");

/** แปะ cookie ใหม่ — ใช้ได้ทันที ไม่ต้องรีสตาร์ท แล้วทดสอบให้เลย */
export async function updateCookie(_: SyncState, form: FormData): Promise<SyncState> {
  const user = await requireUser();
  // ตัด "cookie:" ข้างหน้า กับเครื่องหมาย " ที่ติดมาตอนก๊อป
  const cookie = String(form.get("cookie") ?? "")
    .trim()
    .replace(/^cookie:\s*/i, "")
    .replace(/^"|"$/g, "")
    .replace(/\s*\n\s*/g, " ");
  if (!cookie.includes("=")) return { ok: false, message: "ไม่ใช่ Cookie header — ต้องหน้าตาแบบ JSESSIONID=xxx; muc_token=xxx; ..." };

  await saveCookie(cookie);
  const res = await keepAlive({ force: true });
  audit(user, "bigseller.cookie", "session", null, res.ok ? "ทดสอบผ่าน" : "ทดสอบไม่ผ่าน");
  revalidatePath("/", "layout");
  return res.ok
    ? { ok: true, message: "บันทึกแล้ว ทดสอบผ่าน — ระบบจะต่ออายุให้เอง" }
    : { ok: false, message: `บันทึกแล้ว แต่ทดสอบไม่ผ่าน: ${reasonOf(res)}`, errorKind: res.errorKind };
}

export async function testCookie(): Promise<SyncState> {
  await requireUser();
  const res = await keepAlive({ force: true });
  revalidatePath("/", "layout");
  return { ok: Boolean(res.ok), message: reasonOf(res), errorKind: res.errorKind };
}
