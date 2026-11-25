import "server-only";
import { db } from "./db";
import { canCallBigSeller, ERROR_HINT } from "./bigseller";
import { loadApi, recordResult } from "./bigseller-session";
import { fmtDateTime, fmtTime, todayKey } from "./format";
import { cageTitle } from "./cage-name";
import { SHEETS_HINT, SheetsError, dailyTabName, sheetsConfigured, upsertSideBlock, type KeyedRow, type Rgb } from "./sheets";

/**
 * ตามหาของยกเลิก — ดึงออเดอร์ที่ "ยกเลิกวันนี้" จาก BigSeller ทุก 5 นาที (แท็บ Canceled + Cancel Time + Today)
 * แล้วจดลง CancelHunt ให้เจ้าหน้าที่ไปหาของออกจากกอง/กรงก่อนขึ้นรถ
 *
 * - 1 รอบ = 1 request (วันละ ~300–1,000 ใบ · 300 แถว/หน้า) — เบา ไม่เสี่ยงโดนจำกัด
 * - ทุกเครื่อง/ทุกช่องทางใช้รอบเดียวกัน (ล็อกด้วยแถว SyncRun) — เปิดหน้าหลายเครื่องก็ไม่ยิงซ้ำ
 * - เขียน DB ครั้งเดียวต่อรอบ (INSERT … ON CONFLICT) — ไม่ทับผลตามหาที่เจ้าหน้าที่กดไว้
 */

/** ดึงทุกกี่นาที (CANCEL_HUNT_MINUTES · 0 = ปิดรอบอัตโนมัติ · ค่าเริ่มต้น 5) */
export function huntMinutes() {
  const raw = process.env.CANCEL_HUNT_MINUTES?.trim();
  if (raw === "0") return 0;
  return Number(raw) > 0 ? Number(raw) : 5;
}

const LOCK_ID = "cancel-hunt";
/** กด "ดึงตอนนี้" ได้ถี่สุดเท่านี้ — กันคนกดรัว */
const MANUAL_MIN_MS = 30_000;
/** BigSeller ปฏิเสธ → พักก่อนลองใหม่ */
const BACKOFF_MS = 10 * 60_000;

type Row = {
  id?: string | number;
  platformOrderId?: string | number;
  packageNo?: string;
  platform?: string;
  shopName?: string;
  trackingNo?: string | null;
  shippingCarrierName?: string | null;
  cancelTimeStr?: string | null;
  cancelReason?: string | null;
  buyerCancelReason?: string | null;
  cancelByDisplay?: string | null;
  inCancelBeforeStatus?: string | null;
  multilingualCancelBeforeStatus?: string | null;
  printLabelMark?: number;
  printLabelTime?: number | null;
  printLabelTimeStr?: string | null;
  printShipLabelTime?: number | null;
  printShipLabelTimeStr?: string | null;
  printPickListMark?: number;
  printPickListTime?: number | null;
  printPickListTimeStr?: string | null;
  packTime?: number | null;
  packTimeStr?: string | null;
  orderItemList?: {
    inventorySku?: string;
    varSku?: string;
    itemSku?: string;
    itemName?: string;
    inventorySkuTitle?: string;
    varAttr?: string;
    quantity?: number;
    inventorySkuImage?: string;
    image?: string;
  }[];
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
};

const bkk = (y: number, mo: number, d: number, h: number, mi: number) => {
  if (y > 2400) y -= 543; // ปี พ.ศ.
  const p = (n: number) => String(n).padStart(2, "0");
  const t = new Date(`${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:00+07:00`);
  return Number.isNaN(t.getTime()) ? null : t;
};

/**
 * เวลาจาก BigSeller (เวลาไทยตามบัญชี) → Date · อ่านไม่ออก = null
 * รูปแบบเปลี่ยนตามภาษาของบัญชี: "25 Nov 2026 08:30" · "25 พ.ย. 2026 08:30" · "2026-11-25 08:30" · "25/11/2026 08:30" · epoch ms
 */
export function parseBsTime(v: string | number | null | undefined): Date | null {
  // epoch ของ BigSeller เป็น "เวลาไทยแต่นับเหมือน UTC" (orderCreateTime 1795595210000 = หน้าเว็บโชว์ 25 Nov 2026 08:26) → ลบ 7 ชม.
  if (typeof v === "number") return v > 1e11 ? new Date(v - 7 * 3_600_000) : null;
  const s = v?.trim();
  if (!s || s === "--") return null;
  let m = s.match(/^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 3)] ?? MONTHS[m[2]];
    return mon ? bkk(+m[3], mon, +m[1], +m[4], +m[5]) : null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
  if (m) return bkk(+m[1], +m[2], +m[3], +m[4], +m[5]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m) return bkk(+m[3], +m[2], +m[1], +m[4], +m[5]);
  return null;
}

/** สถานะก่อนยกเลิกที่แปลว่า "ของออกจากชั้นแล้ว" — หยิบ/แพ็ก/รอรถ */
const HANDLED_BEFORE = /to ?ship|to ?pickup|pickup|process|pack|ship/i;

/**
 * ต้องตามหาของไหม — ของออกจากชั้นไปแล้วเท่านั้น (ยังไม่จ่าย / ออเดอร์ใหม่ที่ยังไม่หยิบ ของยังอยู่บนชั้น ไม่ต้องหา)
 * ดูจาก: พิมพ์ใบปะหน้า · พิมพ์ใบหยิบ · มีเลขแทร็ค · แพ็กแล้ว · สถานะก่อนยกเลิกเป็นรอส่ง/รอรถ
 */
export function needsFind(r: Row) {
  if (/unpaid/i.test(r.inCancelBeforeStatus ?? "")) return false;
  return Boolean(
    r.printLabelMark || r.printPickListMark || r.trackingNo?.trim() || r.packTime || parseBsTime(r.packTimeStr) || HANDLED_BEFORE.test(r.inCancelBeforeStatus ?? ""),
  );
}

export type HuntItem = { sku: string; name?: string; qty: number; img?: string };

const itemsOf = (r: Row): HuntItem[] =>
  (r.orderItemList ?? [])
    .map((i) => ({
      sku: String(i.inventorySku || i.varSku || i.itemSku || "").trim(),
      name: (i.inventorySkuTitle || i.itemName || "").trim() || undefined,
      qty: Number(i.quantity ?? 0),
      img: i.inventorySkuImage || i.image || undefined,
    }))
    .filter((i) => i.sku || i.name);

const str = (v: unknown) => {
  const s = v == null ? "" : String(v).trim();
  return s && s !== "--" ? s : null;
};

function toRecord(r: Row, day: string) {
  return {
    bsOrderId: String(r.id),
    day,
    packageNo: str(r.packageNo),
    orderNo: str(r.platformOrderId),
    platform: str(r.platform),
    shopName: str(r.shopName),
    trackingNo: str(r.trackingNo)?.toUpperCase() ?? null,
    carrier: str(r.shippingCarrierName),
    cancelledAt: parseBsTime(r.cancelTimeStr)?.toISOString() ?? null,
    cancelReason: str(r.cancelReason ?? r.buyerCancelReason),
    cancelBy: str(r.cancelByDisplay),
    beforeStatus: str(r.multilingualCancelBeforeStatus ?? r.inCancelBeforeStatus),
    // ช่องตัวเลข (epoch) ก่อน — ไม่ขึ้นกับภาษาของบัญชี · ไม่มีค่อยอ่านจากข้อความ
    labelPrintedAt: (parseBsTime(r.printLabelTime ?? r.printShipLabelTime) ?? parseBsTime(r.printLabelTimeStr ?? r.printShipLabelTimeStr))?.toISOString() ?? null,
    pickPrintedAt: (parseBsTime(r.printPickListTime) ?? parseBsTime(r.printPickListTimeStr))?.toISOString() ?? null,
    packedAt: (parseBsTime(r.packTime) ?? parseBsTime(r.packTimeStr))?.toISOString() ?? null,
    items: itemsOf(r),
    needsFind: needsFind(r),
  };
}

/** จองรอบ — ได้ = true · รอบก่อนยังไม่ครบเวลา / กำลังพักหลัง error = false */
async function claim(minMs: number) {
  const now = new Date();
  const got = await db.syncRun.updateMany({
    where: { id: LOCK_ID, startedAt: { lte: new Date(now.getTime() - minMs + 2_000) } },
    data: { startedAt: now, finishedAt: null },
  });
  if (got.count) return true;
  return db.syncRun
    .create({ data: { id: LOCK_ID, kind: LOCK_ID, startedAt: now } })
    .then(() => true)
    .catch(() => false);
}

export type HuntSync = { ran: boolean; ok: boolean; message: string; total?: number; newFind?: number };

/**
 * ดึงออเดอร์ยกเลิกวันนี้ 1 รอบ
 * @param manual กดจากหน้าเว็บ — เว้นระยะแค่ 30 วิ (รอบอัตโนมัติเว้นตาม CANCEL_HUNT_MINUTES)
 */
export async function syncTodayCancels({ manual = false } = {}): Promise<HuntSync> {
  if (!(await canCallBigSeller())) return { ran: false, ok: false, message: "ยังเชื่อม BigSeller ไม่ได้ (cookie) — แปะ cookie ที่หน้าเชื่อมต่อ BigSeller" };
  const every = manual ? MANUAL_MIN_MS : Math.max(1, huntMinutes()) * 60_000;
  if (!(await claim(every))) return { ran: false, ok: true, message: "เพิ่งดึงไปเมื่อกี้" };

  const day = todayKey();
  const api = await loadApi();
  let rows: Row[];
  try {
    rows = ((await api.listCancelledByDay({ days: 0 })) as { rows: Row[] }).rows;
    await recordResult(api);
  } catch (e) {
    const err = e as Error & { kind?: string };
    if (err.kind) await recordResult(api, err);
    await db.syncRun.update({
      where: { id: LOCK_ID },
      data: {
        ok: false,
        startedAt: new Date(Date.now() + BACKOFF_MS - every),
        finishedAt: new Date(),
        errorKind: err.kind ?? "unknown",
        message: err.message?.slice(0, 500),
      },
    });
    return { ran: true, ok: false, message: ERROR_HINT[err.kind ?? "unknown"] ?? `ดึงจาก BigSeller ไม่สำเร็จ: ${err.message}` };
  }

  const records = rows.filter((r) => r.id != null).map((r) => toRecord(r, day));
  let newFind = 0;
  if (records.length) {
    // ใหม่ = เพิ่ม · มีแล้ว = อัปเดตเฉพาะข้อมูลจาก BigSeller (ไม่แตะ status / คนหา / หมายเหตุ)
    // needsFind ขึ้นจาก false → true ได้ (เพิ่งรู้ว่าพิมพ์ใบแล้ว) แต่ไม่ลงกลับ — คนกำลังหาอยู่จะได้ไม่หายจากรายการ
    const inserted = await db.$queryRaw<{ needsFind: boolean }[]>`
      INSERT INTO "CancelHunt" (
        id, "bsOrderId", day, "packageNo", "orderNo", platform, "shopName", "trackingNo", carrier,
        "cancelledAt", "cancelReason", "cancelBy", "beforeStatus", "labelPrintedAt", "pickPrintedAt", "packedAt",
        items, "needsFind", "firstSeenAt", "updatedAt"
      )
      SELECT
        'ch' || md5(random()::text || x."bsOrderId"), x."bsOrderId", x.day, x."packageNo", x."orderNo", x.platform, x."shopName", x."trackingNo", x.carrier,
        x."cancelledAt", x."cancelReason", x."cancelBy", x."beforeStatus", x."labelPrintedAt", x."pickPrintedAt", x."packedAt",
        x.items, x."needsFind", now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS x(
        "bsOrderId" text, day text, "packageNo" text, "orderNo" text, platform text, "shopName" text, "trackingNo" text, carrier text,
        "cancelledAt" timestamptz, "cancelReason" text, "cancelBy" text, "beforeStatus" text,
        "labelPrintedAt" timestamptz, "pickPrintedAt" timestamptz, "packedAt" timestamptz, items jsonb, "needsFind" boolean
      )
      ON CONFLICT ("bsOrderId") DO UPDATE SET
        "packageNo" = EXCLUDED."packageNo", "trackingNo" = EXCLUDED."trackingNo", carrier = EXCLUDED.carrier,
        "cancelledAt" = EXCLUDED."cancelledAt", "cancelReason" = EXCLUDED."cancelReason", "cancelBy" = EXCLUDED."cancelBy",
        "beforeStatus" = EXCLUDED."beforeStatus", "labelPrintedAt" = EXCLUDED."labelPrintedAt",
        "pickPrintedAt" = EXCLUDED."pickPrintedAt", "packedAt" = EXCLUDED."packedAt", items = EXCLUDED.items,
        "needsFind" = "CancelHunt"."needsFind" OR EXCLUDED."needsFind", "updatedAt" = now()
      RETURNING "needsFind", (xmax = 0) AS inserted`;
    newFind = (inserted as { needsFind: boolean; inserted?: boolean }[]).filter((r) => r.inserted && r.needsFind).length;

    // จับคู่กับพัสดุในใบนำจ่ายของเรา — บอกได้ว่าอยู่ใบไหน กรงไหน ขึ้นรถคันไหน (เลขแทร็คก่อน · ไม่มีค่อยใช้เลขออเดอร์)
    await db.$executeRaw`
      UPDATE "CancelHunt" c SET "parcelId" = p.id
      FROM "ManifestParcel" p
      WHERE c.day = ${day} AND c."parcelId" IS NULL AND c."trackingNo" IS NOT NULL AND p."trackingNo" = c."trackingNo"`;
    await db.$executeRaw`
      UPDATE "CancelHunt" c SET "parcelId" = p.id
      FROM "ManifestParcel" p
      WHERE c.day = ${day} AND c."parcelId" IS NULL AND c."orderNo" IS NOT NULL AND p."orderNo" = c."orderNo"`;
  }

  const mustFind = records.filter((r) => r.needsFind).length;
  let message = `ยกเลิกวันนี้ ${records.length} ใบ · ต้องหาของ ${mustFind} ใบ${newFind ? ` · ใหม่ ${newFind}` : ""}`;
  // ส่งลง Google Sheets (แท็บของวันนี้ คอลัมน์ S เป็นต้นไป) — พังก็ไม่ทำให้รอบดึงล้ม แค่บอกในข้อความ
  const sheet = await pushHuntToSheets(day);
  if (sheet) message += ` · ${sheet}`;
  await db.syncRun.update({
    where: { id: LOCK_ID },
    data: { ok: true, finishedAt: new Date(), count: records.length, errorKind: null, message },
  });
  return { ran: true, ok: true, message, total: records.length, newFind };
}

/** ดึงล่าสุดเมื่อไหร่ / ผลเป็นยังไง — โชว์บนหน้า */
export async function lastHuntRun() {
  return db.syncRun.findUnique({ where: { id: LOCK_ID }, select: { startedAt: true, finishedAt: true, ok: true, message: true, errorKind: true } });
}

// ─────────────────────────────────────────────── Google Sheets

/**
 * บล็อกยกเลิกในแท็บรายวัน (8OCT26 …) — ตารางหลักใช้ A–Q · เว้น R ว่าง 1 ช่อง · บล็อกนี้เริ่มที่ S
 * ถ้าวันหลังตารางหลักเพิ่มคอลัมน์จนถึง R ให้เลื่อนค่านี้ไปทางขวา (แท็บเก่าบล็อกจะอยู่ที่เดิม)
 */
export const HUNT_SHEET_START = 18; // S
export const HUNT_SHEET_COLUMNS = [
  "ยกเลิกเมื่อ",
  "หมายเลข tracking (ยกเลิก)",
  "เลขแพ็ก",
  "เลขออเดอร์",
  "ร้าน",
  "สินค้า",
  "สถานะก่อนยกเลิก",
  "อยู่ที่",
  "ผลตามหา",
  "ผู้ตาม / เวลา",
  "เหตุผลยกเลิก",
];
const KEY_COL = HUNT_SHEET_COLUMNS.indexOf("เลขแพ็ก");
const RESULT_COL = HUNT_SHEET_COLUMNS.indexOf("ผลตามหา");

const rgb = (hex: string): Rgb => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
const RESULT_TEXT = { PENDING: "ต้องหา", FOUND: "ได้รับสินค้ากลับมาแล้ว", MISSING: "หาไม่เจอ", SKIPPED: "ไม่ต้องหา" } as const;
const RESULT_TINT = { PENDING: rgb("#fee2e2"), FOUND: rgb("#d1fae5"), MISSING: rgb("#fef3c7"), SKIPPED: rgb("#f1f5f9") } as const;
const RESULT_STRONG = { PENDING: rgb("#fca5a5"), FOUND: rgb("#6ee7b7"), MISSING: rgb("#fcd34d"), SKIPPED: rgb("#cbd5e1") } as const;

/** เลขยาวล้วน (เลขออเดอร์) ใส่ ' นำหน้า — ไม่ให้ชีตแปลงเป็น 5.8E+17 */
const txt = (v: string | null | undefined) => (v ? (/^\d{6,}$/.test(v) ? `'${v}` : v) : "");

/**
 * ส่งรายการ "ต้องหา" + ที่กดผลแล้วของวันนั้นลงชีต — แถวเดิม (เลขแพ็กเดียวกัน) เขียนทับ · ใหม่ต่อท้าย
 * ออเดอร์ที่ไม่ต้องหา (ยังไม่จ่าย / ยังไม่หยิบ) ไม่ส่ง — ชีตจะได้มีแต่ของที่ต้องตามจริง
 * @returns ข้อความสั้นสำหรับต่อท้ายผลรอบดึง · null = ไม่ได้ตั้งค่าชีต / ไม่มีอะไรส่ง
 */
export async function pushHuntToSheets(day: string = todayKey(), ids?: string[]): Promise<string | null> {
  if (!sheetsConfigured()) return null;
  const rows = await db.cancelHunt.findMany({
    // ระบุ id (คนเพิ่งกดผล) = ส่งแถวนั้นเสมอ — กดย้อนกลับเป็นยังไม่หา ช่องในชีตจะได้เปลี่ยนตาม
    where: { day, ...(ids ? { id: { in: ids } } : { OR: [{ needsFind: true }, { status: { not: "PENDING" } }] }) },
    orderBy: { cancelledAt: { sort: "asc", nulls: "last" } },
  });
  if (!rows.length) return null;

  // อยู่ใบไหน กรงไหน รถคันไหน
  const parcelIds = rows.map((r) => r.parcelId).filter((x): x is string => Boolean(x));
  const parcels = parcelIds.length
    ? await db.manifestParcel.findMany({
        where: { id: { in: parcelIds } },
        select: {
          id: true,
          manifest: { select: { manifestNo: true, pickups: { select: { cage: { select: { label: true } }, pickup: { select: { plate: true, status: true } } } } } },
        },
      })
    : [];
  const placeOf = new Map(
    parcels.map((p) => {
      const pms = p.manifest.pickups;
      const gone = pms.find((pm) => pm.pickup.status === "DONE");
      const cage = pms.map((pm) => pm.cage?.label).find((l) => l !== undefined);
      const parts = [p.manifest.manifestNo, cage !== undefined && cageTitle(cage), gone ? `ขึ้นรถ ${gone.pickup.plate} ไปแล้ว` : pms.find((pm) => pm.pickup.status === "DOING") && "รถกำลังรับ"];
      return [p.id, parts.filter(Boolean).join(" · ")];
    }),
  );

  const items: KeyedRow[] = rows.map((r) => {
    const goods = (Array.isArray(r.items) ? (r.items as HuntItem[]) : []).map((i) => `${i.sku || i.name} ×${i.qty}`).join("\n");
    return {
      key: r.packageNo ?? r.bsOrderId,
      row: {
        values: [
          r.cancelledAt ? fmtDateTime(r.cancelledAt) : "",
          txt(r.trackingNo),
          r.packageNo ?? r.bsOrderId,
          txt(r.orderNo),
          [r.shopName, r.platform].filter(Boolean).join(" · "),
          goods,
          r.beforeStatus ?? "",
          (r.parcelId && placeOf.get(r.parcelId)) || "ยังไม่ลงใบนำจ่าย (โต๊ะแพ็ก / กองรอสแกน)",
          RESULT_TEXT[r.status],
          r.resolvedAt ? `${r.resolvedBy ?? ""} ${fmtTime(r.resolvedAt)}${r.note ? ` · ${r.note}` : ""}`.trim() : "",
          [r.cancelBy, r.cancelReason].filter(Boolean).join(": "),
        ],
        tint: RESULT_TINT[r.status],
        strong: { cols: [RESULT_COL], color: RESULT_STRONG[r.status] },
      },
    };
  });

  const tab = dailyTabName(new Date(`${day}T12:00:00+07:00`));
  try {
    const res = await upsertSideBlock(tab, HUNT_SHEET_START, HUNT_SHEET_COLUMNS, items, KEY_COL);
    return `Sheets ${tab}: เพิ่ม ${res.appended} · อัปเดต ${res.updated}`;
  } catch (e) {
    console.warn("[cancel-hunt] ส่ง Sheets ไม่สำเร็จ:", e);
    return `Sheets ไม่สำเร็จ: ${e instanceof SheetsError ? SHEETS_HINT[e.kind] : e instanceof Error ? e.message : String(e)}`;
  }
}

// ─────────────────────────────────────────────── สแกน QR จาก LINE (flashReturnCheck)

/** ดูย้อนหลังกี่วัน — ของยกเลิกเมื่อวานแต่เพิ่งหาเจอวันนี้ก็ยังจับคู่ได้ */
const QR_MATCH_DAYS = 14;

export type QrReceiveResult = {
  /** เพิ่งเปลี่ยนเป็น "ได้รับสินค้ากลับมาแล้ว" รอบนี้ */
  matched: { trackingNo: string; packageNo: string | null; items: string }[];
  /** เคยได้รับแล้ว (ส่งเลขซ้ำ) */
  already: string[];
  /** ไม่ใช่ของยกเลิกที่อยู่ในรายการ */
  unknown: string[];
};

/**
 * เจ้าหน้าที่หาของเจอแล้วถ่ายรูปใบปะหน้าลงกลุ่ม LINE → บอท flashReturnCheck อ่าน QR ได้เลขแทร็ค → ส่งมาที่นี่
 * เลขตรงกับของยกเลิก (ยังไม่หา / หาไม่เจอ) → "ได้รับสินค้ากลับมาแล้ว" (FOUND) + ใครส่ง เมื่อไหร่ · อัปเดตชีตแถวนั้น
 * ส่งเลขซ้ำได้ (บอทส่งทั้งวันซ้ำเป็นรอบ ๆ) — ที่ได้รับแล้วไม่เปลี่ยนอีก
 */
export async function receiveByQr(tracks: string[], { by, at }: { by?: string | null; at?: Date | null } = {}): Promise<QrReceiveResult> {
  const want = [...new Set(tracks.map((t) => String(t).replace(/\s+/g, "").toUpperCase()).filter((t) => /^[A-Z0-9]{8,30}$/.test(t)))].slice(0, 3000);
  const result: QrReceiveResult = { matched: [], already: [], unknown: [] };
  if (!want.length) return result;

  const since = new Date(Date.now() - QR_MATCH_DAYS * 86_400_000);
  const rows = await db.cancelHunt.findMany({
    where: { trackingNo: { in: want }, firstSeenAt: { gte: since } },
    select: { id: true, day: true, trackingNo: true, packageNo: true, status: true, items: true },
  });
  const hit = new Set(rows.map((r) => r.trackingNo!));
  result.unknown = want.filter((t) => !hit.has(t));

  const todo = rows.filter((r) => r.status === "PENDING" || r.status === "MISSING");
  result.already = [...new Set(rows.filter((r) => r.status === "FOUND").map((r) => r.trackingNo!))];
  if (todo.length) {
    const when = at && !Number.isNaN(at.getTime()) ? at : new Date();
    await db.cancelHunt.updateMany({
      // เงื่อนไขสถานะซ้ำอีกรอบ — คนกดพร้อมกันไม่ทับกัน
      where: { id: { in: todo.map((r) => r.id) }, status: { in: ["PENDING", "MISSING"] } },
      data: { status: "FOUND", resolvedAt: when, resolvedBy: `สแกน QR (LINE)${by ? ` · ${by}` : ""}`.slice(0, 120), note: "ได้รับสินค้ากลับมาแล้ว — อ่าน QR จากรูปในกลุ่ม LINE" },
    });
    result.matched = todo.map((r) => ({
      trackingNo: r.trackingNo!,
      packageNo: r.packageNo,
      items: (Array.isArray(r.items) ? (r.items as HuntItem[]) : []).map((i) => `${i.sku || i.name} ×${i.qty}`).join(", "),
    }));
    // ชีต: อัปเดตแถวของแต่ละวัน
    const byDay = new Map<string, string[]>();
    for (const r of todo) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.id]);
    for (const [day, ids] of byDay) await pushHuntToSheets(day, ids).catch((e) => console.warn("[cancel-hunt] อัปเดต Sheets (QR) ไม่สำเร็จ:", e));
  }
  return result;
}
