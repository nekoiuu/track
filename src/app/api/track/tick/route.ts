import { runTrackingTick } from "@/lib/track-tick";

/**
 * อัปเดตสถานะพัสดุเบื้องหลัง 1 รอบ (Flash · BigSeller/SPX) → src/lib/track-tick.ts
 *
 * ใครเรียก:
 *   - instrumentation.ts เรียกเองทุก TRACK_TICK_MINUTES นาที ตอนรันเซิร์ฟเวอร์ค้างไว้ (ส่งกุญแจภายใน x-internal-key)
 *   - cron ภายนอกตอน deploy แบบ serverless: GET พร้อม Authorization: Bearer <CRON_SECRET>
 * ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) — ตรวจกุญแจเอง
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const g = globalThis as unknown as { __shippedInternalKey?: string };

function authorized(req: Request) {
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  const internal = g.__shippedInternalKey;
  return Boolean(internal && req.headers.get("x-internal-key") === internal);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await runTrackingTick());
}
