import "server-only";
import { db } from "./db";

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
  const env = getManifestPrefix();
  const latest = await db.manifest.findFirst({
    where: { source: "bigseller" },
    orderBy: [{ printedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { manifestNo: true },
  });
  const fromDb = latest && latest.manifestNo.length > 4 ? latest.manifestNo.slice(0, -4).toUpperCase() : "";
  // เลขยาวเท่ากัน → เทียบตัวอักษรได้เลย (เลขมากกว่า = ใหม่กว่า)
  if (fromDb && env && fromDb.length === env.length) return fromDb > env ? fromDb : env;
  return env || fromDb;
}

/**
 * จด 4 หลักท้าย → ต่อเลขต้นให้เป็นเลขเต็ม (เช่น "2678" → "MFG963092678")
 * เลขต้น = ตัวที่ใหม่กว่าระหว่าง MANIFEST_PREFIX กับใบล่าสุดในระบบ (currentManifestPrefix)
 */
export async function expandManifestCodeAuto(code: string) {
  if (!/^\d{4}$/.test(code)) return code;
  const prefix = await currentManifestPrefix();
  return prefix ? prefix + code : code;
}

/** "8839" → "MFG963088839" (ถ้าตั้ง prefix ไว้) · เลขอื่นคืนตามเดิม */
export const expandManifestCode = (code: string) => {
  const prefix = getManifestPrefix();
  return prefix && /^\d{4}$/.test(code) ? prefix + code : code;
};

// เลข 4 หลักท้ายวนซ้ำได้ → จับคู่เฉพาะใบที่พิมพ์ในช่วงก่อนรถเข้า
const LOOKBACK_MS = 7 * 86_400_000;
const LOOKAHEAD_MS = 2 * 3_600_000;

/**
 * หาใบนำจ่ายที่ตรงกับเลขที่จด
 * - เลขเต็ม → ตรงตัว
 * - เลขท้าย → ใบล่าสุดที่เลขท้ายตรงและพิมพ์ภายใน 7 วันก่อน `at` (ใบที่สร้างเอง ไม่มีเวลาพิมพ์ ก็นับ)
 */
export async function findManifestByCode(code: string, at: Date = new Date()) {
  if (isFullManifestNo(code)) {
    return db.manifest.findUnique({ where: { manifestNo: code } });
  }
  return db.manifest.findFirst({
    where: {
      ...(code.length === 4 ? { last4: code } : { manifestNo: { endsWith: code } }),
      OR: [
        { printedAt: { gte: new Date(at.getTime() - LOOKBACK_MS), lte: new Date(at.getTime() + LOOKAHEAD_MS) } },
        { printedAt: null },
      ],
    },
    orderBy: [{ printedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
}

/** จับคู่ PickupManifest ที่ยังค้างอยู่ — เรียกหลัง sync ทุกครั้ง */
export async function linkPendingPickupManifests() {
  const pending = await db.pickupManifest.findMany({
    where: { manifestId: null },
    include: { pickup: { select: { arrivedAt: true } } },
  });

  const manifestIds = new Set<string>();
  for (const pm of pending) {
    const m = await findManifestByCode(pm.code, pm.pickup.arrivedAt);
    if (!m) continue;
    await db.pickupManifest.update({ where: { id: pm.id }, data: { manifestId: m.id } });
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
