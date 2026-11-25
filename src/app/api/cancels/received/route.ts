import { receiveByQr } from "@/lib/cancel-hunt";

/**
 * บอท LINE (flashReturnCheck) อ่าน QR จากรูปใบปะหน้าในกลุ่มได้เลขแทร็ค → ส่งมาที่นี่
 * เลขตรงกับของยกเลิกในหน้า "ตามของยกเลิก" → ได้รับสินค้ากลับมาแล้ว → src/lib/cancel-hunt.ts (receiveByQr)
 *
 * POST  Authorization: Bearer <CANCEL_QR_KEY หรือ CRON_SECRET>
 *       { "tracks": ["THT…", …], "by": "ชื่อคนส่งรูป (ไม่บังคับ)", "at": "ISO เวลารูป (ไม่บังคับ)" }
 * ตอบ  { matched: [{ trackingNo, packageNo, items }], already: [...], unknown: [...] }
 * ส่งเลขซ้ำได้ — ที่ได้รับแล้วไม่เปลี่ยนอีก · ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) ตรวจกุญแจเอง
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const got = req.headers.get("authorization");
  return [process.env.CANCEL_QR_KEY, process.env.CRON_SECRET].some((k) => k?.trim() && got === `Bearer ${k.trim()}`);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: { tracks?: unknown; by?: unknown; at?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body ต้องเป็น JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.tracks)) return Response.json({ error: "ต้องมี tracks เป็น array" }, { status: 400 });
  const r = await receiveByQr(body.tracks.map(String), {
    by: typeof body.by === "string" ? body.by.slice(0, 80) : null,
    at: typeof body.at === "string" ? new Date(body.at) : null,
  });
  if (r.matched.length) console.log(`[cancel-hunt] QR LINE ได้ของคืน ${r.matched.length}: ${r.matched.map((m) => m.trackingNo).join(", ")}`);
  return Response.json(r);
}
