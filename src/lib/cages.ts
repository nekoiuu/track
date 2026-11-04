import "server-only";
import { db } from "./db";
import { dayRange, todayKey } from "./format";

/**
 * กรง — ของที่วางรวมกันหน้าร้าน 1 กรงมีหลาย manifest และอาจขึ้นรถหลายคัน
 *
 * จดยังไง:
 *   - ยิง manifest ต่อกันไปเรื่อย ๆ → ลงกรงที่ "เปิดอยู่" ของรถคันนี้ (ยังไม่มี = เปิดกรงใหม่ A, B, C… ให้เอง)
 *   - กด "ปิดกรง" → ใบถัดไปขึ้นกรงใหม่
 *   - ยิงใบที่อยู่ในกรงของรถคันอื่น → คันนี้ได้กรงนั้นทั้งกรง (ทุกใบในกรง) ส่วน "ที่เหลือ"
 * แบ่งยังไง: เลือกที่ระดับกรง (ทั้งกรง / ¾ / ½ / ¼ / นับได้ N / ที่เหลือ) → ระบบกระจายลงแต่ละใบ (PickupManifest.parcelCount)
 */

/** A, B, …, Z, AA, AB… */
const letters = (n: number) => {
  let s = "";
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
};

/** ชื่อกรงถัดไปของวันนี้ */
async function nextLabel() {
  const today = dayRange(todayKey());
  const n = await db.cage.count({ where: { createdAt: today } });
  return letters(n);
}

/** กรงที่เปิดอยู่ของรถคันนี้ (เปิดเองและยังไม่ปิด) · ไม่มี = เปิดกรงใหม่ */
export async function openCageFor(pickupId: string, by?: string) {
  const open = await db.cage.findFirst({ where: { originPickupId: pickupId, closedAt: null }, orderBy: { createdAt: "desc" } });
  if (open) return open;
  const cage = await db.cage.create({ data: { label: await nextLabel(), originPickupId: pickupId, createdBy: by ?? null } });
  await db.pickupCage.create({ data: { pickupId, cageId: cage.id } });
  return cage;
}

/**
 * ใบที่เพิ่งจดเข้ารถคันนี้ → ลงกรง
 * - ใบนี้อยู่ในกรงของรถคันอื่นแล้ว → เข้ากรงนั้น + เพิ่มใบอื่นในกรงนั้นให้คันนี้ด้วย (ของปนกันทั้งกรง)
 * - ไม่งั้น → กรงที่เปิดอยู่ของคันนี้
 * @returns ข้อความแจ้ง (เช่น เข้ากรง A ที่แบ่งกับรถ X) · null = กรงปกติ
 */
export async function placeInCage(pmId: string, pickupId: string, manifestId: string | null, by?: string): Promise<string | null> {
  const shared = manifestId
    ? await db.pickupManifest.findFirst({
        where: { manifestId, pickupId: { not: pickupId }, cageId: { not: null } },
        orderBy: { createdAt: "asc" },
        select: { cageId: true },
      })
    : null;

  if (!shared?.cageId) {
    const cage = await openCageFor(pickupId, by);
    await db.pickupManifest.update({ where: { id: pmId }, data: { cageId: cage.id } });
    await applyCageShares(cage.id);
    return null;
  }

  // กรงของรถคันอื่น → คันนี้เอา "ที่เหลือ" ของกรงนั้น
  const cageId = shared.cageId;
  await db.pickupManifest.update({ where: { id: pmId }, data: { cageId } });
  await db.pickupCage.upsert({ where: { pickupId_cageId: { pickupId, cageId } }, create: { pickupId, cageId }, update: {} });

  // ใบอื่นในกรงนี้ที่คันนี้ยังไม่ได้จด → เพิ่มให้ (ของในกรงปนกัน รถเอาไปก็ได้ทุกใบ)
  const inCage = await db.pickupManifest.findMany({
    where: { cageId, manifestId: { not: null } },
    select: { manifestId: true, code: true },
    distinct: ["manifestId"],
  });
  const mine = new Set(
    (await db.pickupManifest.findMany({ where: { pickupId, manifestId: { not: null } }, select: { manifestId: true } })).map((x) => x.manifestId),
  );
  let added = 0;
  for (const x of inCage) {
    if (!x.manifestId || mine.has(x.manifestId)) continue;
    const dupCode = await db.pickupManifest.findUnique({ where: { pickupId_code: { pickupId, code: x.code } } });
    if (dupCode) continue;
    await db.pickupManifest.create({ data: { pickupId, code: x.code, manifestId: x.manifestId, cageId, addedBy: by ? `${by} (ทั้งกรง)` : "ทั้งกรง" } });
    added++;
  }
  await applyCageShares(cageId);

  const cage = await db.cage.findUnique({
    where: { id: cageId },
    select: { label: true, shares: { where: { pickupId: { not: pickupId } }, select: { pickup: { select: { plate: true } } } } },
  });
  const plates = cage?.shares.map((s) => s.pickup.plate).join(", ") || "รถคันอื่น";
  return `ใบนี้อยู่ในกรง ${cage?.label ?? ""} ที่แบ่งกับ ${plates} — ระบบแบ่งให้คร่าว ๆ ก่อน (คันที่ยังไม่เลือกได้ "ที่เหลือ" เฉลี่ยกัน)${added ? ` · เพิ่มอีก ${added} ใบในกรงให้แล้ว` : ""} · กดเลือก ทั้งกรง/½/นับได้ ที่การ์ดกรง`;
}

/** จำนวนชิ้นของแต่ละใบในกรง (ตามเลขแทร็คที่ดึงมา ไม่มีใช้จำนวนตาม BigSeller) */
async function sizesOf(manifestIds: string[]) {
  const rows = await db.manifest.findMany({ where: { id: { in: manifestIds } }, select: { id: true, parcelCount: true, _count: { select: { parcels: true } } } });
  return new Map(rows.map((r) => [r.id, r._count.parcels || r.parcelCount || 0]));
}

/** แบ่ง n ชิ้นตามสัดส่วนขนาดของแต่ละใบ — เศษให้ใบที่ทศนิยมมากสุด (รวมแล้วได้ n พอดี) */
function distribute(n: number, sizes: number[]) {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total) return sizes.map(() => 0);
  const raw = sizes.map((s) => (n * s) / total);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    if (out[i] < sizes[i]) {
      out[i]++;
      left--;
    }
  }
  return out;
}

/**
 * คำนวณจำนวนต่อใบของทุกรถในกรงนี้ ตามที่เลือกไว้ (PickupCage)
 * - กรงอยู่คันเดียว และไม่ได้เลือกสัดส่วน → ทั้งกรง (parcelCount = null)
 * - คันที่เลือกสัดส่วน/จำนวน → คิดตามนั้น
 * - คันที่ไม่ได้เลือก (หลายคัน) → ได้ "ที่เหลือ" ของแต่ละใบ แบ่งเท่า ๆ กันถ้ามีหลายคันที่ไม่ได้เลือก
 */
export async function applyCageShares(cageId: string) {
  const [shares, pms] = await Promise.all([
    db.pickupCage.findMany({ where: { cageId }, orderBy: { createdAt: "asc" } }),
    db.pickupManifest.findMany({ where: { cageId }, select: { id: true, pickupId: true, manifestId: true } }),
  ]);
  const manifestIds = [...new Set(pms.map((p) => p.manifestId).filter((x): x is string => Boolean(x)))];
  const size = await sizesOf(manifestIds);
  const cageTotal = manifestIds.reduce((n, id) => n + (size.get(id) ?? 0), 0);

  // คันเดียว ไม่ได้เลือก → ทั้งกรง
  if (shares.length <= 1 && shares.every((s) => s.share == null && s.count == null)) {
    await db.pickupManifest.updateMany({ where: { cageId }, data: { parcelCount: null } });
    return;
  }

  // ต่อใบ: คันที่เลือกแล้วได้เท่าไหร่
  const alloc = new Map<string, Map<string, number>>(); // pickupId → manifestId → จำนวน
  const used = new Map<string, number>(); // manifestId → รวมที่ถูกจองแล้ว
  const explicit = shares.filter((s) => s.share != null || s.count != null);
  for (const s of explicit) {
    const n = s.count != null ? Math.min(s.count, cageTotal) : Math.round((s.share ?? 0) * cageTotal);
    const parts = distribute(n, manifestIds.map((id) => size.get(id) ?? 0));
    const m = new Map<string, number>();
    manifestIds.forEach((id, i) => {
      m.set(id, parts[i]);
      used.set(id, (used.get(id) ?? 0) + parts[i]);
    });
    alloc.set(s.pickupId, m);
  }
  // คันที่ไม่ได้เลือก → ที่เหลือของแต่ละใบ (หลายคัน = แบ่งเท่า ๆ กัน)
  const rest = shares.filter((s) => s.share == null && s.count == null);
  manifestIds.forEach((id) => {
    const left = Math.max(0, (size.get(id) ?? 0) - (used.get(id) ?? 0));
    const parts = distribute(left, rest.map(() => 1));
    rest.forEach((s, i) => {
      const m = alloc.get(s.pickupId) ?? new Map<string, number>();
      m.set(id, parts[i]);
      alloc.set(s.pickupId, m);
    });
  });

  await Promise.all(
    pms
      .filter((p) => p.manifestId)
      .map((p) => db.pickupManifest.update({ where: { id: p.id }, data: { parcelCount: alloc.get(p.pickupId)?.get(p.manifestId!) ?? 0 } })),
  );
}

/** หลังเอาใบออก: คันนี้ไม่เหลือใบในกรงแล้ว → เอาส่วนแบ่งออก · กรงว่าง → ลบกรง · ที่เหลือคำนวณใหม่ */
export async function tidyCage(cageId: string | null, pickupId: string) {
  if (!cageId) return;
  const left = await db.pickupManifest.count({ where: { cageId, pickupId } });
  if (!left) await db.pickupCage.deleteMany({ where: { cageId, pickupId } });
  const any = await db.pickupManifest.count({ where: { cageId } });
  if (!any) {
    await db.cage.delete({ where: { id: cageId } }).catch(() => null);
    return;
  }
  await applyCageShares(cageId);
}

/**
 * ย้ายใบไปกรงอื่น — ยิงหลายกรงพร้อมกันแล้วใบลงผิดกรง
 * ย้ายทั้งใบ (ทุกรถที่จดใบนี้ในกรงเดิม — กรงคือของจริงหน้าร้าน ใบอยู่กรงเดียว)
 * target = "new" → เปิดกรงใหม่ (ปิดไว้ ไม่รับใบที่ยิงต่อ — กด "ยิงต่อลงกรงนี้" ถ้าจะใช้)
 */
export async function moveToCage(pmId: string, target: string, by?: string): Promise<{ ok?: string; error?: string }> {
  const pm = await db.pickupManifest.findUnique({ where: { id: pmId }, select: { pickupId: true, manifestId: true, code: true, cageId: true } });
  if (!pm) return { error: "ไม่พบใบนี้" };

  const cage =
    target === "new"
      ? await db.cage.create({ data: { label: await nextLabel(), originPickupId: pm.pickupId, createdBy: by ?? null, closedAt: new Date() } })
      : await db.cage.findFirst({ where: { id: target, shares: { some: { pickupId: pm.pickupId } } } });
  if (!cage) return { error: "รถคันนี้ไม่ได้อยู่ในกรงนั้น" };
  if (cage.id === pm.cageId) return { ok: `อยู่กรง ${cage.label} อยู่แล้ว` };

  // ใบเดียวกันที่รถคันอื่นจดไว้ในกรงเดิม → ย้ายตามไปด้วย
  const rows = pm.manifestId && pm.cageId
    ? await db.pickupManifest.findMany({ where: { manifestId: pm.manifestId, cageId: pm.cageId }, select: { id: true, pickupId: true } })
    : [{ id: pmId, pickupId: pm.pickupId }];
  await db.pickupManifest.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { cageId: cage.id } });
  const pickups = [...new Set(rows.map((r) => r.pickupId))];
  for (const pickupId of pickups) {
    await db.pickupCage.upsert({ where: { pickupId_cageId: { pickupId, cageId: cage.id } }, create: { pickupId, cageId: cage.id }, update: {} });
  }

  // กรงเดิม: รถที่ไม่เหลือใบแล้วออกจากกรง · กรงว่างลบทิ้ง · คำนวณส่วนแบ่งใหม่ทั้งสองกรง
  for (const pickupId of pickups) await tidyCage(pm.cageId, pickupId);
  await applyCageShares(cage.id);
  return { ok: `ย้าย ${pm.code} → กรง ${cage.label}` };
}

/** ตั้งชื่อกรงเอง (เช่น ตามเลขบนกรงจริง) */
export async function renameCage(cageId: string, raw: string): Promise<{ ok?: string; error?: string }> {
  const label = raw.trim().toUpperCase().slice(0, 12);
  if (!label) return { error: "ใส่ชื่อกรง" };
  const c = await db.cage.update({ where: { id: cageId }, data: { label } }).catch(() => null);
  return c ? { ok: `เปลี่ยนชื่อเป็นกรง ${label}` } : { error: "ไม่พบกรงนี้" };
}
