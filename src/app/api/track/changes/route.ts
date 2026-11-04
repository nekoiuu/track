import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * มีพัสดุเปลี่ยนสถานะหลังเวลานี้ไหม — หน้าเว็บถามทุก ~60 วินาที แล้ว refresh เฉพาะตอนมีของใหม่
 * เบามาก (นับแถวใน ParcelEvent ตาม index createdAt) ไม่ยิงถามขนส่ง
 *
 *   GET /api/track/changes?since=<ISO>
 *   → { count, latest }   latest = เวลา event ล่าสุด (ใช้เป็น since รอบหน้า)
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await getUser())) return Response.json({ error: "unauthorized" }, { status: 401 });
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : new Date(Date.now() - 60_000);
  const where = { createdAt: { gt: since } };
  const [count, last] = await Promise.all([
    db.parcelEvent.count({ where }),
    db.parcelEvent.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return Response.json({ count, latest: (last?.createdAt ?? since).toISOString() });
}
