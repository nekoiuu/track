import { syncTodayCancels } from "@/lib/cancel-hunt";

/**
 * ดึงออเดอร์ที่ยกเลิกวันนี้จาก BigSeller 1 รอบ → src/lib/cancel-hunt.ts (หน้า /cancel-hunt)
 *
 * ใครเรียก:
 *   - instrumentation.ts เรียกเองทุก CANCEL_HUNT_MINUTES นาที (ค่าเริ่มต้น 5) ตอนรันเซิร์ฟเวอร์ค้างไว้ (x-internal-key)
 *   - cron ภายนอกตอน deploy แบบ serverless: GET พร้อม Authorization: Bearer <CRON_SECRET>
 *     → .github/workflows/cancel-hunt.yml
 * ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) — ตรวจกุญแจเอง · เรียกถี่กว่ารอบ = ข้ามเอง (ล็อกใน DB)
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const g = globalThis as unknown as { __shippedInternalKey?: string };

function authorized(req: Request) {
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  const internal = g.__shippedInternalKey;
  return Boolean(internal && req.headers.get("x-internal-key") === internal);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const r = await syncTodayCancels();
  return Response.json(r, { status: r.ran && !r.ok ? 503 : 200 });
}
