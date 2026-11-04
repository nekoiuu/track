import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { isAdmin, requireUser, type SessionUser } from "./auth";
import type { Prisma } from "@/generated/prisma/client";

/**
 * รอบรถเป็นของคนที่เริ่มงาน (Pickup.createdById) — staff เห็น/แก้ได้เฉพาะงานของตัวเอง แอดมินเห็นทุกงาน
 * ใบนำจ่าย / พัสดุ / หน้าติดตาม / รายงาน LINE ยังเห็นทั้งร้าน (ไม่ได้ผูกเจ้าของ)
 */

/** where ของรอบรถที่คนนี้เห็นได้ — ใส่ใน db.pickup.findMany ทุกที่ที่แสดงรายการรอบรถ */
export async function pickupScope(user: SessionUser): Promise<Prisma.PickupWhereInput> {
  return (await isAdmin(user)) ? {} : { createdById: user.id };
}

/** คนนี้เห็นรอบรถนี้ได้ไหม (ไม่มีรอบนี้ = false) — งานของตัวเองไม่ต้องถามสิทธิ์แอดมิน */
export async function canAccessPickup(user: SessionUser, pickupId: string) {
  const p = await db.pickup.findUnique({ where: { id: pickupId }, select: { createdById: true } });
  if (!p) return false;
  return p.createdById === user.id || isAdmin(user);
}

/** หน้าเว็บของรอบรถ — ไม่ใช่งานของตัวเอง ทำเหมือนไม่มีหน้านี้ (ไม่บอกว่ามีอยู่) */
export async function requirePickupPage(pickupId: string) {
  const user = await requireUser();
  if (!(await canAccessPickup(user, pickupId))) notFound();
  return user;
}

export const NO_PICKUP_ACCESS = "ไม่พบงานนี้ หรือเป็นงานของคนอื่น";

/**
 * server action ที่แก้รอบรถ — ตรวจซ้ำฝั่ง server เสมอ (ซ่อนจากหน้าเว็บอย่างเดียวไม่พอ)
 * ไม่มีสิทธิ์ → throw (ปกติกดไม่ได้อยู่แล้ว เพราะไม่เห็นงาน)
 */
export async function requirePickupAccess(pickupId: string) {
  const user = await requireUser();
  if (!(await canAccessPickup(user, pickupId))) throw new Error(NO_PICKUP_ACCESS);
  return user;
}

/** เหมือน requirePickupAccess แต่รับ id ของ manifest ในงาน (PickupManifest) */
export async function requirePickupManifestAccess(pmId: string) {
  const pm = await db.pickupManifest.findUnique({ where: { id: pmId }, select: { pickupId: true } });
  if (!pm) throw new Error(NO_PICKUP_ACCESS);
  return requirePickupAccess(pm.pickupId);
}

/** หลายคันพร้อมกัน (หน้ารายการรอบรถ) — ตัดคันที่ไม่ใช่ของตัวเองออก */
export async function visiblePickupIds(user: SessionUser, ids: string[]) {
  const rows = await db.pickup.findMany({ where: { AND: [{ id: { in: ids } }, await pickupScope(user)] }, select: { id: true } });
  return rows.map((r) => r.id);
}
