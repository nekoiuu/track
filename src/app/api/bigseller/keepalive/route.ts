import { keepAlive } from "@/lib/bigseller-session";

/**
 * ต่ออายุ cookie จาก cron ภายนอก (ใช้เมื่อ deploy แบบ serverless ที่ไม่มี timer ค้างไว้)
 * ต้องส่ง header  Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json(await keepAlive());
}
