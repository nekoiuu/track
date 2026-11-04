import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_DAYS, createSessionToken, readSessionToken, type SessionUser } from "./session-token";

export type { SessionUser };

/** ผู้ใช้ที่ login อยู่ (อ่านจาก cookie ที่เซ็นแล้ว ไม่ถาม DB) */
export async function getUser(): Promise<SessionUser | null> {
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/**
 * ใช้ในทุก server action — proxy อย่างเดียวไม่พอ (Next แนะนำให้ตรวจซ้ำในทุก action)
 * ไม่ได้ login → พาไปหน้า login
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * เป็นแอดมินไหม — อ่านจาก DB ทุกครั้ง (ไม่เก็บใน cookie) แก้ role ใน DB แล้วมีผลทันทีไม่ต้อง login ใหม่
 * ต้องยังเปิดใช้และอนุมัติแล้วด้วย · ใช้เฉพาะหน้า/ปุ่มของแอดมิน (ถาม DB 1 ครั้ง ~200ms)
 */
export async function isAdmin(user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  return adminById(user.id);
}

/** ถาม DB ครั้งเดียวต่อ 1 request (React cache) — layout + หน้า + เช็คสิทธิ์รอบรถ เรียกซ้ำได้ไม่เสียรอบ */
const adminById = cache(async (id: string) => {
  const u = await db.user.findUnique({ where: { id }, select: { role: true, active: true, approvedAt: true } });
  return Boolean(u && u.active && u.approvedAt && u.role === "ADMIN");
});

export const ADMIN_ONLY = "เฉพาะแอดมินเท่านั้น";

export async function startSession(user: SessionUser) {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** เก็บประวัติการกระทำ (หน้า /activity) ย้อนหลังกี่วัน */
const ACTIVITY_KEEP_DAYS = 30;

/**
 * บันทึกว่าใครทำอะไร — เขียนหลังส่งผลให้หน้าเว็บแล้ว (after) ไม่ทำให้กดช้าลง
 * เก็บแค่ ACTIVITY_KEEP_DAYS วัน — ลบของเก่าเป็นครั้งคราว (ราว 1 ใน 50 ครั้ง)
 * @example audit(user, "manifest.add", "pickup", pickupId, "MFG963088839")
 */
export function audit(user: SessionUser, action: string, targetType?: string, targetId?: string | null, detail?: string | null) {
  after(async () => {
    await db.activity
      .create({ data: { userId: user.id, userName: user.name, action, targetType, targetId: targetId ?? null, detail: detail ?? null } })
      .catch((e) => console.warn("[audit] บันทึกไม่สำเร็จ:", e));
    if (Math.random() < 0.02)
      await db.activity.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - ACTIVITY_KEEP_DAYS * 86_400_000) } } }).catch(() => null);
  });
}
