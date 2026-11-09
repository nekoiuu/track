import "server-only";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";

/** เลขเต็มของใบนำจ่าย (เช่น MFG963072007) — สั้นกว่านี้ถือว่าเป็นเลขท้ายที่จดมา */
export const isFullManifestNo = (code: string) => code.length >= 8;

/**
 * เลขต้นของใบนำจ่าย (MANIFEST_PREFIX ใน .env) — พิมพ์แค่ 4 หลักท้ายแล้วต่อเป็นเลขเต็มให้
 * อ่านใหม่ทุกครั้งที่เรียก (ไม่เก็บเป็นค่าคงที่ตอนโหลดไฟล์) — แก้ .env ตอน dev รันอยู่ก็มีผลทันที
 * ตัด " ที่ติดมาและช่องว่างออก กันใส่ค่าผิดรูปแล้วต่อไม่ติด
 */
export const getManifestPrefix = () =>
  (process.env.MANIFEST_PREFIX ?? "").trim().replace(/^["']|["']$/g, "").replace(/\s+/g, "").toUpperCase();

/**
 * เลขต้นที่โชว์ในช่องจด manifest — เลขใบนำจ่ายวิ่งขึ้นเรื่อย ๆ (MFG96308… → MFG96309…)
 * เอาจากใบล่าสุดที่ระบบรู้จัก เทียบกับ MANIFEST_PREFIX แล้วใช้ตัวที่ "ใหม่กว่า" — ไม่ต้องคอยแก้ .env
 */
export async function currentManifestPrefix() {
  return (await manifestPrefixCandidates())[0] ?? "";
}

/**
 * เลขต้นที่เป็นไปได้ทั้งหมด (ตัวใหม่สุดก่อน) — ช่วงเปลี่ยนเลขต้น ใบเลขต้นเก่ากับใหม่พิมพ์ปนกันได้
 * (เช่น BigSeller มี MFG96311… แล้ว แต่ใบที่ขึ้นรถยังเป็น MFG96310…) → ต้องลองทุกตัว ห้ามเดาตัวเดียว
 */
export async function manifestPrefixCandidates() {
  const env = getManifestPrefix();
  // เลขต้นของใบจาก BigSeller ที่พิมพ์ช่วงนี้ (ไม่ใช่แค่ใบล่าสุดใบเดียว) — 96310 / 96311 สลับกันมาได้
  const recent = await db.manifest.findMany({
    where: { source: "bigseller", OR: [{ printedAt: { gte: new Date(Date.now() - LOOKBACK_MS) } }, { printedAt: null }] },
    orderBy: [{ printedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: { manifestNo: true },
  });
  const set = new Set<string>();
  if (env) set.add(env);
  for (const r of recent) if (r.manifestNo.length > 4) set.add(r.manifestNo.slice(0, -4).toUpperCase());
  // ลองเลขต้นที่ต่ำกว่าตัวใหม่สุด 1 ด้วย (เช่น มี 96311 แล้ว → ลอง 96310) — กันกรณี .env ไม่ได้ตั้ง/ตั้งเก่า
  const sorted = [...set].sort(comparePrefixDesc);
  const below = sorted[0] && prevPrefix(sorted[0]);
  if (below) set.add(below);
  return [...set].sort(comparePrefixDesc);
}

/** ใหม่กว่าก่อน — ยาวเท่ากันเทียบตัวอักษร (เลขมากกว่า = ใหม่กว่า) */
const comparePrefixDesc = (a: string, b: string) => b.length - a.length || (a < b ? 1 : a > b ? -1 : 0);

/** "MFG96311" → "MFG96310" (เลขท้ายของเลขต้นลบ 1 ความยาวเท่าเดิม) · ทำไม่ได้ = null */
function prevPrefix(prefix: string) {
  const m = prefix.match(/^(.*?)(\d+)$/);
  if (!m || /^0+$/.test(m[2])) return null;
  return m[1] + String(BigInt(m[2]) - BigInt(1)).padStart(m[2].length, "0");
}

/**
 * จด 4 หลักท้าย → หาใบในเครื่องที่ตรงกับเลขต้นตัวใดตัวหนึ่ง (พิมพ์ภายใน 7 วันก่อนรถเข้า ใบล่าสุดก่อน)
 * เลขเต็ม → ตรงตัว
 */
export async function findManifestByGuesses(guesses: string[], at: PickupTime, pickupId?: string) {
  if (guesses.length === 1) return findManifestByCode(guesses[0], at, pickupId);
  return pickBest({ manifestNo: { in: guesses }, ...inWindow(at) }, pickupId);
}

/** เวลาของรอบรถ — Date เดียว = เวลารถเข้า (รอบที่ยังเปิดอยู่) */
type PickupTime = Date | { arrivedAt: Date; departedAt?: Date | null };

/**
 * ช่วงเวลาพิมพ์ใบที่นับว่าเป็นของรอบรถนี้: 7 วันก่อนรถเข้า → 2 ชม. หลังปิดงาน (ยังไม่ปิด = ถึงตอนนี้)
 * เดิมนับแค่ 2 ชม. หลังรถเข้า → รอบที่เปิดไว้ทั้งวัน ใบที่พิมพ์ตอนบ่ายหาไม่เจอ
 */
const inWindow = (t: PickupTime) => {
  const { arrivedAt, departedAt } = t instanceof Date ? { arrivedAt: t, departedAt: null } : t;
  const end = Math.max(arrivedAt.getTime(), (departedAt ?? new Date()).getTime()) + LOOKAHEAD_MS;
  return { OR: [{ printedAt: { gte: new Date(arrivedAt.getTime() - LOOKBACK_MS), lte: new Date(end) } }, { printedAt: null }] };
};

/**
 * เลขท้ายซ้ำกันหลายใบ (เช่น MFG963102678 กับ MFG963112678) → เลือกเองไม่ต้องให้คนพิมพ์เลขเต็ม
 * ใบที่ยังไม่ขึ้นรถคันอื่นก่อน (ใบที่ขึ้นรถไปแล้วมักไม่ใช่ใบที่เพิ่งยิง) แล้วค่อยเอาใบที่พิมพ์ล่าสุด
 */
async function pickBest(where: Prisma.ManifestWhereInput, pickupId?: string) {
  const list = await db.manifest.findMany({
    where,
    orderBy: [{ printedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 10,
    include: { _count: { select: { pickups: pickupId ? { where: { pickupId: { not: pickupId } } } : true } } },
  });
  const best = list.find((m) => m._count.pickups === 0) ?? list[0];
  if (!best) return null;
  const { _count, ...manifest } = best;
  void _count;
  return manifest;
}

/** "8839" → "MFG963088839" (ถ้าตั้ง prefix ไว้) · เลขอื่นคืนตามเดิม */
export const expandManifestCode = (code: string) => {
  const prefix = getManifestPrefix();
  return prefix && /^\d{4}$/.test(code) ? prefix + code : code;
};

// เลข 4 หลักท้ายวนซ้ำได้ → จับคู่เฉพาะใบที่พิมพ์ในช่วงก่อนรถเข้า
const LOOKBACK_MS = 7 * 86_400_000;
/**
 * printTime ของ BigSeller เป็นเวลาไทยที่ส่งมาเหมือนเป็น UTC → printedAt ในเครื่องเร็วกว่าจริง 7 ชม.
 * (เช่น ใบ MFG963110202 พิมพ์จริง 13:30 น. ≈ 06:30 UTC แต่เก็บเป็น 13:30 UTC — ถูกบันทึกลง DB ตอน 06:40 UTC)
 * ขอบบนของช่วงจับคู่ต้องเผื่อ 7 ชม.นี้ ไม่งั้นใบที่เพิ่งพิมพ์ในรอบ ~7 ชม. ล่าสุดหาไม่เจอเลย
 */
const PRINT_TIME_SKEW_MS = 7 * 3_600_000;
const LOOKAHEAD_MS = 2 * 3_600_000 + PRINT_TIME_SKEW_MS;

/**
 * หาใบนำจ่ายที่ตรงกับเลขที่จด
 * - เลขเต็ม → ตรงตัว
 * - เลขท้าย → ใบล่าสุดที่เลขท้ายตรงและพิมพ์ภายใน 7 วันก่อนรถเข้า ถึง 2 ชม. หลังปิดงาน (ใบที่สร้างเอง ไม่มีเวลาพิมพ์ ก็นับ)
 */
export async function findManifestByCode(code: string, at: PickupTime = new Date(), pickupId?: string) {
  if (isFullManifestNo(code)) {
    return db.manifest.findUnique({ where: { manifestNo: code } });
  }
  return pickBest({ ...(code.length === 4 ? { last4: code } : { manifestNo: { endsWith: code } }), ...inWindow(at) }, pickupId);
}

/** จับคู่ PickupManifest ที่ยังค้างอยู่ — เรียกหลัง sync ทุกครั้ง */
export async function linkPendingPickupManifests() {
  const pending = await db.pickupManifest.findMany({
    where: { manifestId: null },
    include: { pickup: { select: { arrivedAt: true, departedAt: true } } },
  });

  const manifestIds = new Set<string>();
  for (const pm of pending) {
    // เลขเต็มที่ยังค้าง = เลขต้นที่ระบบเดาไว้ (เลขเต็มที่พิมพ์มาเองไม่ค้าง — สร้างใบเองทันที)
    // → ตรงตัวไม่เจอ ลอง 4 หลักท้ายทุกเลขต้น (เช่น เดา MFG963110209 แต่ใบจริงคือ MFG963100209)
    const m =
      (await findManifestByCode(pm.code, pm.pickup, pm.pickupId)) ??
      (isFullManifestNo(pm.code) ? await findManifestByCode(pm.code.slice(-4), pm.pickup, pm.pickupId) : null);
    if (!m) continue;
    // เลขที่โชว์ = เลขจริงของใบ (ถ้าไม่ชนกับรายการอื่นในรอบเดียวกัน)
    const clash = m.manifestNo !== pm.code && (await db.pickupManifest.findFirst({ where: { pickupId: pm.pickupId, code: m.manifestNo } }));
    const code = isFullManifestNo(pm.code) && !clash ? m.manifestNo : pm.code;
    await db.pickupManifest.update({ where: { id: pm.id }, data: { manifestId: m.id, code } });
    manifestIds.add(m.id);
  }
  return { pending: pending.length, linked: manifestIds.size, manifestIds: [...manifestIds] };
}

/** สร้างใบนำจ่ายเอง (กรณี BigSeller ยังไม่ sync หรือไม่ได้ใช้) */
export function createManualManifest(manifestNo: string) {
  return db.manifest.upsert({
    where: { manifestNo },
    update: {},
    create: { manifestNo, last4: manifestNo.slice(-4), source: "manual" },
  });
}

/**
 * ทุกใบที่ส่งออกต้องมีรถรับ — ลบรอบรถ / เอาใบออกจากรอบรถแล้ว ใบไหนไม่เหลือรถคันไหนเลย
 * → ลบใบนำจ่าย + เลขแทร็คกิ้งในใบ (ManifestParcel ลบตามเอง: onDelete Cascade)
 * จดใบเดิมเข้ารอบรถใหม่ทีหลังได้ ระบบดึงจาก BigSeller ให้ใหม่
 */
export async function deleteManifestsWithoutPickup(manifestIds: (string | null)[]) {
  const ids = [...new Set(manifestIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return 0;
  const r = await db.manifest.deleteMany({ where: { id: { in: ids }, pickups: { none: {} } } });
  return r.count;
}

/**
 * ใบที่ไม่มีรถรับ — ระบบเก็บเฉพาะใบที่ขึ้นรถ ใบอื่นมาจาก sync แบบเก่า (เก็บทุกใบ) หรือลบรอบรถก่อนหน้านี้
 */
export const orphanManifestWhere = { pickups: { none: {} } } as const;
