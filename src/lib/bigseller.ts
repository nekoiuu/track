import "server-only";
import { db } from "./db";
import { linkPendingPickupManifests } from "./manifests";
import { after } from "next/server";
import { getSession, loadApi, recordResult } from "./bigseller-session";
import { notifyCancelledAfter } from "./line-messages";
import type { ParcelStatus } from "@/generated/prisma/enums";
import type { ParcelItem } from "./products";
import { awaitingReturn } from "./tracking";

/**
 * สะพานไปหา ../../bigseller-api
 * cookie ล่าสุดอยู่ใน DB และหมุนตาม Set-Cookie ของ BigSeller ให้เอง → ./bigseller-session.ts
 */

/** มี cookie ให้ใช้ไหม (ใน DB หรือ .env) */
export const hasCookie = async () => Boolean((await getSession().catch(() => null))?.cookie);

/** มี cookie และยังไม่โดน auth error — ใช้ตัดสินว่าควรยิงอัตโนมัติไหม */
export async function canCallBigSeller() {
  const s = await getSession().catch(() => null);
  return Boolean(s?.cookie) && s!.deadCookie !== s!.cookie;
}

/**
 * เจ้าหน้าที่จดเลขที่ยังไม่มีในเครื่อง → หาใบจาก BigSeller
 * รายการใบจาก BigSeller จำไว้ในหน่วยความจำ 1 นาที — จดหลายใบติดกันก็ยิงรอบเดียว
 */
export async function refreshManifestsIfStale() {
  if (!(await canCallBigSeller())) return { ran: false as const };
  return { ran: true as const, ...(await syncManifests()) };
}

type Api = Awaited<ReturnType<typeof loadApi>>;

type ManifestRow = {
  manifestNo?: string;
  orderNo?: string | number;
  trackingNo?: string;
  logisticsName?: string;
  manifestInfomation?: string | number;
  printTime?: number;
};

/** ห่อการ sync ให้บันทึก SyncRun ทุกครั้ง สำเร็จหรือพังก็ตาม */
async function track<T extends { count: number; message: string }>(kind: string, fn: (api: Api) => Promise<T>) {
  const run = await db.syncRun.create({ data: { kind } });
  const api = await loadApi();
  try {
    const res = await fn(api);
    await recordResult(api);
    await db.syncRun.update({
      where: { id: run.id },
      data: { ok: true, finishedAt: new Date(), count: res.count, message: res.message },
    });
    return { ok: true as const, ...res };
  } catch (e) {
    const err = e as Error & { kind?: string };
    const message = err.message?.slice(0, 2000) ?? String(e);
    if (err.kind) await recordResult(api, err);   // error ของ BigSeller เท่านั้น (ไม่นับ DB พัง)
    await db.syncRun.update({
      where: { id: run.id },
      data: { ok: false, finishedAt: new Date(), errorKind: err.kind ?? "unknown", message },
    });
    // ข้อความดิบ (stack / query ของ DB) เก็บไว้ใน SyncRun เท่านั้น — หน้าเว็บเห็นแค่คำอธิบายสั้น ๆ
    const kind = err.kind ?? "unknown";
    return { ok: false as const, count: 0, message: ERROR_HINT[kind] ?? "ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง", errorKind: kind };
  }
}

/** ใบล่าสุดที่ดึงต่อครั้ง — เรียงจากใหม่ไปเก่า ครอบคลุมหลายวันย้อนหลังในหน้าเดียว */
const RECENT_PAGE_SIZE = 500;
/** จำรายการใบจาก BigSeller ไว้กี่ ms (ไม่เก็บลง DB) */
const ROWS_TTL_MS = 60_000;
const g = globalThis as unknown as { __bsManifestRows?: { at: number; rows: ManifestRow[] } };

/**
 * หาใบนำจ่ายจาก BigSeller ให้เลขที่จดค้างไว้ (PickupManifest ที่ยังไม่มีใบ)
 * เก็บลง DB เฉพาะใบที่ขึ้นรถ (จับคู่ได้) — ใบอื่นไม่เก็บ · ไม่ใช่ทุกใบที่ BigSeller มี
 * ปกติเอาแค่หน้าล่าสุด (1 request) · all = ทุกใบ (หลาย request ใช้เมื่อจำเป็นจริง ๆ) · fresh = ไม่ใช้ที่จำไว้
 */
export function syncManifests({ all = false, fresh = false }: { all?: boolean; fresh?: boolean } = {}) {
  const cached = g.__bsManifestRows;
  if (!all && !fresh && cached && Date.now() - cached.at < ROWS_TTL_MS) {
    return storeOnTruck(cached.rows).then((r) => ({ ok: true as const, ...r }));
  }
  return track("manifests", async (api) => {
    const { rows } = (
      all ? await api.listManifestsAll({ quiet: true }) : await api.listManifests({ pageSize: RECENT_PAGE_SIZE })
    ) as { rows: ManifestRow[] };
    if (!all) g.__bsManifestRows = { at: Date.now(), rows };
    return storeOnTruck(rows);
  });
}

/** จากรายการใบของ BigSeller → สร้างเฉพาะใบที่ตรงกับเลขที่จดค้าง → จับคู่ → ใบที่จับคู่ไม่ได้ลบทิ้ง */
async function storeOnTruck(rows: ManifestRow[]) {
  const pending = await db.pickupManifest.findMany({ where: { manifestId: null }, select: { code: true } });
  const codes = [...new Set(pending.map((p) => p.code.toUpperCase()))];

  const byNo = new Map<string, ManifestRow>();
  for (const r of rows) {
    const no = r.manifestNo ? String(r.manifestNo).toUpperCase() : "";
    // เลขเต็มที่ค้าง = เลขต้นที่เดาไว้ → เก็บทุกใบที่ 4 หลักท้ายตรงด้วย (ใบไหนไม่ได้จับคู่จะถูกลบทิ้งข้างล่าง)
    if (no && codes.some((c) => no === c || no.endsWith(c) || (c.length >= 8 && no.endsWith(c.slice(-4))))) byNo.set(no, r);
  }
  const candidates = [...byNo.keys()];

  const now = new Date();
  const created = candidates.length
    ? await db.manifest.createMany({
        data: [...byNo].map(([no, r]) => ({
          manifestNo: no,
          last4: no.slice(-4),
          logisticsName: r.logisticsName ?? null,
          printedAt: r.printTime ? new Date(Number(r.printTime)) : null,
          bigsellerInfo: r.manifestInfomation != null ? String(r.manifestInfomation) : null,
          parcelCount: Number.isInteger(Number(r.manifestInfomation)) ? Number(r.manifestInfomation) : null,
          syncedAt: now,
        })),
        skipDuplicates: true,
      })
    : { count: 0 };

  const link = await linkPendingPickupManifests();
  // ใบที่ไม่มีรถรับ (เลขท้ายซ้ำแต่คนละวัน ฯลฯ) → ไม่เก็บ
  if (candidates.length) await db.manifest.deleteMany({ where: { manifestNo: { in: candidates }, pickups: { none: {} } } });
  // ใบที่เพิ่งจับคู่กับเลขที่จด → ดึงเลขแทร็คกิ้งต่อเลย (ใบละ 1 request)
  for (const manifestId of link.manifestIds) await fetchManifestTrackings(manifestId);
  return {
    count: link.linked,
    message: `BigSeller ${rows.length} ใบ · จับคู่ manifest ที่จด ${link.linked}/${link.pending}${created.count ? "" : ""}`,
  };
}

export type TrackingFetch = {
  /** ดึงจาก BigSeller จริงรอบนี้ (false = ใช้ของที่เก็บไว้แล้ว) */
  fetched: boolean;
  ok: boolean;
  count: number;
  expected: number | null;
  message: string;
  /** เลขแทร็คกิ้งในใบนี้ที่อยู่ในใบอื่นด้วย */
  duplicates: { trackingNo: string; manifestNo: string }[];
};

/**
 * เลขแทร็คกิ้งทั้งใบ (1 request ต่อใบ) — เก็บลง DB แล้วครั้งหน้าไม่ยิงซ้ำ
 * force = ดึงใหม่แม้เคยดึงแล้ว (ปุ่มในหน้าใบนำจ่าย)
 */
export async function fetchManifestTrackings(manifestId: string, { force = false } = {}): Promise<TrackingFetch> {
  const m = await db.manifest.findUniqueOrThrow({ where: { id: manifestId } });
  const duplicatesOf = async () =>
    (
      await db.manifestParcel.findMany({
        where: {
          manifestId: { not: manifestId },
          trackingNo: { in: (await db.manifestParcel.findMany({ where: { manifestId }, select: { trackingNo: true } })).map((p) => p.trackingNo) },
        },
        select: { trackingNo: true, manifest: { select: { manifestNo: true } } },
      })
    ).map((p) => ({ trackingNo: p.trackingNo, manifestNo: p.manifest.manifestNo }));

  if (!force && m.trackingsFetchedAt) {
    const count = await db.manifestParcel.count({ where: { manifestId } });
    return { fetched: false, ok: true, count, expected: m.parcelCount, message: `ใช้ข้อมูลที่เก็บไว้ ${count} ชิ้น`, duplicates: await duplicatesOf() };
  }
  if (!(await canCallBigSeller())) {
    return { fetched: false, ok: false, count: 0, expected: m.parcelCount, message: "ยังเชื่อม BigSeller ไม่ได้", duplicates: [] };
  }

  const res = await track("trackings", async (api) => {
    const { trackingNos, rows, totalSize } = (await api.listManifestTrackings(m.manifestNo)) as {
      trackingNos: string[];
      rows: { trackingNo?: string; orderNo?: string | number; packageNo?: string; shippingMethod?: string; storeName?: string }[];
      totalSize: number;
    };
    const orderOf = new Map(rows.map((r) => [String(r.trackingNo ?? "").trim().toUpperCase(), r]));
    const info = (r: (typeof rows)[number] | undefined) => ({
      shippingMethod: r?.shippingMethod?.trim() || null,
      shopName: r?.storeName?.trim() || null,
    });
    await db.manifestParcel.createMany({
      data: trackingNos.map((t) => {
        const no = t.toUpperCase();
        const r = orderOf.get(no);
        return { manifestId, trackingNo: no, orderNo: r?.orderNo != null ? String(r.orderNo) : null, packageNo: r?.packageNo ?? null, ...info(r) };
      }),
      skipDuplicates: true,
    });
    // กล่องที่เคยเก็บไว้ก่อนมีช่องขนส่ง → เติมให้
    const missing = await db.manifestParcel.findMany({ where: { manifestId, shippingMethod: null }, select: { id: true, trackingNo: true } });
    for (const p of missing) {
      const r = orderOf.get(p.trackingNo);
      if (r?.shippingMethod) await db.manifestParcel.update({ where: { id: p.id }, data: info(r) });
    }
    await db.manifest.update({
      where: { id: manifestId },
      data: { trackingsFetchedAt: new Date(), parcelCount: totalSize || m.parcelCount, source: "bigseller" },
    });
    return { count: trackingNos.length, message: `${m.manifestNo} · ${trackingNos.length} ชิ้น` };
  });

  return {
    fetched: true,
    ok: res.ok,
    count: res.count,
    expected: m.parcelCount,
    message: res.message,
    duplicates: res.ok ? await duplicatesOf() : [],
  };
}

export type OrderLogEntry = { at: string | null; raw: string; user: string; action: string; status: string };

/** สแกนแล้วไม่ต้องดึงซ้ำ · ยังไม่สแกน ดึงใหม่ได้เมื่อเก่ากว่านี้ */
const ORDER_LOG_STALE_MS = 10 * 60_000;

/**
 * ใครสแกนพัสดุนี้ — ดึง log ของออเดอร์จาก BigSeller (2 request: หา orderId + log) แล้วเก็บลง DB
 * ครั้งหน้าใช้ของที่เก็บไว้ · force = ดึงใหม่ (ปุ่มในหน้าพัสดุ)
 */
export async function fetchParcelOrderLog(parcelId: string, { force = false } = {}) {
  const p = await db.manifestParcel.findUniqueOrThrow({ where: { id: parcelId } });
  const fresh = p.orderLogFetchedAt && (p.scannedBy || Date.now() - p.orderLogFetchedAt.getTime() < ORDER_LOG_STALE_MS);
  if (!force && fresh) return { ok: true as const, fetched: false, message: "ใช้ข้อมูลที่เก็บไว้" };
  if (!p.orderNo && !p.bsOrderId) return { ok: false as const, fetched: false, message: "พัสดุนี้ไม่มีเลขออเดอร์ — หา log ไม่ได้" };
  if (!(await canCallBigSeller())) return { ok: false as const, fetched: false, message: "ยังเชื่อม BigSeller ไม่ได้" };

  const res = await track("orderlog", async (api) => {
    // ค้นออเดอร์ทุกครั้ง — ได้ทั้ง orderId และสถานะล่าสุดใน request เดียว
    const order = p.orderNo ? await api.findOrder(p.orderNo) : null;
    const orderId = order?.id ?? p.bsOrderId;
    if (!orderId) {
      await db.manifestParcel.update({ where: { id: parcelId }, data: { orderLogFetchedAt: new Date() } });
      return { count: 0, message: `ไม่พบออเดอร์ ${p.orderNo} ใน BigSeller` };
    }
    const log = (await api.listOrderLog(orderId)) as OrderLogEntry[];
    const scan = log.filter((e) => api.SCAN_PATTERN.test(e.action)).at(-1);
    // รถที่รับใบนี้ปิดงานออกไปแล้วหรือยัง — ยกเลิกหลังปิดงานเท่านั้นที่ต้องตามของคืน
    const onTruck = (await db.pickupManifest.count({ where: { manifestId: p.manifestId, pickup: { status: "DONE" } } })) > 0;
    const next = order ? statusFromBigSeller(order, p.status, onTruck) : null;
    await db.manifestParcel.update({
      where: { id: parcelId },
      data: {
        bsOrderId: orderId,
        orderLog: log,
        orderLogFetchedAt: new Date(),
        scannedBy: scan?.user ?? null,
        scannedAt: scan?.at ? new Date(scan.at) : null,
        ...(order ? { bsState: order.state || null, bsStatusText: order.statusText || null } : {}),
        ...(next ? { status: next } : {}),
      },
    });
    const parts = [
      order?.statusText && `BigSeller: ${order.statusText}`,
      next && `อัปเดตสถานะเป็น “${PARCEL_STATUS_LABEL[next]}”`,
      scan && `สแกนโดย ${scan.user}`,
    ].filter(Boolean);
    return { count: log.length, message: parts.join(" · ") || "ยังไม่มีการสแกนใน BigSeller" };
  });
  return { ok: res.ok, fetched: true, message: res.message };
}

/** แถวจากหน้า "การคืนสินค้า Stock-In" ของ BigSeller (bigseller-api: return-in-warehouse → pickReturn) */
export type BigSellerReturn = {
  trackingNo: string;
  orderNo: string | null;
  packageNo: string | null;
  platform: string | null;
  shopName: string | null;
  orderStatus: string | null;
  saleAfterType: string | null;
  saleAfterTypeDesc: string | null;
  returnStatus: string | null;
  returnStatusDesc: string | null;
  inWarehouseStatus: string | null;
  inWarehouseStatusDesc: string | null;
  returnTrackingNo: string | null;
  arriveWarehouseTime: string | null;
  inWarehouseTime: string | null;
  /** inWarehouseTime เป็น ISO · null = ยังไม่ Stock-In */
  inWarehouseAt: string | null;
  /** คนล่าสุดที่ทำรายการ — หลัง Stock-In = คนกด (เช่น bank@G963080137) */
  latestOperator: string | null;
  /** Stock-In เข้าคลังครบแล้ว (ALL_IN_WAREHOUSE) */
  returned: boolean;
};

/** ReturnScan.note ของรายการที่บันทึกจาก Stock-In ใน BigSeller (แยกจากกดรับคืนในแอป) */
export const STOCK_IN_NOTE = "Stock-In ใน BigSeller";

export type StockInSync = {
  ok: boolean;
  message: string;
  /** เพิ่งบันทึกเป็น "ได้ของคืนแล้ว" รอบนี้ */
  marked: string[];
  /** เลขแทร็ค → สถานะ Stock-In ใน BigSeller (ชิ้นที่ยังไม่ครบ) · ไม่มีใน map = ไม่พบในหน้าคืนสินค้าของ BigSeller */
  waiting: Record<string, string>;
};

/**
 * ของยกเลิกหลังขึ้นรถ + ตีกลับ ที่ยังไม่ได้คืน → ถาม BigSeller หน้า "การคืนสินค้า Stock-In" (อ่านอย่างเดียว · 50 เลขต่อ request · 500 ชิ้น ≈ 10 request ~15 วินาที)
 * Stock-In ครบแล้ว → บันทึกรับคืน (ReturnScan: คนกด Stock-In + เวลาจริงจาก BigSeller) + สถานะ "ได้ของคืนแล้ว"
 */
export async function syncStockIns(): Promise<StockInSync> {
  const pending = await db.manifestParcel.findMany({ where: awaitingReturn, orderBy: { updatedAt: "desc" }, select: { id: true, trackingNo: true, status: true }, take: 500 });
  if (!pending.length) return { ok: true, message: "ไม่มีของยกเลิก / ตีกลับที่รอคืน", marked: [], waiting: {} };
  if (!(await canCallBigSeller())) return { ok: false, message: "ยังเชื่อม BigSeller ไม่ได้", marked: [], waiting: {} };

  const marked: string[] = [];
  const waiting: Record<string, string> = {};
  const res = await track("stock-in", async (api) => {
    // ของรอคืนเพิ่งออกไปไม่กี่วัน — ไม่ต้องค้นประวัติเกิน 90 วัน (ประหยัด request)
    const found = (await api.findReturns(
      pending.map((p) => p.trackingNo),
      { history: false },
    )) as Map<string, BigSellerReturn>;
    for (const p of pending) {
      const r = found.get(p.trackingNo.toUpperCase());
      if (!r) continue;
      if (!r.returned) {
        waiting[p.trackingNo] = r.inWarehouseStatusDesc ?? r.inWarehouseStatus ?? "";
        continue;
      }
      const by = r.latestOperator ?? "BigSeller";
      // เงื่อนไขเดียวกับปุ่มรับคืน — ยังอยู่ในรายการรอคืน และยังไม่ "ได้ของคืนแล้ว" (กันบันทึกซ้ำ / ทับที่คนแก้ไปแล้ว)
      const saved = await db.$transaction(async (tx) => {
        const u = await tx.manifestParcel.updateMany({
          where: { AND: [{ id: p.id, status: { not: "RETURNED" } }, awaitingReturn] },
          data: { status: "RETURNED", statusBy: by },
        });
        if (u.count)
          await tx.returnScan.create({
            data: { trackingNo: p.trackingNo, parcelId: p.id, receivedBy: by, receivedAt: r.inWarehouseAt ? new Date(r.inWarehouseAt) : new Date(), note: STOCK_IN_NOTE },
          });
        return u.count > 0;
      });
      if (saved) marked.push(p.trackingNo);
    }
    const parts = [marked.length && `Stock-In แล้ว ${marked.length} ชิ้น (บันทึกรับคืนให้แล้ว)`, `ยังไม่ Stock-In ${Object.keys(waiting).length}`, `ไม่พบในหน้าคืนสินค้า ${pending.length - found.size}`];
    return { count: marked.length, message: parts.filter(Boolean).join(" · ") };
  });
  return { ok: res.ok, message: res.message, marked, waiting };
}

/**
 * ของตีกลับถึงคลังแล้วหรือยัง — ถาม BigSeller หน้า "การคืนสินค้า Stock-In" ตามเลขแทร็ค (อ่านอย่างเดียว ไม่แก้สถานะในเครื่อง)
 * ค้นทีละ 50 เลขต่อ request · null = ไม่พบเลขนี้ในหน้าคืนสินค้าของ BigSeller
 */
export async function checkBigSellerReturns(trackingNos: string[]) {
  const want = [...new Set(trackingNos.map((t) => t.trim().toUpperCase()).filter(Boolean))].slice(0, 200);
  if (!want.length) return { ok: false as const, message: "ยังไม่ได้ใส่เลขแทร็ค", results: {} };
  if (!(await canCallBigSeller())) return { ok: false as const, message: "ยังเชื่อม BigSeller ไม่ได้", results: {} };

  let results: Record<string, BigSellerReturn | null> = {};
  const res = await track("return-status", async (api) => {
    const found = (await api.findReturns(want)) as Map<string, BigSellerReturn>;
    results = Object.fromEntries(want.map((t) => [t, found.get(t) ?? null]));
    const returned = [...found.values()].filter((r) => r.returned).length;
    return { count: found.size, message: `เจอ ${found.size}/${want.length} · คืนแล้ว ${returned}` };
  });
  return { ok: res.ok, message: res.message, results };
}

export const PARCEL_STATUS_LABEL: Record<ParcelStatus, string> = {
  SHIPPED: "ส่งออกแล้ว",
  DELIVERED: "ถึงลูกค้า",
  RETURNING: "กำลังตีกลับ",
  RETURNED: "ได้ของคืนแล้ว",
  PROBLEM: "มีปัญหา",
  CANCELLED_AFTER: "ยกเลิกหลังขึ้นรถ",
};

/**
 * สถานะออเดอร์ BigSeller → สถานะพัสดุของเรา · null = ไม่ต้องเปลี่ยน
 * - "ได้ของคืนแล้ว" / "มีปัญหา" / "ยกเลิก…" คนตั้งเอง → ไม่ทับ
 * - ยกเลิก: รถที่รับใบนี้ปิดงานออกไปแล้ว = ยกเลิกหลังขึ้นรถ (ของไปกับรถ ต้องตามคืน) · รถยังไม่ปิดงาน = ไม่เปลี่ยน
 * - รอรับสินค้า / กำลังดำเนินการ → คงเดิม (อยู่ในใบนำจ่ายแล้ว ถือว่าส่งออก)
 */
function statusFromBigSeller(
  o: { state: string; statusText: string; inCancel: boolean; returnNo: string | null },
  current: ParcelStatus,
  onTruck: boolean,
): ParcelStatus | null {
  if (current === "RETURNED" || current === "PROBLEM" || current === "CANCELLED_AFTER") return null;
  const s = `${o.state} ${o.statusText}`.toLowerCase();
  let next: ParcelStatus | null = null;
  if (o.returnNo || /return|refund|คืน/.test(s)) next = "RETURNING";
  // ยกเลิกก่อนรถปิดงาน = ของยังไม่ได้ส่ง ไม่ต้องตาม → คงเดิม
  else if (o.inCancel || /cancel|ยกเลิก/.test(s)) next = onTruck ? "CANCELLED_AFTER" : null;
  else if (/complet|finish|deliver|เสร็จสิ้น/.test(s)) next = "DELIVERED";
  else if (/shipped|จัดส่งแล้ว/.test(s)) next = "SHIPPED";
  return next && next !== current ? next : null;
}

// ─────────────────────────────────────────────── เฝ้าออเดอร์ยกเลิกในงานที่กำลังทำ

/** เช็คยกเลิกถี่สุดเท่านี้ — ทุกเครื่องที่เปิดงานอยู่ใช้รอบเดียวกัน (ไม่ยิงซ้ำตามจำนวนเครื่อง) */
export const CANCEL_WATCH_EVERY_MS = 30_000;
/** BigSeller ปฏิเสธ (rate-limit / cookie / เน็ต) → พักนานขึ้น ไม่ยิงซ้ำจนพัง */
const CANCEL_WATCH_BACKOFF_MS = 5 * 60_000;
/** แถว SyncRun แถวเดียวใช้เป็นตัวล็อกรอบ — ไม่สร้างแถวใหม่ทุก 30 วิ (ตารางจะบวม) */
const CANCEL_WATCH_ID = "cancel-watch";

const CANCELLED_STATES = ["canceled", "cancelled", "cancel"];

/** จองรอบ: ได้ = true · รอบก่อนยังไม่ครบเวลา / กำลังพักหลัง error = false */
async function claimCancelWatch() {
  const now = new Date();
  const got = await db.syncRun.updateMany({
    where: { id: CANCEL_WATCH_ID, startedAt: { lte: new Date(now.getTime() - CANCEL_WATCH_EVERY_MS + 2_000) } },
    data: { startedAt: now, finishedAt: null },
  });
  if (got.count) return true;
  // ครั้งแรก — ยังไม่มีแถว
  return db.syncRun
    .create({ data: { id: CANCEL_WATCH_ID, kind: CANCEL_WATCH_ID, startedAt: now } })
    .then(() => true)
    .catch(() => false);
}

/**
 * หาออเดอร์ที่ยกเลิกในทุกงานที่กำลังทำ (DOING) — ยิง BigSeller แบบกรองเฉพาะ "ยกเลิก"
 * ได้กลับมาแค่ใบที่ยกเลิก → ~1 request ต่อ 3,000 ออเดอร์ (ช่วงพีค 4–6 คัน ~3,500 ออเดอร์ = 2 request)
 * เจอแล้วจดสถานะลงชิ้นนั้นเลย ไม่ต้องดึงสถานะทั้งใบ
 * @returns ran = รอบนี้ยิง BigSeller จริง · found = ชิ้นที่เพิ่งรู้ว่ายกเลิก
 */
export async function watchDoingCancels(): Promise<{ ran: boolean; found: number; error?: string }> {
  if (!(await canCallBigSeller())) return { ran: false, found: 0 };
  if (!(await claimCancelWatch())) return { ran: false, found: 0 };

  // ชิ้นในใบของงานที่กำลังทำ ที่ยังไม่รู้ว่ายกเลิก
  const parcels = await db.manifestParcel.findMany({
    where: {
      orderNo: { not: null },
      OR: [{ bsState: null }, { bsState: { notIn: CANCELLED_STATES } }],
      manifest: { pickups: { some: { pickup: { status: "DOING" } } } },
    },
    select: { id: true, manifestId: true, orderNo: true, packageNo: true, status: true },
  });
  const orderNos = [...new Set(parcels.map((p) => p.orderNo!))];
  if (!orderNos.length) {
    await db.syncRun.update({ where: { id: CANCEL_WATCH_ID }, data: { ok: true, finishedAt: new Date(), count: 0, message: "ไม่มีออเดอร์ให้เช็ค" } });
    return { ran: false, found: 0 };
  }

  const api = await loadApi();
  let rows: OrderRow[];
  try {
    rows = (await api.searchCancelledOrders(orderNos)) as OrderRow[];
    await recordResult(api);
  } catch (e) {
    const err = e as Error & { kind?: string };
    if (err.kind) await recordResult(api, err);
    // พัก: ดันเวลาเริ่มไปข้างหน้า → รอบถัดไปจองไม่ได้จนพ้นช่วงพัก
    await db.syncRun.update({
      where: { id: CANCEL_WATCH_ID },
      data: {
        ok: false,
        startedAt: new Date(Date.now() + CANCEL_WATCH_BACKOFF_MS - CANCEL_WATCH_EVERY_MS),
        finishedAt: new Date(),
        errorKind: err.kind ?? "unknown",
        message: err.message?.slice(0, 500),
      },
    });
    return { ran: true, found: 0, error: ERROR_HINT[err.kind ?? "unknown"] ?? "เช็คยกเลิกไม่สำเร็จ" };
  }

  // จับคู่เหมือน syncManifestStatuses: เลขแพ็ก (ออเดอร์เดียวหลายกล่อง) ก่อน แล้วค่อยเลขออเดอร์
  const byPackage = new Map(rows.filter((r) => r.packageNo).map((r) => [String(r.packageNo), r]));
  const byOrder = new Map(rows.map((r) => [String(r.platformOrderId ?? ""), r]));
  const hits = parcels.flatMap((p) => {
    const r = (p.packageNo && byPackage.get(p.packageNo)) || byOrder.get(p.orderNo!);
    return r ? [{ p, r }] : [];
  });

  if (hits.length) {
    // ใบที่รถคันอื่นปิดงานออกไปแล้วด้วย = ยกเลิกหลังขึ้นรถ (ตามกติกาเดิมของ statusFromBigSeller)
    const onTruck = new Set(
      (
        await db.pickupManifest.findMany({
          where: { manifestId: { in: [...new Set(hits.map((h) => h.p.manifestId))] }, pickup: { status: "DONE" } },
          select: { manifestId: true },
        })
      ).map((x) => x.manifestId),
    );
    const now = new Date();
    await db.$transaction(
      hits.map(({ p, r }) => {
        const o = {
          state: String(r.state ?? "canceled"),
          statusText: String(r.multilingualViewStatus ?? r.viewStatus ?? ""),
          inCancel: true,
          returnNo: r.returnNo ? String(r.returnNo) : null,
        };
        const next = statusFromBigSeller(o, p.status, onTruck.has(p.manifestId));
        return db.manifestParcel.update({
          where: { id: p.id },
          data: { bsState: o.state, bsStatusText: o.statusText || null, bsStatusChangedAt: now, ...(next ? { status: next } : {}) },
        });
      }),
    );
  }
  await db.syncRun.update({
    where: { id: CANCEL_WATCH_ID },
    data: { ok: true, finishedAt: new Date(), count: hits.length, errorKind: null, message: `เช็ค ${orderNos.length} ออเดอร์ · เจอยกเลิกใหม่ ${hits.length} ชิ้น` },
  });
  return { ran: true, found: hits.length };
}

type OrderRow = {
  id?: string | number;
  platformOrderId?: string | number;
  packageNo?: string;
  state?: string;
  viewStatus?: string;
  multilingualViewStatus?: string;
  inCancel?: unknown;
  returnNo?: string | null;
  /** สินค้าในออเดอร์ — inventorySku = ชื่อ SKU ของคลัง (ตรงกับ productData) */
  orderItemList?: { inventorySku?: string; varSku?: string; itemSku?: string; itemName?: string; quantity?: number }[];
};

/**
 * ดึงสถานะทุกชิ้นในใบนำจ่ายจาก BigSeller พร้อมกัน — ค้นทีละ 50 ออเดอร์ต่อ request (288 ชิ้น ≈ 6 request)
 * จับคู่ด้วยเลขแพ็ก (BSG…) ก่อน เพราะออเดอร์เดียวแยกหลายกล่องได้ · ไม่เจอค่อยใช้เลขออเดอร์
 * เขียน DB แบบรวมกลุ่ม (updateMany ตามสถานะ) ไม่ใช่ทีละแถว — DB อยู่ไกล ทีละแถวจะช้ามาก
 * เก็บรายการสินค้าในกล่องไปด้วย (มาใน request เดียวกัน) — ใช้คิดน้ำหนักรวมของใบ
 */
export async function syncManifestStatuses(
  manifestIds: string[],
  {
    notify = true,
    untrackedOnly = false,
  }: {
    /** แจ้ง LINE เมื่อเจอยกเลิกหลังขึ้นรถใหม่ (ต้องอยู่ใน request — รายงานประจำวันปิดไว้ เพราะสรุปเองอยู่แล้ว) */
    notify?: boolean;
    /** เฉพาะชิ้นที่ยังติดตามอยู่ (สำเร็จ/ยกเลิกที่รายงานแล้วไม่ต้องดึงซ้ำ) */
    untrackedOnly?: boolean;
  } = {},
) {
  if (!manifestIds.length) return { ok: true as const, count: 0, message: "ไม่มีใบนำจ่าย" };
  if (!(await canCallBigSeller())) return { ok: false as const, count: 0, message: "ยังเชื่อม BigSeller ไม่ได้" };

  const [parcels, onTruckRows] = await Promise.all([
    db.manifestParcel.findMany({
      where: { manifestId: { in: manifestIds }, orderNo: { not: null }, ...(untrackedOnly ? { trackingDoneAt: null } : {}) },
      select: { id: true, manifestId: true, orderNo: true, packageNo: true, status: true, bsState: true, bsStatusText: true },
    }),
    // ใบไหนรถปิดงานออกไปแล้ว → ยกเลิกตอนนี้ = ยกเลิกหลังขึ้นรถ
    db.pickupManifest.findMany({ where: { manifestId: { in: manifestIds }, pickup: { status: "DONE" } }, select: { manifestId: true } }),
  ]);
  const onTruck = new Set(onTruckRows.map((r) => r.manifestId));

  return track("statuses", async (api) => {
    const orderNos = [...new Set(parcels.map((p) => p.orderNo!))];
    const { rows } = (await api.searchOrdersBatch(orderNos, { pageSize: 100 })) as { rows: OrderRow[] };
    const byPackage = new Map(rows.filter((r) => r.packageNo).map((r) => [String(r.packageNo), r]));
    const byOrder = new Map(rows.map((r) => [String(r.platformOrderId ?? ""), r]));

    // รวมแถวที่ได้ค่าเหมือนกันไว้ด้วยกัน → updateMany ครั้งเดียวต่อกลุ่ม
    const groups = new Map<
      string,
      { data: { bsState: string | null; bsStatusText: string | null; bsStatusChangedAt?: Date; status?: ParcelStatus }; ids: string[] }
    >();
    const now = new Date();
    const tally = new Map<string, number>();
    let changed = 0;
    let missing = 0;
    const newlyCancelled: string[] = [];
    const itemsOf = new Map<string, ParcelItem[]>();
    for (const p of parcels) {
      const r = (p.packageNo && byPackage.get(p.packageNo)) || byOrder.get(p.orderNo!);
      if (!r) {
        missing++;
        continue;
      }
      itemsOf.set(
        p.id,
        (r.orderItemList ?? [])
          .map((i) => ({ sku: String(i.inventorySku || i.varSku || i.itemSku || "").trim(), name: i.itemName?.trim() || undefined, qty: Number(i.quantity ?? 0) }))
          .filter((i) => i.sku && i.qty > 0),
      );
      const o = {
        state: String(r.state ?? ""),
        statusText: String(r.multilingualViewStatus ?? r.viewStatus ?? ""),
        inCancel: Boolean(r.inCancel),
        returnNo: r.returnNo ? String(r.returnNo) : null,
      };
      tally.set(o.statusText || o.state, (tally.get(o.statusText || o.state) ?? 0) + 1);
      const next = statusFromBigSeller(o, p.status, onTruck.has(p.manifestId));
      if (!next && p.bsState === (o.state || null) && p.bsStatusText === (o.statusText || null)) continue; // ไม่มีอะไรเปลี่ยน
      if (next) changed++;
      if (next === "CANCELLED_AFTER") newlyCancelled.push(p.id);
      // สถานะใน BigSeller ขยับ → จดเวลาไว้ (ไม่ขยับเกิน 2 วัน = ค้าง)
      const moved = p.bsState !== (o.state || null) || p.bsStatusText !== (o.statusText || null);
      const data = {
        bsState: o.state || null,
        bsStatusText: o.statusText || null,
        ...(moved ? { bsStatusChangedAt: now } : {}),
        ...(next ? { status: next } : {}),
      };
      const key = JSON.stringify(data);
      const g = groups.get(key) ?? { data, ids: [] };
      g.ids.push(p.id);
      groups.set(key, g);
    }

    await db.$transaction([
      ...[...groups.values()].map((g) => db.manifestParcel.updateMany({ where: { id: { in: g.ids } }, data: g.data })),
      db.manifest.updateMany({ where: { id: { in: manifestIds } }, data: { statusesFetchedAt: new Date() } }),
    ]);
    // รายการสินค้าทุกกล่องใน query เดียว (unnest) — ทีละแถวจะช้ามากเพราะ DB อยู่ไกล
    if (itemsOf.size) {
      const ids = [...itemsOf.keys()];
      const json = ids.map((id) => JSON.stringify(itemsOf.get(id)));
      await db.$executeRaw`UPDATE "ManifestParcel" AS p SET items = v.items::jsonb, "itemsSyncedAt" = now() FROM unnest(${ids}::text[], ${json}::text[]) AS v(id, items) WHERE p.id = v.id`;
    }

    // ของที่เพิ่งพบว่ายกเลิกหลังขึ้นรถ → LINE (หลังตอบหน้าเว็บ) · รอบหน้าไม่แจ้งซ้ำ เพราะสถานะนี้ไม่ถูกทับแล้ว
    if (notify && newlyCancelled.length) {
      after(() => notifyCancelledAfter(newlyCancelled).catch((e) => console.warn("[line] แจ้งยกเลิกหลังขึ้นรถไม่สำเร็จ:", e)));
    }

    const summary = [...tally].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ");
    const parts = [summary, changed && `เปลี่ยนสถานะ ${changed} ชิ้น`, missing && `ไม่พบใน BigSeller ${missing} ชิ้น`].filter(Boolean);
    return { count: parcels.length - missing, message: parts.join(" · ") || "ไม่มีชิ้นที่มีเลขออเดอร์" };
  });
}

export const ERROR_HINT: Record<string, string> = {
  "no-cookie": "ยังไม่ได้ตั้ง BIGSELLER_COOKIE ใน .env — ดู bigseller-api/cookie/HOWTO.md",
  auth: "cookie หมดอายุ — แปะ cookie ใหม่ที่หน้า BigSeller (/sync) ใช้ได้ทันที",
  permission: "บัญชีนี้ไม่มีสิทธิ์เมนูนั้น — ให้ admin เปิดสิทธิ์ (cookie ยังใช้ได้)",
  "rate-limit": "ยิงถี่เกิน — รอสักครู่แล้วลองใหม่",
  network: "ต่อ BigSeller ไม่ได้ — เช็คอินเทอร์เน็ต",
};

/** เลขต่อ 1 request ของ wave-packages (ทดสอบ 300 เลข ได้ครบใน request เดียว) */
const WAVE_CHUNK = 300;

/**
 * คนสแกนจัดส่ง ("สแกนและจัดส่งบน App") แบบทีละหลายร้อยชิ้น — WMS → การจัดการพัสดุ (getWaveOrderPackageQuery)
 * ช่อง shipper ของ wave = คนเดียวกับในบันทึกออเดอร์ (เทียบแล้ว 8/8) แต่ 1 request ได้ 300 ชิ้น
 * (บันทึกออเดอร์ทีละชิ้น = 2 request ห่างกัน 1.5 วิ → ช้ามาก) · wave ไม่มีเวลาที่สแกน → scannedAt คงเดิม
 * รายการสินค้า (skuVos) มาด้วย — เติมให้ชิ้นที่ยังไม่มี
 * @returns found = ได้ชื่อคนสแกนกี่ชิ้น
 */
export async function fetchShippers(parcelIds: string[]) {
  const todo = await db.manifestParcel.findMany({
    where: { id: { in: parcelIds }, scannedBy: null },
    select: { id: true, trackingNo: true, items: true },
  });
  if (!todo.length) return { ok: true, found: 0, left: 0 };
  if (!(await canCallBigSeller())) return { ok: false, found: 0, left: todo.length };

  type WaveRow = { trackingNo?: string; shipper?: string; skuVos?: { sku?: string; skuName?: string; num?: number }[] };
  const byNo = new Map<string, WaveRow>();
  const res = await track("shippers", async (api) => {
    const nos = todo.map((p) => p.trackingNo);
    // "จัดส่งแล้ว" ก่อน · ที่ยังไม่เจอค่อยหาใน "รอจัดส่ง"
    for (const view of ["shipped", "all"] as const) {
      const left = nos.filter((n) => !byNo.has(n));
      for (let i = 0; i < left.length; i += WAVE_CHUNK) {
        const page = (await api.listWavePackages({ view, searchType: "trackingNo", search: left.slice(i, i + WAVE_CHUNK), pageSize: 1000, days: 30 })) as {
          rows?: WaveRow[];
        };
        for (const r of page.rows ?? []) if (r.trackingNo) byNo.set(String(r.trackingNo).trim().toUpperCase(), r);
      }
    }
    return { count: byNo.size, message: `wave ${byNo.size}/${nos.length} ชิ้น` };
  });
  if (!res.ok) return { ok: false, found: 0, left: todo.length };

  const valid = (s?: string) => (s && s.trim() && s.trim() !== "--" ? s.trim() : null);
  const ids: string[] = [];
  const shippers: string[] = [];
  const itemIds: string[] = [];
  const itemJson: string[] = [];
  for (const p of todo) {
    const r = byNo.get(p.trackingNo.toUpperCase());
    const shipper = valid(r?.shipper);
    if (shipper) {
      ids.push(p.id);
      shippers.push(shipper);
    }
    if (r?.skuVos?.length && p.items == null) {
      itemIds.push(p.id);
      itemJson.push(JSON.stringify(r.skuVos.map((s) => ({ sku: String(s.sku ?? "").trim(), name: s.skuName?.trim() || undefined, qty: Number(s.num ?? 0) }))));
    }
  }
  // อัปเดตรวมทีเดียว (DB อยู่ไกล — ทีละแถวช้า)
  if (ids.length) {
    await db.$executeRaw`UPDATE "ManifestParcel" AS p SET "scannedBy" = v.shipper FROM unnest(${ids}::text[], ${shippers}::text[]) AS v(id, shipper) WHERE p.id = v.id AND p."scannedBy" IS NULL`;
  }
  if (itemIds.length) {
    await db.$executeRaw`UPDATE "ManifestParcel" AS p SET items = v.items::jsonb, "itemsSyncedAt" = now() FROM unnest(${itemIds}::text[], ${itemJson}::text[]) AS v(id, items) WHERE p.id = v.id AND p.items IS NULL`;
  }
  return { ok: true, found: ids.length, left: todo.length - ids.length };
}
