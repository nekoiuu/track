import { getUser } from "@/lib/auth";
import { checkBigSellerReturns } from "@/lib/bigseller";

/**
 * ของตีกลับถึงคลังแล้วหรือยัง — ดูจากหน้า "การคืนสินค้า Stock-In" ของ BigSeller (อ่านอย่างเดียว)
 *
 *   GET  /api/bigseller/return-status?tracking=THT66015GN6U78Z,TH260811652882T
 *   POST /api/bigseller/return-status   { "trackingNos": ["THT66015GN6U78Z"] }
 *
 * ต้อง login · ครั้งละไม่เกิน 200 เลข
 * ตอบ { ok, message, results: { [เลขแทร็ค]: { returnStatus, inWarehouseStatus, returned, ... } | null } }
 */

export const dynamic = "force-dynamic";

async function respond(trackingNos: string[]) {
  if (!(await getUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!trackingNos.some((t) => t.trim())) return Response.json({ error: "ใส่เลขแทร็คใน tracking หรือ trackingNos" }, { status: 400 });
  const r = await checkBigSellerReturns(trackingNos);
  // BigSeller ใช้ไม่ได้ (cookie ตาย / ยิงไม่ผ่าน) → 502
  return Response.json(r, { status: r.ok ? 200 : 502 });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.getAll("tracking").flatMap((v) => v.split(/[\s,]+/));
  return respond(q);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { trackingNos?: unknown } | null;
  const list = Array.isArray(body?.trackingNos) ? body.trackingNos.map(String) : [];
  return respond(list);
}
