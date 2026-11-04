import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { refreshFlashStatuses, trackFlash } from "@/lib/flash";

/**
 * API เช็คสถานะพัสดุกับเว็บ Flash Express
 *
 * สิทธิ์: login อยู่ (cookie) หรือส่ง  Authorization: Bearer <FLASH_API_KEY | CRON_SECRET>
 * (ยกเว้นไว้ใน src/proxy.ts — ตรวจสิทธิ์เองที่นี่)
 *
 * ── ถามสด ไม่บันทึก ─────────────────────────────────────────────
 *   GET  /api/flash/track?no=TH47015KQ9X21A,TH47015KQ9X3B2
 *   → { ok, results: [{ trackingNo, found, state, stateText, lastRoute, routedAt, routes }] }
 *
 * ── ถามแล้วบันทึกลงพัสดุในระบบ ───────────────────────────────────
 *   POST /api/flash/track
 *   { "pickupId": "..." }                 ทุกชิ้นของรอบรถนี้
 *   { "manifestIds": ["..."] }            ทุกชิ้นในใบนำจ่าย
 *   { "parcelIds": ["..."] }              ระบุชิ้น
 *   { "trackingNos": ["TH..."] }          ระบุเลข (ต้องมีในระบบ — ไม่มีจะได้ผลสดกลับไปแต่ไม่บันทึก)
 *   { "pending": true, "days": 14 }       ทุกชิ้นที่ยังไม่จบ ส่งออกภายใน N วัน (ไว้ให้ cron เรียก)
 *   + "force": true  = ถามซ้ำแม้เพิ่งถาม / Flash บอกจบแล้ว
 *   → { ok, count, changed, notFound, message, parcels: [{ trackingNo, flashState, flashStateText, ... }] }
 */

export const dynamic = "force-dynamic";
const MAX_LIVE = 100;

async function authorized(req: Request) {
  const auth = req.headers.get("authorization");
  for (const key of [process.env.FLASH_API_KEY, process.env.CRON_SECRET]) {
    if (key?.trim() && auth === `Bearer ${key.trim()}`) return true;
  }
  return Boolean(await getUser());
}

const splitNos = (raw: unknown) =>
  (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\s,]+/))
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

export async function GET(req: Request) {
  if (!(await authorized(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const nos = splitNos(new URL(req.url).searchParams.get("no"));
  if (!nos.length) return Response.json({ error: "ใส่เลขแทร็ค ?no=TH...,TH..." }, { status: 400 });
  if (nos.length > MAX_LIVE) return Response.json({ error: `ไม่เกิน ${MAX_LIVE} เลขต่อครั้ง` }, { status: 400 });
  const r = await trackFlash(nos);
  return Response.json({ ok: r.ok, results: r.results, errors: r.errors }, { status: r.results.length ? 200 : 502 });
}

export async function POST(req: Request) {
  if (!(await authorized(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    pickupId?: string;
    manifestIds?: string[];
    parcelIds?: string[];
    trackingNos?: string[] | string;
    pending?: boolean;
    days?: number;
    force?: boolean;
  };

  const trackingNos = splitNos(body.trackingNos);
  let parcelIds = Array.isArray(body.parcelIds) ? body.parcelIds.map(String) : [];

  // ทุกชิ้นที่ยังไม่จบ — สำหรับ cron
  if (body.pending) {
    const days = Number(body.days) > 0 ? Number(body.days) : 14;
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await db.manifestParcel.findMany({
      where: {
        createdAt: { gte: since },
        status: { notIn: ["CANCELLED_AFTER", "RETURNED", "DELIVERED"] },
        OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }],
      },
      select: { id: true },
      take: 2000,
    });
    parcelIds = [...parcelIds, ...rows.map((r) => r.id)];
  }

  const scope = {
    pickupId: body.pickupId ? String(body.pickupId) : undefined,
    manifestIds: Array.isArray(body.manifestIds) ? body.manifestIds.map(String) : undefined,
    parcelIds: parcelIds.length ? parcelIds : undefined,
    trackingNos: trackingNos.length ? trackingNos : undefined,
  };
  if (!scope.pickupId && !scope.manifestIds?.length && !scope.parcelIds && !scope.trackingNos) {
    return Response.json({ error: "ระบุ pickupId / manifestIds / parcelIds / trackingNos หรือ pending: true" }, { status: 400 });
  }

  const r = await refreshFlashStatuses(scope, { force: Boolean(body.force) });

  // เลขที่ไม่มีในระบบ → ถามสดให้ (ไม่บันทึก)
  let live: Awaited<ReturnType<typeof trackFlash>>["results"] = [];
  if (trackingNos.length) {
    const known = new Set((await db.manifestParcel.findMany({ where: { trackingNo: { in: trackingNos } }, select: { trackingNo: true } })).map((p) => p.trackingNo.toUpperCase()));
    const unknown = trackingNos.filter((n) => !known.has(n)).slice(0, MAX_LIVE);
    if (unknown.length) live = (await trackFlash(unknown)).results;
  }

  const parcels = await db.manifestParcel.findMany({
    where: {
      OR: [
        ...(scope.parcelIds ? [{ id: { in: scope.parcelIds } }] : []),
        ...(scope.manifestIds?.length ? [{ manifestId: { in: scope.manifestIds } }] : []),
        ...(scope.trackingNos ? [{ trackingNo: { in: scope.trackingNos } }] : []),
        ...(scope.pickupId ? [{ manifest: { pickups: { some: { pickupId: scope.pickupId } } } }] : []),
      ],
    },
    orderBy: { trackingNo: "asc" },
    take: 2000,
    select: {
      id: true,
      trackingNo: true,
      orderNo: true,
      status: true,
      flashState: true,
      flashStateText: true,
      flashLastRoute: true,
      flashRoutedAt: true,
      flashFetchedAt: true,
      flashNotFound: true,
    },
  });

  return Response.json({ ...r, parcels, live });
}
