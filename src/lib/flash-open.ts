import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { FlashResult, FlashRoute } from "./flash";

/**
 * Flash Express Open API (ทางการ — ต้องขอ mchId + key จาก Flash) https://open-docs.flashexpress.com/
 *
 * .env
 *   FLASH_OPEN_MCH_ID=...           รหัสร้านค้า
 *   FLASH_OPEN_KEY=...              secret key (ใช้เซ็น ห้ามหลุด)
 *   FLASH_OPEN_BASE=https://open-api-tra.flashexpress.com   (ไม่ใส่ = production open-api.flashexpress.com)
 *
 * ไม่ตั้งค่า = ระบบใช้วิธีเดิม (ยิงหน้าเว็บเช็คสถานะของ Flash)
 * หมายเหตุ: API ตอบได้เฉพาะพัสดุที่สร้างใต้ mchId ของร้าน — พัสดุที่แพลตฟอร์ม (Shopee/Lazada) สร้างอาจไม่ได้ (error 1019)
 *          เลขที่ API ไม่ตอบ ระบบถามหน้าเว็บแทนให้เอง
 */

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");

export const flashOpenConfig = () => ({
  mchId: clean(process.env.FLASH_OPEN_MCH_ID),
  key: clean(process.env.FLASH_OPEN_KEY),
  base: (clean(process.env.FLASH_OPEN_BASE) || "https://open-api.flashexpress.com").replace(/\/+$/, ""),
});

export const flashOpenConfigured = () => {
  const c = flashOpenConfig();
  return Boolean(c.mchId && c.key);
};

/** เอกสารเขียนทิศการเรียงไว้ขัดกัน (ข้อความ = น้อยไปมาก · ตัวอย่าง = DESC) — ลองน้อยไปมากก่อน ลายเซ็นผิดค่อยสลับ แล้วจำไว้ */
let sortDesc = false;

/** ลายเซ็น: พารามิเตอร์ที่มีค่า (ไม่นับ sign) เรียงตามชื่อ → k=v&… → &key=<secret> → SHA256 ตัวใหญ่ */
export function flashSign(params: Record<string, string | number | undefined | null>, key: string, desc = sortDesc) {
  const names = Object.keys(params)
    .filter((k) => k !== "sign" && params[k] != null && String(params[k]).trim() !== "")
    .sort();
  if (desc) names.reverse();
  const s = names.map((k) => `${k}=${params[k]}`).join("&");
  return createHash("sha256").update(`${s}&key=${key}`, "utf8").digest("hex").toUpperCase();
}

export class FlashOpenError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message);
  }
}

type Envelope<T> = { code?: number; message?: string; data?: T };

/** POST แบบ form-urlencoded พร้อม mchId / nonceStr / sign */
async function call<T>(path: string, params: Record<string, string | number | undefined> = {}, retried = false): Promise<T> {
  const c = flashOpenConfig();
  if (!c.mchId || !c.key) throw new FlashOpenError("ยังไม่ได้ตั้ง FLASH_OPEN_MCH_ID / FLASH_OPEN_KEY", null);
  const body: Record<string, string> = { mchId: c.mchId, nonceStr: randomBytes(16).toString("hex") };
  for (const [k, v] of Object.entries(params)) if (v != null) body[k] = String(v);
  body.sign = flashSign(body, c.key);

  const res = await fetch(`${c.base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept-Language": "th" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new FlashOpenError(`Flash Open API ตอบ HTTP ${res.status}`, null);
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!json) throw new FlashOpenError("Flash Open API ตอบรูปแบบไม่ถูกต้อง", null);
  // 1002 = ลายเซ็นผิด → ลองเรียงอีกทิศครั้งเดียว
  if (json.code === 1002 && !retried) {
    sortDesc = !sortDesc;
    return call<T>(path, params, true);
  }
  if (json.code !== 1) throw new FlashOpenError(`Flash Open API: ${json.message ?? "ไม่สำเร็จ"} (code ${json.code})`, json.code ?? null);
  return json.data as T;
}

/** เวลาใน API เป็น unix (วินาที UTC) */
const unix = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? null : d;
};
const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);

type RawRoutes = {
  pno?: string;
  state?: number | string;
  stateText?: string;
  returnedPno?: string;
  routes?: { routedAt?: number | string; routeAction?: string; routedAction?: string; message?: string; state?: number | string }[];
};

function toResult(d: RawRoutes, fallbackNo: string): FlashResult {
  const routes: FlashRoute[] = (d.routes ?? [])
    .map((r) => ({
      at: unix(r.routedAt)?.toISOString() ?? null,
      state: r.state != null && Number.isFinite(Number(r.state)) ? Number(r.state) : null,
      text: null,
      message: str(r.message),
      // เอกสารใช้ทั้ง routeAction และ routedAction
      action: str(r.routeAction ?? r.routedAction),
    }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const state = d.state != null && Number.isFinite(Number(d.state)) ? Number(d.state) : null;
  return {
    trackingNo: str(d.pno) ?? fallbackNo,
    found: true,
    state,
    stateText: str(d.stateText),
    lastRoute: routes[0]?.message ?? null,
    routedAt: routes[0]?.at ? new Date(routes[0].at) : null,
    routes,
  };
}

/** เลขต่อ 1 request — pnos ยาวไม่เกิน 500 ตัวอักษร */
function chunkPnos(nos: string[]) {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const n of nos) {
    if (cur.length && len + n.length + 1 > 500) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(n);
    len += n.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * สถานะหลายเลขผ่าน Open API
 * @returns found = เลขที่ API ตอบ · missing = เลขที่ API ไม่ตอบ (ให้ไปถามหน้าเว็บแทน) · errors = ชุดที่พัง
 */
export async function flashOpenRoutes(nos: string[]) {
  const found: FlashResult[] = [];
  const errors: string[] = [];
  const answered = new Set<string>();
  for (const chunk of chunkPnos(nos)) {
    try {
      const data = await call<RawRoutes[] | RawRoutes>("/open/v1/orders/routesBatch", { pnos: chunk.join(",") });
      for (const d of Array.isArray(data) ? data : [data]) {
        if (!d?.pno) continue;
        const r = toResult(d, d.pno);
        found.push(r);
        answered.add(r.trackingNo.toUpperCase());
      }
    } catch (e) {
      errors.push(`${chunk[0]}… ${e instanceof Error ? e.message : String(e)}`);
      // ลายเซ็น/บัญชีผิด = ทุกชุดพังเหมือนกัน ไม่ต้องยิงต่อ
      if (e instanceof FlashOpenError && (e.code === 1002 || e.code === null)) break;
    }
  }
  return { found, missing: nos.filter((n) => !answered.has(n.toUpperCase())), errors };
}

export type FlashPod = {
  signer: string | null;
  signerType: string | null;
  at: string | null;
  photos: string[];
  pod: string | null;
  lat: number | null;
  lng: number | null;
};

/** หลักฐานการส่งถึง (ชื่อผู้เซ็นรับ รูปตอนส่ง ลายเซ็น พิกัด) — มีเฉพาะชิ้นที่เซ็นรับแล้ว */
export async function flashOpenDelivered(pno: string): Promise<FlashPod> {
  const d = await call<{
    signer?: string;
    signerTypeText?: string;
    stateDate?: string | number;
    photo?: { photo1?: string; photo2?: string } | null;
    pod?: string;
    ticketDeliveryStaffLat?: number | string;
    ticketDeliveryStaffLng?: number | string;
  }>(`/open/v1/orders/${encodeURIComponent(pno)}/deliveredInfo`);
  const num = (v: unknown) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  const at = typeof d?.stateDate === "number" || /^\d+$/.test(String(d?.stateDate ?? "")) ? unix(d?.stateDate)?.toISOString() ?? null : str(d?.stateDate);
  return {
    signer: str(d?.signer),
    signerType: str(d?.signerTypeText),
    at,
    photos: [d?.photo?.photo1, d?.photo?.photo2].map(str).filter((x): x is string => Boolean(x)),
    pod: str(d?.pod),
    lat: num(d?.ticketDeliveryStaffLat),
    lng: num(d?.ticketDeliveryStaffLng),
  };
}

/** ตั้ง / ปิด webhook · code 4 = ความเคลื่อนไหว (routes) · 0 = สถานะ */
export async function flashOpenSetWebhook(url: string | null, webhookApiCode = 4) {
  return call<{ url?: string; state?: number; webhookApiCode?: number }>("/open/v1/setting/web_hook_service", {
    serviceCategory: url ? 1 : 0,
    url: url ?? undefined,
    webhookApiCode,
  });
}

/**
 * ตรวจลายเซ็น webhook — เอกสารบอกว่าเซ็นแค่ mchId + nonceStr (แต่หลักทั่วไปบอกเซ็นทุกค่า)
 * รับได้ทั้งสองแบบ และทั้งสองทิศการเรียง
 */
export function verifyFlashWebhook(payload: Record<string, unknown>) {
  const c = flashOpenConfig();
  if (!c.key || !payload.sign) return false;
  if (c.mchId && String(payload.mchId ?? "") !== c.mchId) return false;
  const flat = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v == null ? undefined : typeof v === "object" ? JSON.stringify(v) : String(v)]));
  const candidates = [{ mchId: String(payload.mchId ?? ""), nonceStr: String(payload.nonceStr ?? "") }, flat(payload)];
  const sign = String(payload.sign).toUpperCase();
  return candidates.some((p) => flashSign(p, c.key, false) === sign || flashSign(p, c.key, true) === sign);
}
