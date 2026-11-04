import "server-only";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import type { ParcelStatus } from "@/generated/prisma/enums";
import { FLASH_STATE, isFlashParcel } from "./flash-state";
import { flashOpenConfigured, flashOpenDelivered, flashOpenRoutes, type FlashPod } from "./flash-open";
import { nextCheckFor } from "./track-schedule";

export { FLASH_STATE, flashLabel, isFlashParcel } from "./flash-state";

/**
 * สถานะพัสดุจากเว็บ Flash Express — ยิงเลขแทร็คไปที่หน้า "เช็คสถานะพัสดุ" ของ Flash
 * (endpoint เดียวกับที่ https://www.flashexpress.co.th/fle/tracking ใช้ ไม่ต้อง login)
 *
 *   POST /webApi/tools/tracking  { "search": "TH...,TH..." }
 *   → { code: 1, data: { list: [{ search_no, pno_display, state, state_text, routes: [{ routed_at, state_text, message, route_action }] }], error_search: ["เลขที่ไม่พบ"] } }
 *
 * ไม่ใช่ API ทางการ — Flash เปลี่ยนเมื่อไหร่ก็พังได้ · เปลี่ยน URL ได้ที่ FLASH_TRACKING_URL ใน .env
 */

const DEFAULT_URL = "https://www.flashexpress.co.th/webApi/tools/tracking";
const env = (k: string, d: string) => (process.env[k] ?? "").trim().replace(/^["']|["']$/g, "") || d;
const num = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);

export const flashConfig = () => ({
  url: env("FLASH_TRACKING_URL", DEFAULT_URL),
  /** เลขต่อ 1 request (หน้าเว็บ Flash รับหลายเลขคั่นด้วย ,) */
  batch: num("FLASH_BATCH_SIZE", 10),
  /** พักระหว่าง request กันโดนบล็อก */
  delayMs: num("FLASH_DELAY_MS", 400),
  /** ยิงพร้อมกันกี่ชุด */
  parallel: num("FLASH_PARALLEL", 3),
  lang: env("FLASH_LANG", "th"),
  /** หน้าเว็บ Flash ปฏิเสธ (403/429/ไม่ใช่ JSON) → หยุดยิงหน้าเว็บกี่นาที */
  cooldownMinutes: num("FLASH_COOLDOWN_MINUTES", 20),
});

/** หน้าเว็บ Flash ปฏิเสธ = โดนจำกัด → พักทั้งระบบ (ไม่ยิงซ้ำให้โดนบล็อกนานขึ้น) */
class FlashBlockedError extends Error {}

const cool = globalThis as unknown as { __flashWebCooldown?: { until: number; reason: string } };

/** กำลังพักยิงหน้าเว็บ Flash อยู่ไหม — null = ยิงได้ */
export function flashWebCooldown() {
  const c = cool.__flashWebCooldown;
  if (!c || c.until <= Date.now()) return null;
  return { until: new Date(c.until), reason: c.reason };
}

function startCooldown(reason: string) {
  const until = Date.now() + flashConfig().cooldownMinutes * 60_000;
  cool.__flashWebCooldown = { until, reason };
  console.warn(`[flash] หน้าเว็บ Flash ปฏิเสธ (${reason}) — พักยิงหน้าเว็บ ${flashConfig().cooldownMinutes} นาที`);
}

export type FlashRoute = { at: string | null; state: number | null; text: string | null; message: string | null; action: string | null };

export type FlashResult = {
  trackingNo: string;
  found: boolean;
  state: number | null;
  stateText: string | null;
  lastRoute: string | null;
  routedAt: Date | null;
  routes: FlashRoute[];
};

type RawRoute = Record<string, unknown>;
type RawItem = Record<string, unknown> & { routes?: RawRoute[] };

const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);

/** เวลาใน routes — วินาที/มิลลิวินาที unix หรือ "YYYY-MM-DD HH:mm:ss" (เวลาไทย) */
function parseTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const s = String(v).trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}+07:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalize(item: RawItem, fallbackNo: string): FlashResult {
  const routes: FlashRoute[] = (Array.isArray(item.routes) ? item.routes : [])
    .map((r) => ({
      at: parseTime(r.routed_at ?? r.routedAt)?.toISOString() ?? null,
      state: r.state != null && Number.isFinite(Number(r.state)) ? Number(r.state) : null,
      text: str(r.state_text ?? r.stateText),
      message: str(r.message),
      action: str(r.route_action ?? r.routeAction),
    }))
    // ใหม่ → เก่า
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const last = routes[0];
  const state = item.state != null && Number.isFinite(Number(item.state)) ? Number(item.state) : null;
  return {
    trackingNo: str(item.search_no) ?? str(item.pno_display) ?? str(item.pno) ?? fallbackNo,
    found: true,
    state,
    stateText: str(item.state_text ?? item.stateText) ?? (state != null ? (FLASH_STATE[state]?.label ?? null) : null),
    lastRoute: last ? [last.message ?? last.text].filter(Boolean).join(" · ") || null : null,
    routedAt: last?.at ? new Date(last.at) : null,
    routes,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ถาม Flash 1 request (ไม่เกิน batch เลข) */
async function trackBatch(nos: string[]): Promise<FlashResult[]> {
  const cfg = flashConfig();
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": cfg.lang,
      Lang: cfg.lang,
      Origin: new URL(cfg.url).origin,
      Referer: `${new URL(cfg.url).origin}/fle/tracking`,
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
    },
    body: JSON.stringify({ search: nos.join(",") }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status === 403 || res.status === 429) throw new FlashBlockedError(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Flash ตอบ HTTP ${res.status}`);
  // ได้หน้า HTML (หน้าตรวจบอท/captcha) แทน JSON = โดนจำกัดเหมือนกัน
  // ดูจากเนื้อจริง ไม่ดู content-type อย่างเดียว — บาง endpoint ตอบ JSON แต่ติด text/plain / text/html หรือไม่ใส่เลย
  const raw = await res.text();
  let body: { code?: number; message?: string; data?: { list?: RawItem[]; error_search?: string[] } } | null;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new FlashBlockedError(/<html|<!doctype/i.test(raw.slice(0, 500)) ? "ได้หน้าเว็บแทน JSON" : "ไม่ได้ตอบเป็น JSON");
  }
  if (!body || body.code !== 1) throw new Error(`Flash ตอบไม่สำเร็จ: ${body?.message ?? "รูปแบบข้อมูลไม่ถูกต้อง"}`);

  const byNo = new Map<string, FlashResult>();
  for (const item of body.data?.list ?? []) {
    const r = normalize(item, "");
    if (r.trackingNo) byNo.set(r.trackingNo.toUpperCase(), r);
    const display = str(item.pno_display);
    if (display) byNo.set(display.toUpperCase(), { ...r, trackingNo: display });
  }
  return nos.map(
    (no) =>
      byNo.get(no.toUpperCase()) ?? { trackingNo: no, found: false, state: null, stateText: null, lastRoute: null, routedAt: null, routes: [] },
  );
}

/**
 * ถามสถานะหลายเลขพร้อมกัน — แบ่งเป็นชุดละ FLASH_BATCH_SIZE
 * ชุดไหนพัง ชุดอื่นยังไปต่อ (ชุดที่พังไม่อยู่ใน results)
 */
export async function trackFlash(trackingNos: string[]) {
  const all = [...new Set(trackingNos.map((n) => n.replace(/\s+/g, "").toUpperCase()).filter(Boolean))];
  // ตั้ง Open API ไว้ → ถาม API ก่อน (ไม่โดนจำกัดแบบหน้าเว็บ) · เลขที่ API ไม่ตอบ (เช่น พัสดุที่แพลตฟอร์มสร้าง) ค่อยถามหน้าเว็บ
  if (flashOpenConfigured()) {
    const api = await flashOpenRoutes(all);
    const web = api.missing.length ? await trackFlashWeb(api.missing) : { results: [] as FlashResult[], errors: [] as string[] };
    const errors = [...api.errors.map((e) => `API: ${e}`), ...web.errors];
    return { ok: web.errors.length === 0, results: [...api.found, ...web.results], errors, asked: all.length, viaApi: api.found.length };
  }
  return { ...(await trackFlashWeb(all)), viaApi: 0 };
}

/** ถามหน้าเว็บเช็คสถานะของ Flash (ไม่ต้องมีบัญชี แต่โดนจำกัดจำนวนครั้ง) */
async function trackFlashWeb(nos: string[]) {
  const cfg = flashConfig();
  const results: FlashResult[] = [];
  const errors: string[] = [];
  const paused = flashWebCooldown();
  if (paused) {
    errors.push(`พักยิงหน้าเว็บ Flash ถึง ${paused.until.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })} (${paused.reason})`);
    return { ok: false, results, errors, asked: nos.length };
  }
  const chunks: string[][] = [];
  for (let i = 0; i < nos.length; i += cfg.batch) chunks.push(nos.slice(i, i + cfg.batch));
  // ยิงพร้อมกันทีละ FLASH_PARALLEL ชุด แล้วพัก — เร็วขึ้นแต่ไม่ถล่มเว็บ Flash
  for (let i = 0; i < chunks.length; i += cfg.parallel) {
    const group = chunks.slice(i, i + cfg.parallel);
    const res = await Promise.allSettled(group.map((c) => trackBatch(c)));
    let blocked: string | null = null;
    res.forEach((r, j) => {
      if (r.status === "fulfilled") results.push(...r.value);
      else {
        if (r.reason instanceof FlashBlockedError) blocked = r.reason.message;
        errors.push(`${group[j][0]}… ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      }
    });
    if (blocked) {
      // โดนจำกัดแล้ว — หยุดชุดที่เหลือทันที รอบหน้าค่อยต่อ (ชิ้นที่ยังไม่ได้ถามไม่ถูกแตะ)
      startCooldown(blocked);
      if (i + cfg.parallel < chunks.length) errors.push(`หยุดไว้ ${chunks.length - i - cfg.parallel} ชุด — รอบหน้าค่อยต่อ`);
      break;
    }
    if (i + cfg.parallel < chunks.length) await sleep(cfg.delayMs);
  }
  return { ok: errors.length === 0, results, errors, asked: nos.length };
}

/**
 * สถานะร้านขยับตาม Flash อัตโนมัติ — ขยับไปข้างหน้าเท่านั้น ไม่ทับที่คนแก้เอง/ยกเลิก/ตีกลับถึงร้านแล้ว
 */
function nextStatus(current: ParcelStatus, flashState: number | null): ParcelStatus | null {
  if (flashState == null) return null;
  if (current === "CANCELLED_AFTER" || current === "RETURNED" || current === "DELIVERED") return null;
  if (flashState === 5) return current === "SHIPPED" ? "DELIVERED" : null;
  if (flashState === 7) return current === "RETURNING" ? null : "RETURNING";
  if ((flashState === 6 || flashState === 8) && current === "SHIPPED") return "PROBLEM";
  return null;
}

export type FlashRefreshScope = { parcelIds?: string[]; manifestIds?: string[]; pickupId?: string; trackingNos?: string[] };

/**
 * ดึงสถานะ Flash แล้วเก็บลง ManifestParcel
 * - เฉพาะพัสดุขนส่ง Flash (หรือยังไม่รู้ขนส่ง)
 * - ข้ามชิ้นที่ Flash บอกเซ็นรับแล้ว/ตีกลับแล้ว (จบแล้ว) เว้นแต่ force
 * - staleMinutes: ข้ามชิ้นที่เพิ่งถามไป (กันกดรัว)
 * - uncheckedOnly: เฉพาะชิ้นที่ยังไม่เคยเช็คเลย (เร็ว — ไม่ต้องถามทั้งใบ)
 */
export async function refreshFlashStatuses(
  scope: FlashRefreshScope,
  {
    force = false,
    staleMinutes = 5,
    uncheckedOnly = false,
    includeFinished = false,
  }: {
    force?: boolean;
    staleMinutes?: number;
    uncheckedOnly?: boolean;
    /** ถามชิ้นที่จบแล้วด้วย — เฉพาะปุ่ม "เช็ค Flash อีกครั้ง" ในหน้าพัสดุทีละชิ้น (คนสั่งเอง) */
    includeFinished?: boolean;
  } = {},
) {
  const or: Prisma.ManifestParcelWhereInput[] = [];
  if (scope.parcelIds?.length) or.push({ id: { in: scope.parcelIds } });
  if (scope.manifestIds?.length) or.push({ manifestId: { in: scope.manifestIds } });
  if (scope.trackingNos?.length) or.push({ trackingNo: { in: scope.trackingNos.map((n) => n.toUpperCase()) } });
  if (scope.pickupId) or.push({ manifest: { pickups: { some: { pickupId: scope.pickupId } } } });
  if (!or.length) return { ok: true, count: 0, changed: 0, notFound: 0, message: "ไม่มีพัสดุ", errors: [] as string[] };

  const fresh = new Date(Date.now() - staleMinutes * 60_000);
  const parcels = await db.manifestParcel.findMany({
    where: {
      OR: or,
      ...(uncheckedOnly ? { flashFetchedAt: null } : {}),
      AND: [
        // จบแล้วไม่ถามซ้ำเสมอ (แม้ force) — Flash: เซ็นรับ / ตีกลับแล้ว / ยกเลิก · ร้าน: ส่งถึงแล้ว / ได้ของคืนแล้ว
        // (เคยรั่ว: ปุ่ม "เช็คทั้งหมด" / ปิดงานรถ ถามชิ้นที่จบไปแล้วซ้ำทุกครั้ง เปลืองโควตาหน้าเว็บ Flash)
        ...(includeFinished
          ? []
          : [{ OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] }, { status: { notIn: ["DELIVERED", "RETURNED"] as ParcelStatus[] } }]),
        // ไม่ force → ข้ามชิ้นที่เพิ่งถาม (กันกดรัว)
        ...(force || uncheckedOnly ? [] : [{ OR: [{ flashFetchedAt: null }, { flashFetchedAt: { lt: fresh } }] }]),
      ],
    },
    select: { id: true, trackingNo: true, shippingMethod: true, status: true, flashState: true },
  });
  const targets = parcels.filter(isFlashParcel);
  if (!targets.length) return { ok: true, count: 0, changed: 0, notFound: 0, message: "ไม่มีพัสดุ Flash ที่ต้องเช็ค (เช็คล่าสุดแล้ว/จบแล้ว)", errors: [] as string[] };

  return applyFlashResults(targets, await trackFlash(targets.map((p) => p.trackingNo)));
}

/** ข้อมูลที่ต้องมีของแต่ละชิ้นก่อนบันทึกผล Flash */
export type FlashTarget = { id: string; trackingNo: string; status: ParcelStatus; flashState: number | null };

/**
 * บันทึกผล Flash ลง ManifestParcel (+ สถานะร้านขยับตาม · ดึงหลักฐานส่งถึง)
 * ใช้โดย refreshFlashStatuses (รอบเบื้องหลัง + ปุ่มในหน้าเว็บ)
 * ชิ้นที่ไม่อยู่ใน r.results (ชุดที่ request พัง) = ไม่แตะ
 */
export async function applyFlashResults(
  targets: FlashTarget[],
  r: { ok: boolean; results: FlashResult[]; errors: string[]; viaApi?: number },
) {
  const byNo = new Map(r.results.map((x) => [x.trackingNo.toUpperCase(), x]));
  const now = new Date();
  let changed = 0;
  /** ชิ้นที่สถานะ Flash หรือสถานะร้านเปลี่ยนรอบนี้ — เอาไปอัปเดตแถวใน Sheets */
  const changedIds: string[] = [];
  let notFound = 0;
  const tally = new Map<string, number>();

  // เก็บเป็นงานไว้ก่อน แล้วยิงพร้อมกันทีละชุด (ไม่ใช้ transaction — DB ผ่าน pooler ไกล ๆ เกิน 5 วินาทีแล้วพัง)
  const updates: (() => Promise<unknown>)[] = [];
  for (const p of targets) {
    const f = byNo.get(p.trackingNo.toUpperCase());
    if (!f) continue; // ชุดที่ request พัง — ไม่แตะ
    if (!f.found) {
      notFound++;
      updates.push(() => db.manifestParcel.update({ where: { id: p.id }, data: { flashFetchedAt: now, flashNotFound: true, nextCheckAt: nextCheckFor(null) } }));
      continue;
    }
    const label = f.stateText ?? "ไม่ทราบ";
    tally.set(label, (tally.get(label) ?? 0) + 1);
    if (f.state !== p.flashState) changed++;
    const status = nextStatus(p.status, f.state);
    if (f.state !== p.flashState || status) changedIds.push(p.id);
    updates.push(() =>
      db.manifestParcel.update({
        where: { id: p.id },
        data: {
          flashState: f.state,
          flashStateText: f.stateText,
          flashLastRoute: f.lastRoute,
          flashRoutedAt: f.routedAt,
          flashFetchedAt: now,
          flashNotFound: false,
          // นัดรอบหน้าเสมอ (ไม่ว่าเช็คจากทางไหน) — tracker / carrier ไม่วนมาเช็คซ้ำก่อนถึงคิว · จบแล้ว (5/7/9) ไม่ถูกหยิบอยู่แล้ว
          nextCheckAt: nextCheckFor(f.state),
          ...(status ? { status, statusBy: "Flash" } : {}),
        },
      }),
    );
  }
  // พร้อมกันครั้งละ 8 แถว — แถวไหนบันทึกไม่ได้ ข้ามไป (กดเช็คใหม่ได้) ไม่ให้ทั้งหน้าพัง
  let saveFailed = 0;
  for (let i = 0; i < updates.length; i += 8) {
    const res = await Promise.allSettled(updates.slice(i, i + 8).map((run) => run()));
    saveFailed += res.filter((r) => r.status === "rejected").length;
  }
  if (saveFailed) console.warn(`[flash] บันทึกไม่สำเร็จ ${saveFailed} แถว`);

  // เซ็นรับแล้ว → ดึงหลักฐานการส่งถึง (Open API เท่านั้น · ครั้งละไม่เกิน 20 ชิ้น ที่เหลือรอบหน้า)
  const pods = flashOpenConfigured() ? await fetchFlashPods(targets.map((p) => p.id), 20) : 0;

  const summary = [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · ");
  const message = [
    `เช็ค Flash ${targets.length} ชิ้น${r.viaApi ? ` (API ${r.viaApi})` : ""}`,
    summary,
    notFound && `ไม่พบใน Flash ${notFound}`,
    changed && `เปลี่ยน ${changed}`,
    r.errors.length && `พัง ${r.errors.length} ชุด: ${r.errors[0]}`,
    saveFailed && `บันทึกไม่สำเร็จ ${saveFailed} ชิ้น — กดเช็คอีกครั้ง`,
    pods && `ได้หลักฐานส่งถึง ${pods} ชิ้น`,
  ]
    .filter(Boolean)
    .join(" · ");
  return { ok: r.ok && !saveFailed, count: targets.length, changed, changedIds, notFound, message, errors: r.errors };
}

/**
 * หลักฐานการส่งถึง (Open API deliveredInfo) ของชิ้นที่เซ็นรับแล้วแต่ยังไม่มีหลักฐาน — ดึงครั้งเดียวแล้วเก็บ
 * @returns จำนวนชิ้นที่ได้หลักฐาน
 */
export async function fetchFlashPods(parcelIds?: string[], limit = 20) {
  if (!flashOpenConfigured()) return 0;
  const todo = await db.manifestParcel.findMany({
    where: { flashState: 5, flashPodAt: null, ...(parcelIds ? { id: { in: parcelIds } } : {}) },
    orderBy: { flashRoutedAt: "desc" },
    take: limit,
    select: { id: true, trackingNo: true },
  });
  let got = 0;
  for (const p of todo) {
    try {
      const pod: FlashPod = await flashOpenDelivered(p.trackingNo);
      await db.manifestParcel.update({ where: { id: p.id }, data: { flashPod: pod as unknown as Prisma.InputJsonValue, flashPodAt: new Date() } });
      got++;
    } catch (e) {
      // เลขที่ API ดูไม่ได้ (เช่น ไม่ใช่พัสดุของ mchId ร้าน) → จำว่าลองแล้ว ไม่ต้องยิงซ้ำทุกรอบ
      await db.manifestParcel.update({ where: { id: p.id }, data: { flashPodAt: new Date() } }).catch(() => null);
      console.warn(`[flash] หลักฐานส่งถึง ${p.trackingNo}:`, e instanceof Error ? e.message : e);
    }
  }
  return got;
}

/**
 * เส้นทางพัสดุ (ทุกความเคลื่อนไหว) — ไม่เก็บใน DB แล้ว: เคยเก็บทุกชิ้น 108 MB = 40% ของตารางพัสดุ เขียนทับทุกรอบที่เช็ค
 * แต่ใช้แค่ตอนเปิดหน้าพัสดุ / ลิงก์พัสดุ → ถาม Flash สดตอนเปิด (ใน DB เก็บแค่ความเคลื่อนไหวล่าสุด flashLastRoute)
 * @param save บันทึกสถานะล่าสุดจากคำตอบนี้ด้วย (ข้อมูลในระบบเก่า) — ไม่ต้องถาม Flash ซ้ำอีกรอบ
 * @returns null = ถาม Flash ไม่สำเร็จ (ให้หน้าเว็บโชว์ความเคลื่อนไหวล่าสุดที่เก็บไว้แทน)
 */
export async function flashRoutesFor(target: FlashTarget, { save = false }: { save?: boolean } = {}): Promise<FlashRoute[] | null> {
  const r = await trackFlash([target.trackingNo]);
  const hit = r.results[0];
  if (!hit) return null;
  if (save) await applyFlashResults([target], r);
  return hit.found ? hit.routes : [];
}

/** markerCategory ที่ถือว่ามีปัญหา: 17 ผู้รับปฏิเสธ · 23 ที่อยู่ผิด · 40 ติดต่อผู้รับไม่ได้ */
const PROBLEM_MARKERS = new Set([17, 23, 40]);

/**
 * Webhook ความเคลื่อนไหว (webhookApiCode 4) — Flash ส่งมาเองทุกครั้งที่พัสดุขยับ ไม่ต้องยิงถาม
 * @returns จำนวนแถวที่อัปเดต (0 = ไม่มีเลขนี้ในระบบ)
 */
export async function applyFlashWebhook(data: Record<string, unknown>) {
  const nos = [data.pno, data.recentPno, data.origPno].map((v) => (v == null ? "" : String(v).trim().toUpperCase())).filter(Boolean);
  if (!nos.length) return 0;
  const parcels = await db.manifestParcel.findMany({
    where: { trackingNo: { in: nos } },
    select: { id: true, status: true, flashRoutedAt: true },
  });
  if (!parcels.length) return 0;

  const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const state = num(data.state);
  const marker = num(data.markerCategory);
  const at = parseTime(data.routedAt);
  const route: FlashRoute = {
    at: at?.toISOString() ?? null,
    state,
    text: str(data.stateText),
    message: str(data.message),
    action: str(data.routedAction ?? data.routeAction),
  };

  for (const p of parcels) {
    // Flash ส่งซ้ำ / ส่งสลับลำดับได้ — ความเคลื่อนไหวที่เก่ากว่าที่เก็บไว้ ไม่ทับของล่าสุด (เส้นทางทั้งหมดถามสดตอนเปิดหน้า)
    if (at && p.flashRoutedAt && at < p.flashRoutedAt) continue;
    let status = nextStatus(p.status, state);
    if (!status && marker != null && PROBLEM_MARKERS.has(marker) && p.status === "SHIPPED") status = "PROBLEM";
    await db.manifestParcel.update({
      where: { id: p.id },
      data: {
        ...(state != null ? { flashState: state } : {}),
        ...(route.text ? { flashStateText: route.text } : {}),
        flashLastRoute: route.message ?? route.text,
        flashRoutedAt: at,
        flashFetchedAt: new Date(),
        flashNotFound: false,
        ...(marker != null ? { flashMarker: marker } : {}),
        ...(status ? { status, statusBy: "Flash" } : {}),
      },
    });
  }
  return parcels.length;
}
