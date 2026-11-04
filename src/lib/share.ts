import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { refreshFlashStatuses } from "./flash";
import { isFlashParcel } from "./flash-state";
import { shippedSets, tabWhere, type TrackTab } from "./tracking";

/**
 * ลิงก์สาธารณะดูสถานะพัสดุ (ไม่ต้อง login) — แปะใน Google Sheets ให้ใครก็กดดูได้
 *   /share/<slug>       ชุดพัสดุ (เลือกไว้ / เคสในหน้าติดตามสถานะ) — เก็บใน ShareLink ปิดลิงก์ได้
 *   /share/p/<token>    พัสดุ 1 ชิ้น — token = id + ลายเซ็น HMAC (AUTH_SECRET) ไม่ต้องเก็บใน DB
 * หน้าสาธารณะไม่แสดงชื่อพนักงาน / ข้อมูลภายใน
 */

/** ข้อมูลที่หน้าสาธารณะเห็น */
export const shareSelect = {
  id: true,
  trackingNo: true,
  orderNo: true,
  status: true,
  shippingMethod: true,
  items: true,
  bsStatusText: true,
  flashState: true,
  flashStateText: true,
  flashLastRoute: true,
  flashRoutedAt: true,
  flashFetchedAt: true,
  flashNotFound: true,
  manifest: {
    select: {
      pickups: { where: { pickup: { status: "DONE" } }, orderBy: { createdAt: "desc" }, take: 1, select: { pickup: { select: { departedAt: true } } } },
    },
  },
} satisfies Prisma.ManifestParcelSelect;

export type ShareParcel = Prisma.ManifestParcelGetPayload<{ select: typeof shareSelect }>;

/** ชุดละไม่เกินเท่านี้ (หน้าเดียว) */
export const SHARE_MAX = 500;

/** slug สุ่ม 16 ตัว (base64url ~96 บิต) — เดาไม่ได้ */
export const newSlug = () => randomBytes(12).toString("base64url");

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("ตั้ง AUTH_SECRET ใน .env ก่อน");
  return s;
}
const sig = (id: string) => createHmac("sha256", secret()).update(`parcel:${id}`).digest("base64url").slice(0, 16);

/** token ของพัสดุ 1 ชิ้น: <id>.<ลายเซ็น> */
export const parcelToken = (id: string) => `${id}.${sig(id)}`;

/** token ถูกต้อง → id · ไม่งั้น null */
export function readParcelToken(token: string) {
  const [id, s] = token.split(".");
  if (!id || !s) return null;
  const a = Buffer.from(s);
  const b = Buffer.from(sig(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** โดเมนของเว็บ — PUBLIC_URL ใน .env ก่อน · ไม่มีใช้โดเมนที่เปิดอยู่ */
export async function publicBase() {
  const env = process.env.PUBLIC_URL?.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type ShareFilter = { tab: TrackTab; rangeDays: number; staleDays: number };

/** where ของลิงก์ชุด — case = เงื่อนไขเคส (รายการล่าสุดเสมอ) · parcels = id ที่เลือกไว้ */
export async function shareWhere(link: { kind: string; parcelIds: string[]; filter: unknown }): Promise<Prisma.ManifestParcelWhereInput> {
  if (link.kind === "case" && link.filter) {
    const f = link.filter as ShareFilter;
    return tabWhere(f.tab, f, await shippedSets(f.rangeDays, f.staleDays));
  }
  return { id: { in: link.parcelIds } };
}

/**
 * เปิดลิงก์แล้วเช็ค Flash ให้ — เฉพาะชิ้นที่ยังไม่จบและข้อมูลเก่ากว่า 30 นาที (เก่าสุดก่อน ไม่เกิน 60 ชิ้นต่อครั้ง)
 * ใครเปิดรัว ๆ ก็ไม่ถาม Flash ซ้ำ (staleMinutes)
 */
export async function refreshShareParcels(where: Prisma.ManifestParcelWhereInput) {
  const before = new Date(Date.now() - 30 * 60_000);
  const stale = await db.manifestParcel.findMany({
    where: {
      AND: [where, { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] }, { OR: [{ flashFetchedAt: null }, { flashFetchedAt: { lt: before } }] }],
    },
    orderBy: { flashFetchedAt: { sort: "asc", nulls: "first" } },
    take: 60,
    select: { id: true, shippingMethod: true },
  });
  const ids = stale.filter(isFlashParcel).map((p) => p.id);
  if (!ids.length) return { ok: true, count: 0, message: "" };
  const r = await refreshFlashStatuses({ parcelIds: ids }, { staleMinutes: 30 });
  return { ok: r.ok, count: r.count, message: r.message };
}