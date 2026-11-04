import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { isFlashParcel } from "./flash-state";

/**
 * หน้า "ติดตามสถานะ" — รายการพัสดุที่ต้องตาม แบ่งเป็นแท็บ
 * นับเฉพาะของที่ขึ้นรถไปแล้ว (รอบรถปิดงาน) ภายในช่วงวันที่เลือก
 */

export type TrackTab = "cancel" | "stale" | "problem" | "notfound" | "all";

export const TRACK_TABS: { key: TrackTab; label: string; hint: string }[] = [
  { key: "cancel", label: "ยกเลิก ยังไม่คืน", hint: "ยกเลิกหลังขึ้นรถ / ยกเลิกใน BigSeller / Flash ยกเลิก — ร้านยังไม่ได้ของคืน" },
  { key: "stale", label: "สถานะไม่อัปเดต", hint: "ยังไม่จบ และ Flash ไม่มีความเคลื่อนไหวเกินจำนวนวันที่เลือก" },
  { key: "problem", label: "ตีกลับ / มีปัญหา", hint: "Flash: ตกค้าง · มีปัญหา · ตีกลับ · ปิดงานผิดปกติ — ยังไม่ได้รับคืนที่ร้าน" },
  { key: "notfound", label: "ยังไม่เข้า Flash", hint: "ถาม Flash แล้วไม่พบเลข (ยังไม่สแกนรับ / ไม่ใช่ Flash)" },
  { key: "all", label: "ทั้งหมด", hint: "ทุกชิ้นที่ขึ้นรถไปแล้วในช่วงวันที่เลือก" },
];

/** แสดงทีละกี่ชิ้น (?size=) — ค่าแรก = ค่าเริ่มต้น */
export const PAGE_SIZES = [30, 50, 100, 200] as const;
export const RANGES = [7, 14, 30, 90] as const;
export const STALE_DAYS = [1, 2, 3, 5, 7] as const;

const DAY = 86_400_000;

/** ขึ้นรถไปแล้ว (รอบรถปิดงาน) ภายใน range วัน */
const shippedWithin = (rangeDays: number): Prisma.ManifestParcelWhereInput => ({
  manifest: { pickups: { some: { pickup: { status: "DONE", departedAt: { gte: new Date(Date.now() - rangeDays * DAY) } } } } },
});

/** โค้ดสถานะยกเลิกของ BigSeller (bsState — ไม่ขึ้นกับภาษาบัญชี ต่างจาก bsStatusText) */
export const BS_CANCELLED_STATES = ["canceled", "cancelled", "cancel"];

/**
 * หน้ายกเลิกหลังขึ้นรถ — ยังไม่ได้ของคืน (ใช้ทั้งรายการ และตรวจก่อนกด "ได้ของคืนแล้ว")
 * เราตั้ง "ยกเลิกหลังขึ้นรถ" เอง หรือ BigSeller ยกเลิกแล้วแต่ยังไม่ได้เปลี่ยนสถานะเรา (เช่น ตั้ง "มีปัญหา" ไว้) — รถปิดงานแล้ว
 * เทียบโค้ดตรง ๆ (มี index) — ค้นข้อความ contains ต้องอ่านพัสดุทั้งตาราง
 */
export const cancelledAfterPickup: Prisma.ManifestParcelWhereInput = {
  OR: [
    { status: "CANCELLED_AFTER" },
    {
      status: { notIn: ["RETURNED"] },
      bsState: { in: BS_CANCELLED_STATES },
      manifest: { pickups: { some: { pickup: { status: "DONE" } } } },
    },
  ],
};

/** งานตีกลับ — Flash ตีกลับ / เราตั้ง "กำลังตีกลับ" · ยังไม่ได้ของคืน (ไม่ได้ยกเลิก — ยกเลิกนับใน cancelledAfterPickup) */
export const returningBack: Prisma.ManifestParcelWhereInput = {
  status: { notIn: ["RETURNED", "DELIVERED"] },
  OR: [{ status: "RETURNING" }, { flashState: 7 }],
};

/** รอของคืน (หน้า /cancelled · กล่องรับคืน · เช็ค Stock-In) = ยกเลิกหลังขึ้นรถ + งานตีกลับ */
export const awaitingReturn: Prisma.ManifestParcelWhereInput = { OR: [cancelledAfterPickup, returningBack] };

/**
 * แยกงานรอคืน 3 แบบ
 * - back    ตีกลับ — ส่งไม่สำเร็จ Flash ส่งของกลับ
 * - stayed  ยกเลิก · ไม่ได้ไปกับรถ — Flash ไม่เคยสแกนรับ (ไม่พบใน Flash / Flash ยกเลิกงานรับ) ของอยู่ที่ร้าน
 * - went    ยกเลิก · ไปกับรถ — Flash สแกนรับไปแล้ว (ยกเลิกกลางทาง ยังไม่ได้คืน)
 *           ขนส่งอื่น (SPX …) ถาม Flash ไม่ได้ ไม่รู้ว่าไปหรือยัง → นับเป็นไปกับรถ (ต้องตาม)
 */
export type ReturnKind = "back" | "stayed" | "went";
export const RETURN_KINDS: { key: ReturnKind; label: string }[] = [
  { key: "back", label: "ตีกลับ" },
  { key: "stayed", label: "ยกเลิก · ไม่ได้ไปกับรถ" },
  { key: "went", label: "ยกเลิก · ไปกับรถ" },
];
export const RETURN_KIND_LABEL = Object.fromEntries(RETURN_KINDS.map((k) => [k.key, k.label])) as Record<ReturnKind, string>;

/**
 * null = ไม่ใช่งานยกเลิก/ตีกลับ · ใช้ได้กับชิ้นที่รับคืนแล้ว (RETURNED) ด้วย
 * ไม่ได้ไปกับรถ ต้องมีหลักฐานจาก Flash (ถามแล้วไม่พบ / Flash ยกเลิกงานรับ) — ยังไม่เคยถาม Flash นับเป็นไปกับรถ (ต้องตาม)
 */
export function returnKind(p: {
  status: string;
  flashState: number | null;
  flashNotFound?: boolean | null;
  bsState?: string | null;
  shippingMethod?: string | null;
}): ReturnKind | null {
  const isCancelled = p.status === "CANCELLED_AFTER" || p.flashState === 9 || BS_CANCELLED_STATES.includes(p.bsState ?? "");
  if (isCancelled) return isFlashParcel(p) && (p.flashState === 9 || (p.flashState == null && p.flashNotFound)) ? "stayed" : "went";
  if (p.status === "RETURNING" || p.status === "RETURNED" || p.flashState === 7) return "back";
  return null;
}

/**
 * ยกเลิกแล้ว (ของเรา / Flash / BigSeller) — ชิ้นที่ยกเลิกก่อนส่งให้ Flash จะไม่มีวันอยู่ใน Flash
 * เทียบค่าตรง ๆ ทุกช่อง (มี index) — เดิมค้นข้อความ ILIKE '%cancel%' / LIKE '%ยกเลิก%' ใช้ index ไม่ได้
 * ต้องอ่านพัสดุทั้งตารางทุกครั้งที่นับ (77k แถว 3–12 วินาที)
 */
export const cancelled: Prisma.ManifestParcelWhereInput = {
  OR: [{ status: "CANCELLED_AFTER" }, { flashState: 9 }, { bsState: { in: BS_CANCELLED_STATES } }],
};

/** ใบนำจ่ายที่ขึ้นรถ (ปิดงานแล้ว) ในช่วงวันที่เลือก — ทั้งหมด / ที่รถออกก่อนเส้นตัด "ไม่อัปเดต" */
export type ShippedSets = { ids: string[]; departedBefore: string[] };

/**
 * อ่านใบนำจ่ายที่ขึ้นรถในช่วงก่อน (ตาราง PickupManifest เล็ก ~พันแถว) แล้วกรองพัสดุด้วย manifestId IN (...) ที่มี index
 * เดิมใช้ EXISTS ซ้อนผ่าน Manifest → PickupManifest → Pickup ต่อพัสดุทุกชิ้น — Postgres อ่าน ManifestParcel ทั้งตาราง
 * (128k แถว 254 MB) ทุกครั้งที่นับ 4–16 วินาทีต่อแท็บ × 5 แท็บ = CPU/ดิสก์ของ DB (Nano) เต็มจนล่ม (30 ต.ค. 2026)
 */
export const shippedSets = cache(async (rangeDays: number, staleDays: number): Promise<ShippedSets> => {
  const since = new Date(Date.now() - rangeDays * DAY);
  const cutoff = new Date(Date.now() - staleDays * DAY);
  const inRange = await db.pickupManifest.findMany({
    where: { manifestId: { not: null }, pickup: { status: "DONE", departedAt: { gte: since } } },
    select: { manifestId: true },
    distinct: ["manifestId"],
  });
  const ids = inRange.map((l) => l.manifestId!);
  // รถออกก่อนเส้นตัด — คันไหนก็ได้ของใบนั้น (รวมคันที่ออกก่อนช่วงวันที่เลือก) เหมือนเงื่อนไข relation เดิม
  const before = ids.length
    ? await db.pickupManifest.findMany({
        where: { manifestId: { in: ids }, pickup: { status: "DONE", departedAt: { lt: cutoff } } },
        select: { manifestId: true },
        distinct: ["manifestId"],
      })
    : [];
  return { ids, departedBefore: before.map((l) => l.manifestId!) };
});

/**
 * เงื่อนไขของแต่ละแท็บ
 * @param shipped จาก shippedSets() — ส่งมาเมื่อทำได้ (เร็วกว่ามาก) · ไม่ส่ง = เงื่อนไขแบบ relation เดิม (ลิงก์แชร์เก็บ where แบบนี้)
 */
export function tabWhere(tab: TrackTab, { rangeDays, staleDays }: { rangeDays: number; staleDays: number }, shipped?: ShippedSets): Prisma.ManifestParcelWhereInput {
  const base: Prisma.ManifestParcelWhereInput = shipped ? { manifestId: { in: shipped.ids } } : shippedWithin(rangeDays);
  const cutoff = new Date(Date.now() - staleDays * DAY);
  const departedBeforeCutoff: Prisma.ManifestParcelWhereInput = shipped
    ? { manifestId: { in: shipped.departedBefore } }
    : { manifest: { pickups: { some: { pickup: { status: "DONE", departedAt: { lt: cutoff } } } } } };
  switch (tab) {
    case "cancel":
      return { AND: [base, cancelled, { status: { not: "RETURNED" } }, { returns: { none: {} } }] };
    case "stale":
      return {
        AND: [
          base,
          { status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED_AFTER"] } },
          { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] },
          { NOT: cancelled },
          {
            OR: [
              { flashRoutedAt: { lt: cutoff } },
              // ยังไม่มีความเคลื่อนไหวใน Flash เลย → นับจากเวลารถออก
              { AND: [{ flashRoutedAt: null }, departedBeforeCutoff] },
            ],
          },
        ],
      };
    case "problem":
      return {
        AND: [
          base,
          // Flash ตกค้าง/มีปัญหา/ตีกลับ/ปิดงานผิดปกติ
          { flashState: { in: [4, 6, 7, 8] } },
          // เซ็นรับแล้ว = จบ ไม่ต้องตาม
          { status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED_AFTER"] } },
          { OR: [{ flashState: null }, { flashState: { not: 5 } }] },
          { returns: { none: {} } },
        ],
      };
    case "notfound":
      // ยกเลิกก่อนส่งให้ Flash → ไม่ใช่ "หาย" (อยู่แท็บยกเลิกแทน)
      return { AND: [base, { flashNotFound: true }, { status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED_AFTER"] } }, { NOT: cancelled }] };
    case "all":
      return base;
  }
}

const tabOrder = (tab: TrackTab): Prisma.ManifestParcelOrderByWithRelationInput[] =>
  tab === "stale"
    ? [{ flashRoutedAt: { sort: "asc", nulls: "first" } }, { trackingNo: "asc" }]
    : tab === "cancel"
      ? [{ updatedAt: "desc" }, { trackingNo: "asc" }]
      : [{ flashRoutedAt: { sort: "desc", nulls: "last" } }, { trackingNo: "asc" }];

/** ค้นเลขแทร็ค / เลขออเดอร์ (บางส่วนก็ได้) — ค้นทุกชิ้น ไม่จำกัดแท็บ/ช่วงวัน */
const searchWhere = (q: string): Prisma.ManifestParcelWhereInput => {
  const terms = q
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 200);
  // หลายเลขคั่นเว้นวรรค (track1 track2) → ตรงเลขใดเลขหนึ่งก็ได้
  // เลขเต็ม (10 ตัวขึ้นไป) ค้นตรงตัว (เร็ว ใช้ index) · เลขสั้น เช่น 4 ตัวท้าย ค้นบางส่วน
  const full = terms.filter((t) => t.length >= 10);
  const part = terms.filter((t) => t.length < 10).slice(0, 30);
  const OR: Prisma.ManifestParcelWhereInput[] = part.flatMap((t) => [
    { trackingNo: { contains: t, mode: "insensitive" as const } },
    { orderNo: { contains: t, mode: "insensitive" as const } },
  ]);
  // เลขเต็มเลขเดียว → บางส่วนก็ได้ (พิมพ์ยังไม่ครบ) · หลายเลข → ตรงตัว
  if (full.length === 1 && terms.length === 1) OR.push({ trackingNo: { contains: full[0], mode: "insensitive" } }, { orderNo: { contains: full[0], mode: "insensitive" } });
  else if (full.length) OR.push({ trackingNo: { in: full } }, { orderNo: { in: full } });
  return { OR };
};

const rowSelect = {
  id: true,
  trackingNo: true,
  orderNo: true,
  status: true,
  statusNote: true,
  shippingMethod: true,
  bsStatusText: true,
  flashState: true,
  flashStateText: true,
  flashLastRoute: true,
  flashRoutedAt: true,
  flashFetchedAt: true,
  flashNotFound: true,
  updatedAt: true,
  manifest: {
    select: {
      id: true,
      manifestNo: true,
      pickups: {
        where: { pickup: { status: "DONE" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { pickup: { select: { id: true, plate: true, departedAt: true } } },
      },
    },
  },
} satisfies Prisma.ManifestParcelSelect;

export type TrackRow = Prisma.ManifestParcelGetPayload<{ select: typeof rowSelect }>;

export const TRACK_COUNTS_TAG = "tracking-tab-counts";

/**
 * จำนวนของทุกแท็บ — เก็บไว้ 5 นาที ใช้ร่วมกันทุกคน (หน้าแรก + หน้าติดตาม) แทนการนับใหม่ทุกครั้งที่เปิดหน้า
 * กดเช็ค Flash / รับคืน → revalidateTag(TRACK_COUNTS_TAG) ให้นับใหม่
 * นับทีละแท็บ (ไม่ยิง 5 query พร้อมกัน) — DB Nano มี CPU น้อย ยิงพร้อมกันแย่งกันเองจนช้าทั้งระบบ
 */
export const tabCounts = unstable_cache(
  async (rangeDays: number, staleDays: number) => {
    const opts = { rangeDays, staleDays };
    const shipped = await shippedSets(rangeDays, staleDays);
    const counts = {} as Record<TrackTab, number>;
    for (const t of TRACK_TABS) counts[t.key] = await db.manifestParcel.count({ where: tabWhere(t.key, opts, shipped) });
    return counts;
  },
  [TRACK_COUNTS_TAG],
  { revalidate: 300, tags: [TRACK_COUNTS_TAG] },
);

/**
 * หนึ่งหน้า + จำนวนของทุกแท็บ — แท็บที่เปิดอยู่นับสด (ตรงกับแถวที่เห็น) · แท็บอื่นใช้ tabCounts (แคช 5 นาที)
 */
export async function loadTracking({
  tab,
  q,
  page,
  pageSize = PAGE_SIZES[0],
  rangeDays,
  staleDays,
}: {
  tab: TrackTab;
  q: string;
  page: number;
  pageSize?: number;
  rangeDays: number;
  staleDays: number;
}) {
  const opts = { rangeDays, staleDays };
  const where = q ? searchWhere(q) : tabWhere(tab, opts, await shippedSets(rangeDays, staleDays));
  const [rows, total, cached] = await Promise.all([
    db.manifestParcel.findMany({
      where,
      orderBy: q ? [{ createdAt: "desc" }] : tabOrder(tab),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: rowSelect,
    }),
    db.manifestParcel.count({ where }),
    tabCounts(rangeDays, staleDays),
  ]);
  return {
    rows,
    total,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    counts: q ? cached : { ...cached, [tab]: total },
  };
}

/**
 * ข้อมูล Flash เก่ากว่ากี่นาที → เปิดหน้าแล้วเช็คให้เอง
 * มีอัปเดตเบื้องหลังที่ "ทำงานจริง" (track-tick สำเร็จล่าสุด — ดู backgroundStatus) → 6 ชม. แทบไม่ต้องยิงตอนเปิดหน้า
 * ไม่มี (ปิดไว้ / serverless ไม่มี cron / ไม่รู้ PORT) → 30 นาทีแบบเดิม · ตั้ง AUTO_FLASH_MINUTES ทับได้
 */
export function autoFlashMinutes(backgroundActive: boolean) {
  const env = Number(process.env.AUTO_FLASH_MINUTES);
  if (env > 0) return env;
  return backgroundActive ? 360 : 30;
}

/**
 * ชิ้นในหน้านี้ที่ควรเช็ค Flash ใหม่ตอนเปิดหน้า — ชิ้น Flash ที่ยังไม่จบ (เซ็นรับ/ตีกลับแล้ว/ยกเลิก ไม่ต้อง)
 * และไม่เคยเช็ค หรือเช็คไว้นานกว่า minutes นาที
 * @param now เวลาตอน render (ส่งมาจากหน้า — ห้ามเรียก Date.now() ระหว่าง render)
 */
export function autoFlashIds(rows: Pick<TrackRow, "id" | "shippingMethod" | "flashState" | "flashFetchedAt">[], minutes: number, now: number) {
  const before = now - minutes * 60_000;
  return rows
    .filter((r) => isFlashParcel(r) && !(r.flashState != null && [5, 7, 9].includes(r.flashState)))
    .filter((r) => !r.flashFetchedAt || r.flashFetchedAt.getTime() < before)
    .map((r) => r.id);
}
