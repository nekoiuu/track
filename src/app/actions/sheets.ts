"use server";

import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ParcelStatus } from "@/generated/prisma/enums";
import { TZ } from "@/lib/format";
import type { ParcelItem } from "@/lib/products";
import { SHEETS_HINT, SheetsError, dailyTabName, ensureDailyHeader, listDailyTabs, sheetsConfigured, trackingRowsOf, upsertDailyTabs, writeSnapshotTab, type KeyedRow, type Rgb, type SheetRow } from "@/lib/sheets";
import { PARCEL_STATUS_LABEL, STOCK_IN_NOTE, canCallBigSeller, fetchParcelOrderLog, fetchShippers, syncManifestStatuses, type OrderLogEntry } from "@/lib/bigseller";
import { carrierFamily, flashLabel, flashTone, parcelTone, type CarrierFamily, type FlashTone } from "@/lib/flash-state";
import { refreshFlashStatuses } from "@/lib/flash";
import { RETURN_KIND_LABEL, TRACK_TABS, cancelled, returnKind, shippedSets, tabWhere, type TrackTab } from "@/lib/tracking";
import { CASE_COLUMNS, SHEET_COLUMNS } from "@/lib/sheets-columns";
import { parcelToken, publicBase } from "@/lib/share";
import { requirePickupAccess, visiblePickupIds } from "@/lib/pickup-access";

/** ช่องลิงก์ดูสถานะ (ไม่ต้อง login) — กดจากชีตได้เลย */
const linkCell = (base: string, id: string) => `=HYPERLINK("${base}/share/p/${parcelToken(id)}","ดูสถานะ")`;

export type SheetsState = { ok: boolean; message: string } | undefined;

/** ส่งได้ไม่เกินเท่านี้ต่อครั้ง — กันกดส่งทั้งระบบเผลอ ๆ */
const MAX_ROWS = 3000;


/**
 * ค่าที่เป็น "ข้อความ" เสมอ — เลขแทร็คกิ้ง/ออเดอร์ที่เป็นตัวเลขล้วนยาว ๆ Sheets จะแปลงเป็น 3.29E+18 แล้วเลขหาย
 * และกันสูตร: ค่าที่ขึ้นต้น = + - @ จะถูกตีความเป็นสูตร (ข้อมูลจากภายนอก) → นำหน้าด้วย ' ให้เป็นข้อความ
 */
const text = (v: string | null | undefined) => (v ? `'${v}` : "");
const safe = (v: string | null | undefined) => (!v ? "" : /^[=+\-@]/.test(v) ? `'${v}` : v);
/**
 * วันเวลาไทยแบบอ่านง่าย "14 ต.ค. 13:51" — เป็นข้อความ (Sheets ไม่แปลงเป็นเลขวันที่ 45944.57)
 * ปีอื่นที่ไม่ใช่ปีนี้ใส่ปีด้วย "14 ต.ค. 68 13:51"
 */
const shortFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const yearFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const thisYear = () => new Intl.DateTimeFormat("en", { timeZone: TZ, year: "numeric" }).format(new Date());
const when = (d: Date | null | undefined) =>
  d ? (new Intl.DateTimeFormat("en", { timeZone: TZ, year: "numeric" }).format(d) === thisYear() ? shortFmt : yearFmt).format(d).replace(",", "") : "";
/** "14 ต.ค. 2569" */
const day = (d: Date | null | undefined) => (d ? dayFmt.format(d) : "");

// ─────────────────────────────────────────────── สีตามสถานะ

type Tone = "done" | "move" | "back" | "issue" | "cancel" | "none";
const rgb = (hex: string): Rgb => ({ red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 });
/** tint = พื้นทั้งแถว (อ่อน) · strong = ช่องสถานะ (เข้มกว่า) */
const TONE: Record<Exclude<Tone, "none">, { tint: Rgb; strong: Rgb }> = {
  done: { tint: rgb("#e6f4ea"), strong: rgb("#a8dab5") }, //   เขียว — เซ็นรับแล้ว
  move: { tint: rgb("#e8f0fe"), strong: rgb("#aecbfa") }, //   ฟ้า — รับแล้ว/ระหว่างขนส่ง/กำลังนำส่ง
  back: { tint: rgb("#fef7e0"), strong: rgb("#fde293") }, //   เหลือง — ตีกลับ
  issue: { tint: rgb("#feefe3"), strong: rgb("#fcc28c") }, //  ส้ม — ตกค้าง/มีปัญหา/ส่งไม่สำเร็จ
  cancel: { tint: rgb("#fce8e6"), strong: rgb("#f4a7a0") }, // แดง — ยกเลิก
};

/** กลุ่มสีของแถว — สถานะร้าน (คนตั้ง) มาก่อน แล้วค่อยดู Flash / BigSeller */
function toneOf(p: { status: ParcelStatus; flashState: number | null; bsStatusText?: string | null }): Tone {
  if (p.status === "CANCELLED_AFTER" || p.flashState === 9 || /ยกเลิก|cancel/i.test(p.bsStatusText ?? "")) return "cancel";
  if (p.status === "RETURNING" || p.status === "RETURNED") return "back";
  if (p.status === "PROBLEM") return "issue";
  if (p.status === "DELIVERED") return "done";
  const t = flashTone(p.flashState);
  return t === "none" ? "none" : t;
}

/** แถว + สี: ช่องสถานะ (cols) เข้ม ตัวหนา */
const colored = (values: (string | number)[], tone: Tone, cols: number[]): SheetRow =>
  tone === "none" ? { values } : { values, tint: TONE[tone].tint, strong: { cols, color: TONE[tone].strong } };
/** "28 ก.ย. 2026 20:35:32" — ปี ค.ศ. + วินาที (แบบเดียวกับบันทึกของ BigSeller) */
const scanFmt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  timeZone: TZ,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * ช่อง "Stock-In (BigSeller)": 26 ต.ค. 2026 23:15:00 bank@G963080137 — ยังไม่ Stock-In = ว่าง
 * (BigSeller ให้เวลาถึงนาที วินาทีเป็น 00)
 */
const stockInText = (s: { receivedAt: Date; receivedBy: string | null } | undefined) =>
  s ? safe([scanFmt.format(s.receivedAt), s.receivedBy].filter(Boolean).join(" ")) : "";

/**
 * ช่อง "ผู้สแกน (BigSeller)": 28 ก.ย. 2026 20:35:32 ajean@G963010029
 * เวลา = scannedAt · ไม่มี (ได้คนสแกนจาก wave) → เวลาจากบันทึกออเดอร์ของคนนั้น · ไม่มีทั้งคู่ = ชื่ออย่างเดียว
 */
function scannerText(p: { scannedBy: string | null; scannedAt: Date | null; orderLog?: unknown }) {
  if (!p.scannedBy) return "";
  const log = (p.orderLog as OrderLogEntry[] | null) ?? [];
  const logAt = log.filter((e) => e.user === p.scannedBy && e.at).at(-1)?.at;
  const at = p.scannedAt ?? (logAt ? new Date(logAt) : null);
  const time = at && !Number.isNaN(at.getTime()) ? scanFmt.format(at) : "";
  return safe([time, p.scannedBy].filter(Boolean).join(" "));
}

/**
 * ก่อนส่ง: ทำข้อมูลให้ครบทุกชิ้นที่จะส่ง (ไม่ใช่แค่หน้าที่เคยเปิด)
 * - สถานะ Flash: ถามใหม่ชิ้นที่ยังไม่เคยถาม / ถามนานเกิน 30 นาที (ชิ้นที่จบแล้วไม่ถามซ้ำ)
 * - ผู้สแกน: ดึงจาก BigSeller ชิ้นที่ยังไม่เคยดึง — พร้อมกันทีละ 4 · ไม่เกิน SCAN_FETCH_LIMIT ชิ้น และไม่เกิน SCAN_BUDGET_MS ต่อครั้ง
 *   (BigSeller ยิงเข้าคิวเดียวห่างกัน REQUEST_DELAY_MS · 1 ชิ้น = 2 request → 300 ชิ้นรอ ~15 นาที ปุ่มหมุนค้าง)
 */
const SCAN_FETCH_LIMIT = 300;
const SCAN_PARALLEL = 4;
const SCAN_BUDGET_MS = 20_000;
async function fillScanners(parcelIds: string[]) {
  if (!(await canCallBigSeller())) return { fetched: 0, left: 0 };
  // ทีละ 300 ชิ้นต่อ request จาก wave (เร็ว) — ที่ยังไม่เจอค่อยดึงบันทึกออเดอร์ทีละชิ้นด้านล่าง (ได้เวลาสแกนด้วย แต่ช้า)
  await fetchShippers(parcelIds).catch((e) => console.warn("[sheets] ดึงคนสแกนจาก wave ไม่สำเร็จ:", e));
  const where ={ id: { in: parcelIds }, scannedBy: null, orderLogFetchedAt: null, orderNo: { not: null } };
  const missing = await db.manifestParcel.findMany({ where, select: { id: true }, take: SCAN_FETCH_LIMIT });
  const deadline = Date.now() + SCAN_BUDGET_MS;
  let fetched = 0;
  for (let i = 0; i < missing.length && Date.now() < deadline; i += SCAN_PARALLEL) {
    const chunk = missing.slice(i, i + SCAN_PARALLEL);
    await Promise.allSettled(chunk.map((m) => fetchParcelOrderLog(m.id)));
    fetched += chunk.length;
  }
  const left = fetched === missing.length && missing.length < SCAN_FETCH_LIMIT ? 0 : await db.manifestParcel.count({ where });
  return { fetched, left };
}

async function prepare(parcelIds: string[], { maxFlash }: { maxFlash?: number } = {}) {
  // ยกเลิกแล้ว (เช่น ยกเลิกก่อนส่งให้ Flash) → ไม่ต้องถาม Flash · ส่งไป Sheets ได้เลย
  // maxFlash = ถาม Flash ไม่เกินเท่านี้ (เก่าสุดก่อน · จบแล้วไม่ถาม) — ปุ่มอัปเดตทั้งหมดไม่ให้ถาม Flash ทีละพันจนโดนบล็อก/หมดเวลา
  const askFlash = (
    await db.manifestParcel.findMany({
      where: {
        id: { in: parcelIds },
        NOT: cancelled,
        ...(maxFlash != null ? { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] } : {}),
      },
      ...(maxFlash != null ? { orderBy: { flashFetchedAt: { sort: "asc" as const, nulls: "first" as const } }, take: maxFlash } : {}),
      select: { id: true },
    })
  ).map((p) => p.id);
  const [flash, scan, items] = await Promise.all([
    askFlash.length
      ? refreshFlashStatuses({ parcelIds: askFlash }, { staleMinutes: 30 }).catch((e) => ({ ok: false, message: String(e), count: 0 }))
      : { ok: true, message: "", count: 0 },
    fillScanners(parcelIds),
    fillItems(parcelIds),
  ]);
  const notes = [
    !flash.ok && "เช็ค Flash ไม่ครบบางชิ้น",
    items.missing > 0 && `${items.missing} ชิ้นยังไม่มีรายการสินค้า (${items.reason})`,
    scan.left > 0 && `ผู้สแกนยังไม่ครบ ${scan.left} ชิ้น — กดส่งอีกครั้งเพื่อดึงต่อ`,
  ].filter(Boolean);
  return notes.length ? ` · ${notes.join(" · ")}` : "";
}

/**
 * รายการสินค้าของชิ้นที่ยังไม่เคยดึง → ดึงจาก BigSeller (มากับสถานะออเดอร์ 50 ออเดอร์ต่อ request)
 * @returns missing = ยังไม่มีหลังดึง (เชื่อม BigSeller ไม่ได้ / ไม่มีเลขออเดอร์)
 */
async function fillItems(parcelIds: string[]) {
  const where = { id: { in: parcelIds }, items: { equals: Prisma.DbNull } };
  const need = await db.manifestParcel.findMany({ where: { ...where, orderNo: { not: null } }, select: { manifestId: true } });
  if (!need.length) return { missing: 0, reason: "" };
  if (!(await canCallBigSeller())) return { missing: need.length, reason: "เชื่อม BigSeller ไม่ได้ — ตั้ง cookie ที่หน้า /sync" };
  await syncManifestStatuses([...new Set(need.map((p) => p.manifestId))], { notify: false }).catch(() => null);
  const missing = await db.manifestParcel.count({ where: { ...where, orderNo: { not: null } } });
  return { missing, reason: "BigSeller ไม่ตอบรายการสินค้า" };
}

/**
 * สินค้าในกล่อง บรรทัดละรายการ: "SKU ×2"
 * ใช้ชื่อ SKU ไม่ใช้ชื่อสินค้า — สินค้าเดียวมีหลายตัวเลือก ชื่อสินค้าแยกไม่ออกว่าตัวไหน
 * ไม่มี SKU (ข้อมูลเก่า) → ใช้ชื่อสินค้าแทน
 */
const itemsText = (items: unknown) =>
  ((items as ParcelItem[] | null) ?? [])
    .map((i) => `${i.sku?.trim() || i.name?.trim() || "?"}${i.qty > 1 ? ` ×${i.qty}` : ""}`)
    .join("\n");

/**
 * ปุ่ม "ส่งไป Google Sheets" — แถวที่เห็นอยู่ (ตามตัวกรอง/ค้นหา) แถวละ 1 กล่อง
 * แยกลงแท็บรายวันตามวันที่รถเข้ารับ (เช่น 8OCT26) — ยังไม่มีแท็บวันนั้น สร้างให้พร้อมหัวตาราง
 * @param parcelIds id ของกล่อง (ส่งมาจากแถวที่เห็นในตาราง)
 */
export async function exportParcelsToSheets(parcelIds: string[], pickupId?: string): Promise<SheetsState> {
  const user = pickupId ? await requirePickupAccess(pickupId) : await requireUser();
  if (!sheetsConfigured()) return { ok: false, message: "ยังไม่ได้ตั้งค่า Google Sheets ใน .env" };
  const ids = [...new Set(parcelIds)].slice(0, MAX_ROWS);
  if (!ids.length) return { ok: false, message: "ไม่มีรายการให้ส่ง" };

  // ส่งจากหน้ารอบรถ → ใช้รถคันนี้เสมอ (ใบเดียวกันอาจถูกจดกับรถคันอื่นด้วย) · ไม่งั้นใช้รถคันล่าสุดที่จดใบนั้น
  const fixed = pickupId
    ? await db.pickup.findUnique({
        where: { id: pickupId },
        select: { plate: true, arrivedAt: true, departedAt: true, recordedBy: true, manifests: { select: { manifestId: true, createdAt: true } } },
      })
    : null;
  const addedAt = new Map(fixed?.manifests.map((pm) => [pm.manifestId, pm.createdAt]) ?? []);

  // สถานะ Flash + ผู้สแกน ของทุกชิ้นที่จะส่ง
  const note = await prepare(ids);
  const byTab = await dailyRows(ids, { fixed, addedAt });

  try {
    // เคยส่งแล้ว (เลข tracking อยู่ในแท็บนั้น) = เขียนทับแถวเดิม · ยังไม่เคย = ต่อท้าย
    const r = await upsertDailyTabs(SHEET_COLUMNS, byTab);
    audit(user, "sheets.export", "parcel", null, `เพิ่ม ${r.appended} · อัปเดต ${r.updated} แถว → ${r.tabs.join(", ")}`);
    const created = r.created.length ? ` · สร้างแท็บใหม่ ${r.created.join(", ")}` : "";
    const failed = r.errors.length ? ` · ไม่สำเร็จ ${r.errors.join(" · ")}` : "";
    const parts = [r.appended && `เพิ่ม ${r.appended} แถว`, r.updated && `อัปเดตแถวเดิม ${r.updated} แถว`].filter(Boolean).join(" · ");
    return { ok: !r.errors.length, message: `${parts || "ไม่มีอะไรเปลี่ยน"} (แท็บ ${r.tabs.join(", ") || "—"})${created}${failed}${note}` };
  } catch (e) {
    // รายละเอียดดิบไว้ใน log ของ server เท่านั้น
    console.warn("[sheets] ส่งไม่สำเร็จ:", e);
    return { ok: false, message: SHEETS_HINT[e instanceof SheetsError ? e.kind : "other"] };
  }
}

type FixedTruck = { plate: string; arrivedAt: Date; departedAt: Date | null; recordedBy: string | null } | null;

/**
 * ช่อง "สถานะ" — งานยกเลิก/ตีกลับ บอกแบบให้กรองในชีตได้: "ตีกลับ" · "ยกเลิก · ไม่ได้ไปกับรถ" · "ยกเลิก · ไปกับรถ"
 * ได้ของคืนแล้วต่อท้าย " · ได้ของคืนแล้ว" · งานปกติ = สถานะร้านเหมือนเดิม
 */
function statusCell(p: { status: ParcelStatus; flashState: number | null; flashNotFound: boolean; bsState: string | null; shippingMethod: string | null }) {
  const kind = returnKind(p);
  if (!kind) return PARCEL_STATUS_LABEL[p.status];
  return p.status === "RETURNED" ? `${RETURN_KIND_LABEL[kind]} · ${PARCEL_STATUS_LABEL.RETURNED}` : RETURN_KIND_LABEL[kind];
}

/**
 * แถวของแท็บรายวัน (ตามลำดับ SHEET_COLUMNS) แยกตามแท็บ
 * - fixed = ส่งจากหน้ารอบรถ → ใช้รถคันนั้น · ไม่งั้นใช้รถคันล่าสุดที่จดใบนั้น
 * - forceTab = ลงแท็บนี้เสมอ (อัปเดตแถวเดิมในแท็บที่เคยส่ง ไม่คำนวณแท็บใหม่)
 */
async function dailyRows(ids: string[], { fixed = null, addedAt = new Map(), forceTab }: { fixed?: FixedTruck; addedAt?: Map<string | null, Date>; forceTab?: string } = {}) {
  const parcels = await db.manifestParcel.findMany({
    where: { id: { in: ids } },
    orderBy: [{ manifestId: "asc" }, { trackingNo: "asc" }],
    select: {
      id: true,
      trackingNo: true,
      orderNo: true,
      bsStatusText: true,
      bsState: true,
      shippingMethod: true,
      flashState: true,
      flashStateText: true,
      flashNotFound: true,
      flashLastRoute: true,
      status: true,
      items: true,
      scannedAt: true,
      scannedBy: true,
      orderLog: true,
      createdAt: true,
      // Stock-In ใน BigSeller ล่าสุด (บันทึกจากปุ่มเช็คสถานะ BigSeller)
      returns: { where: { note: STOCK_IN_NOTE }, orderBy: { receivedAt: "desc" }, take: 1, select: { receivedAt: true, receivedBy: true } },
      manifestId: true,
      manifest: {
        select: {
          printedAt: true,
          manifestNo: true,
          // รถคันล่าสุดที่จดใบนี้ + ตอนที่จดใบนี้ขึ้นรถ
          pickups: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true, pickup: { select: { plate: true, arrivedAt: true, departedAt: true, recordedBy: true } } },
          },
        },
      },
    },
  });

  // แยกตามวันที่รถเข้ารับ — ยังไม่มีรถ ใช้วันที่ส่ง
  const byTab = new Map<string, KeyedRow[]>();
  const base = await publicBase();
  const statusCols = [SHEET_COLUMNS.indexOf("สถานะ"), SHEET_COLUMNS.indexOf("Update")];
  for (const p of parcels) {
    const latest = p.manifest.pickups[0];
    const pm = fixed ? { createdAt: addedAt.get(p.manifestId) ?? null } : latest;
    const truck = fixed ?? latest?.pickup;
    const date = truck?.arrivedAt ?? new Date();
    const row = [
      day(date), //                                   วัน
      statusCell(p), //                               สถานะ (ของเรา · งานยกเลิก/ตีกลับ บอกแบบ)
      safe(flashLabel(p) ?? p.bsStatusText), //        Update (สถานะ Flash · ยังไม่มีใช้ BigSeller)
      text(p.manifest.manifestNo), //                  Manifest (เลขใบนำจ่าย)
      when(p.manifest.printedAt ?? p.createdAt), //    เวลาการสร้าง (พิมพ์ใบนำจ่าย)
      text(p.trackingNo), //                           หมายเลข tracking
      safe(itemsText(p.items)), //                     สินค้า
      safe(truck?.plate), //                           เลขรถรับงาน
      when(truck?.arrivedAt), //                       /เวลา (รถเข้า)
      safe(truck?.recordedBy), //                      ชื่อ (ผู้จด)
      when(pm?.createdAt), //                          ตอนขึ้นรถ (จด manifest ขึ้นรถ)
      when(truck?.departedAt), //                      ตอนปิดรถ (ปิดงาน)
      scannerText(p), //                               ผู้สแกน (BigSeller)
      when(p.scannedAt), //                            เวลาสแกน (จาก wave ไม่มีเวลา → ว่าง · มีค่าเดิมในชีตจะคงไว้)
      safe(p.flashLastRoute), //                       ความเคลื่อนไหวล่าสุด (Flash)
      linkCell(base, p.id), //                         ลิงก์ติดตาม (หน้าสาธารณะ)
      stockInText(p.returns[0]), //                    Stock-In (BigSeller): เวลา + คนกด
    ];
    const tab = forceTab ?? dailyTabName(date);
    byTab.set(tab, [...(byTab.get(tab) ?? []), { key: p.trackingNo, row: colored(row, toneOf(p), statusCols) }]);
  }
  return byTab;
}

/** ปุ่ม "อัปเดตทุกแถวที่เคยส่ง" — ทำต่อรอบไม่เกินเท่านี้ ที่เหลือหน้าเว็บเรียกต่อเอง (กัน server ตัดเพราะนานเกิน) */
const UPDATE_BUDGET_MS = 40_000;

export type SheetsUpdateState = { ok: boolean; message: string; next?: number; done: number; total: number; updated: number };

/**
 * อัปเดตทุกแถวที่เคยส่งไปแท็บรายวัน — อ่านเลข tracking ที่อยู่ในแต่ละแท็บ แล้วเขียนสถานะล่าสุดทับแถวเดิม (ไม่เพิ่มแถว)
 * ทีละแท็บ (ใหม่ → เก่า) ภายใน UPDATE_BUDGET_MS · ยังไม่ครบคืน next = แท็บถัดไป ให้หน้าเว็บเรียกต่อ
 * แท็บไหนพัง ข้ามไปแท็บถัดไป (บอกในข้อความ)
 * @param from ลำดับแท็บที่จะเริ่ม (0 = แท็บล่าสุด) · days = ย้อนหลังกี่แท็บ
 */
export async function updateSentToSheets(from = 0, days = 30): Promise<SheetsUpdateState> {
  const user = await requireUser();
  if (!sheetsConfigured()) return { ok: false, message: "ยังไม่ได้ตั้งค่า Google Sheets ใน .env", done: 0, total: 0, updated: 0 };
  const start = Date.now();
  let tabs: string[];
  try {
    tabs = (await listDailyTabs()).slice(0, Math.max(1, Math.min(days, 120)));
  } catch (e) {
    return { ok: false, message: SHEETS_HINT[e instanceof SheetsError ? e.kind : "other"], done: 0, total: 0, updated: 0 };
  }

  let i = Math.max(0, Math.floor(from));
  let updated = 0;
  const errors: string[] = [];
  for (; i < tabs.length && Date.now() - start < UPDATE_BUDGET_MS; i++) {
    const tab = tabs[i];
    try {
      // แท็บเก่าโครงคอลัมน์เดิม → ปรับให้ตรงหัวล่าสุดก่อน (ไม่งั้นอ่านเลข tracking ผิดคอลัมน์)
      await ensureDailyHeader(tab);
      const nos = [...(await trackingRowsOf(tab)).keys()];
      if (!nos.length) continue;
      // เลขเดียวกันอาจอยู่หลายใบ (สแกนซ้ำ) — เอาแถวล่าสุดของแต่ละเลข
      const found = await db.manifestParcel.findMany({ where: { trackingNo: { in: nos } }, orderBy: { createdAt: "desc" }, select: { id: true, trackingNo: true } });
      const ids = [...new Map(found.map((p) => [p.trackingNo, p.id] as const).reverse()).values()];
      if (!ids.length) continue;
      await prepare(ids, { maxFlash: 150 });
      const r = await upsertDailyTabs(SHEET_COLUMNS, await dailyRows(ids, { forceTab: tab }), { appendNew: false });
      updated += r.updated;
      errors.push(...r.errors);
    } catch (e) {
      console.warn(`[sheets] อัปเดตแท็บ ${tab} ไม่สำเร็จ:`, e);
      // สิทธิ์ / ชีตหาย / login Google ไม่ผ่าน = แท็บอื่นก็พัง หยุดเลย
      if (e instanceof SheetsError && e.kind !== "other" && e.kind !== "quota") {
        return { ok: false, message: SHEETS_HINT[e.kind], done: i, total: tabs.length, updated };
      }
      errors.push(`${tab}: ${e instanceof SheetsError ? SHEETS_HINT[e.kind] : "ไม่สำเร็จ"}`);
    }
  }

  const finished = i >= tabs.length;
  if (finished || errors.length) audit(user, "sheets.update", "parcel", null, `อัปเดต ${updated} แถว · ${i}/${tabs.length} แท็บ${errors.length ? ` · พัง ${errors.length}` : ""}`);
  return {
    ok: !errors.length,
    message: `${finished ? "อัปเดตครบแล้ว" : "กำลังอัปเดต"} ${i}/${tabs.length} แท็บ · ${updated} แถว${errors.length ? ` · ไม่สำเร็จ ${errors.join(" · ")}` : ""}`,
    next: finished ? undefined : i,
    done: i,
    total: tabs.length,
    updated,
  };
}

/**
 * ปุ่ม "ส่งเคสนี้ไป Sheets" ในหน้าติดตามสถานะ — ทุกชิ้นในเคสนั้น (ไม่ใช่แค่หน้าที่เห็น)
 * ลงแท็บ "ติดตาม-<ชื่อเคส>" เขียนทับทั้งแท็บ = รายการล่าสุดเสมอ · แถว 1 เป็นหัวตาราง
 */
export async function exportTrackingCase(tab: TrackTab, rangeDays: number, staleDays: number): Promise<SheetsState> {
  const user = await requireUser();
  if (!sheetsConfigured()) return { ok: false, message: "ยังไม่ได้ตั้งค่า Google Sheets ใน .env" };
  const info = TRACK_TABS.find((t) => t.key === tab);
  if (!info) return { ok: false, message: "ไม่รู้จักเคสนี้" };

  const where = tabWhere(tab, { rangeDays, staleDays }, await shippedSets(rangeDays, staleDays));
  const first = await db.manifestParcel.findMany({ where, select: { id: true }, take: MAX_ROWS });
  const note = await prepare(first.map((p) => p.id));

  // อ่านเคสใหม่หลังเช็ค Flash — ชิ้นที่เพิ่งจบ (เช่น เซ็นรับแล้ว) หลุดจากเคสไปเอง
  const parcels = await db.manifestParcel.findMany({
    where,
    take: MAX_ROWS,
    orderBy: [{ flashRoutedAt: { sort: "asc", nulls: "first" } }, { trackingNo: "asc" }],
    select: {
      id: true,
      trackingNo: true,
      orderNo: true,
      status: true,
      statusNote: true,
      flashState: true,
      flashStateText: true,
      flashNotFound: true,
      flashLastRoute: true,
      flashRoutedAt: true,
      bsStatusText: true,
      items: true,
      scannedBy: true,
      scannedAt: true,
      orderLog: true,
      manifest: {
        select: {
          manifestNo: true,
          pickups: { where: { pickup: { status: "DONE" } }, orderBy: { createdAt: "desc" }, take: 1, select: { pickup: { select: { plate: true, departedAt: true } } } },
        },
      },
    },
  });

  const now = Date.now();
  const base = await publicBase();
  const statusCols = [CASE_COLUMNS.indexOf("สถานะร้าน"), CASE_COLUMNS.indexOf("สถานะ Flash")];
  const rows = parcels.map((p) => {
    const truck = p.manifest.pickups[0]?.pickup;
    const since = p.flashRoutedAt ?? truck?.departedAt ?? null;
    return colored([
      text(p.trackingNo),
      text(p.orderNo),
      safe(itemsText(p.items)),
      PARCEL_STATUS_LABEL[p.status],
      safe(flashLabel(p) ?? ""),
      safe(p.flashLastRoute),
      when(p.flashRoutedAt),
      since ? Math.floor((now - since.getTime()) / 86_400_000) : "",
      safe(truck?.plate),
      when(truck?.departedAt),
      text(p.manifest.manifestNo),
      scannerText(p),
      when(p.scannedAt),
      safe(p.statusNote),
      linkCell(base, p.id),
    ], toneOf(p), statusCols);
  });

  const title = `ติดตาม-${info.label.replace(/[\/?*\[\]:]/g, "-")}`;
  try {
    const r = await writeSnapshotTab(title, CASE_COLUMNS, rows);
    audit(user, "sheets.case", "parcel", null, `${info.label}: ${r.total} แถว`);
    return { ok: true, message: `ส่ง “${info.label}” ${r.total} แถวไปแท็บ ${title} แล้ว${r.created ? " (สร้างแท็บใหม่)" : " (เขียนทับรายการเดิม)"}${note}` };
  } catch (e) {
    console.warn("[sheets] ส่งเคสไม่สำเร็จ:", e);
    return { ok: false, message: SHEETS_HINT[e instanceof SheetsError ? e.kind : "other"] };
  }
}

/**
 * ปุ่ม "ส่งอัปเดตไป Sheets" ในหน้ารอบรถ (ทั้งวัน) — ทุกชิ้นของทุกคันในรายการ
 * เคยส่งแล้ว = อัปเดตแถวเดิม · ยังไม่เคย = ต่อท้าย · ทีละคัน (ใช้รถคันนั้นในแถว) ภายใน UPDATE_BUDGET_MS
 * ยังไม่ครบคืน next = คันถัดไป ให้หน้าเว็บเรียกต่อ · คันไหนพัง ข้ามไปคันถัดไป
 */
export async function exportPickupsToSheets(pickupIds: string[], ship: CarrierFamily | "all", tones: FlashTone[] | null, from = 0): Promise<SheetsUpdateState> {
  const user = await requireUser();
  if (!sheetsConfigured()) return { ok: false, message: "ยังไม่ได้ตั้งค่า Google Sheets ใน .env", done: 0, total: 0, updated: 0 };
  // เฉพาะคันที่คนนี้เห็นได้ (คงลำดับเดิม — from นับตามลำดับนี้)
  const visible = new Set(await visiblePickupIds(user, [...new Set(pickupIds)].slice(0, 100)));
  const list = [...new Set(pickupIds)].slice(0, 100).filter((id) => visible.has(id));
  const start = Date.now();
  let i = Math.max(0, Math.floor(from));
  let updated = 0;
  let appended = 0;
  const errors: string[] = [];

  for (; i < list.length && Date.now() - start < UPDATE_BUDGET_MS; i++) {
    const pickup = await db.pickup.findUnique({
      where: { id: list[i] },
      select: { plate: true, arrivedAt: true, departedAt: true, recordedBy: true, manifests: { select: { manifestId: true, createdAt: true } } },
    });
    if (!pickup) continue;
    const manifestIds = pickup.manifests.map((pm) => pm.manifestId).filter((x): x is string => Boolean(x));
    // กรองตามกลุ่มสถานะที่เลือก (ชิปในหน้ารอบรถ) — ไม่เลือก = ทุกชิ้น
    const want = tones?.length ? new Set(tones) : null;
    const ids = (
      await db.manifestParcel.findMany({
        where: { manifestId: { in: manifestIds } },
        select: { id: true, status: true, flashState: true, shippingMethod: true, bsStatusText: true },
        take: MAX_ROWS,
      })
    )
      // ขนส่งที่เลือก (ตัวกรองในหน้ารอบรถ) · กลุ่มสถานะที่เลือก
      .filter((p) => (ship === "all" || carrierFamily(p) === ship) && (!want || want.has(parcelTone(p))))
      .map((p) => p.id);
    if (!ids.length) continue;
    try {
      await prepare(ids, { maxFlash: 150 });
      const addedAt = new Map(pickup.manifests.map((pm) => [pm.manifestId, pm.createdAt]));
      const r = await upsertDailyTabs(SHEET_COLUMNS, await dailyRows(ids, { fixed: pickup, addedAt }));
      updated += r.updated;
      appended += r.appended;
      errors.push(...r.errors.map((e) => `${pickup.plate} ${e}`));
    } catch (e) {
      console.warn(`[sheets] ส่งรถ ${pickup.plate} ไม่สำเร็จ:`, e);
      if (e instanceof SheetsError && e.kind !== "other" && e.kind !== "quota") {
        return { ok: false, message: SHEETS_HINT[e.kind], done: i, total: list.length, updated: updated + appended };
      }
      errors.push(`${pickup.plate}: ${e instanceof SheetsError ? SHEETS_HINT[e.kind] : "ไม่สำเร็จ"}`);
    }
  }

  const finished = i >= list.length;
  if (finished || errors.length) audit(user, "sheets.export", "pickup", null, `ทั้งวัน ${i}/${list.length} คัน · เพิ่ม ${appended} · อัปเดต ${updated}`);
  return {
    ok: !errors.length,
    message: `${finished ? "ส่งครบแล้ว" : "กำลังส่ง"} ${i}/${list.length} คัน · เพิ่ม ${appended} · อัปเดตแถวเดิม ${updated}${errors.length ? ` · ไม่สำเร็จ ${errors.join(" · ")}` : ""}`,
    next: finished ? undefined : i,
    done: i,
    total: list.length,
    updated: updated + appended,
  };
}

/**
 * สถานะเปลี่ยน → อัปเดตแถวที่เคยส่งไปแท็บรายวัน (ไม่เพิ่มแถว · ไม่ดึงข้อมูลเพิ่ม · ช่องที่ไม่มีข้อมูลใช้ค่าเดิมในชีต)
 * เรียกเบื้องหลัง (after) หลังเช็ค Flash / แก้สถานะ — พังก็แค่ log ไม่กระทบงานหลัก
 */
export async function updateSheetRowsFor(parcelIds: string[]) {
  await requireUser();
  const ids = [...new Set(parcelIds)].slice(0, MAX_ROWS);
  if (!ids.length || !sheetsConfigured()) return { updated: 0 };
  try {
    const r = await upsertDailyTabs(SHEET_COLUMNS, await dailyRows(ids), { appendNew: false });
    if (r.errors.length) console.warn("[sheets] อัปเดตตามสถานะไม่ครบ:", r.errors);
    return { updated: r.updated };
  } catch (e) {
    console.warn("[sheets] อัปเดตตามสถานะไม่สำเร็จ:", e);
    return { updated: 0 };
  }
}
