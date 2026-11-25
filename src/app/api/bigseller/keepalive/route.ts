import { keepAlive } from "@/lib/bigseller-session";

/**
 * ต่ออายุ cookie จาก cron ภายนอก (ใช้เมื่อ deploy แบบ serverless ที่ไม่มี timer ค้างไว้)
 * ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
 *
 * cron เรียกทุก 10 นาทีตลอด 24 ชม. → .github/workflows/bigseller-keepalive.yml
 * (กลางคืนไม่มีคนใช้ ไม่มีอะไรยิง BigSeller เลย 12–19 ชม. → cookie ตายทุกคืน — ตัวนี้กันไว้)
 * ยิงจริงเฉพาะตอนไม่มีอะไรยิงผ่านมาเกิน ~9 นาที · ช่วงมีคนใช้งานจะข้ามเอง ไม่เพิ่มภาระ BigSeller
 */
const CRON_MINUTES = 10;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await keepAlive({ minutes: CRON_MINUTES });
  // ยิงแล้วไม่ผ่าน → 503 ให้ cron เห็นเป็นสีแดง (cookie ตาย LINE แจ้งเองอยู่แล้ว)
  return Response.json(r, { status: "ok" in r && r.ok === false ? 503 : 200 });
}
