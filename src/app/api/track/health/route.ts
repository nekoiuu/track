import { timingSafeEqual } from "node:crypto";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { backgroundStatus } from "@/lib/tracker-status";

/**
 * รอบเบื้องหลัง (track-tick — timer ในเว็บ หรือ cron) ยังทำงานอยู่ไหม
 * ใช้กับระบบเฝ้าดู (UptimeRobot ฯลฯ): ไม่มีอะไรอัปเดตเบื้องหลังเลย → ตอบ 503
 *
 *   GET /api/track/health                         (login อยู่)
 *   GET /api/track/health?key=<CRON_SECRET>       หรือ Authorization: Bearer <CRON_SECRET>
 *
 * ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) — ตรวจกุญแจเอง · ไม่มีข้อมูลพัสดุ มีแค่สถานะของตัวดึง
 */

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if ((bearer && same(bearer, secret)) || (key && same(key, secret))) return true;
  }
  return Boolean(await getUser());
}

export async function GET(req: Request) {
  if (!(await authorized(req))) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [bg, tick] = await Promise.all([
    backgroundStatus(),
    db.syncRun.findFirst({ where: { kind: "track-tick" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, ok: true, message: true } }),
  ]);

  return Response.json(
    {
      ok: bg.active,
      tick: { recent: bg.tick, lastAt: tick?.startedAt ?? null, lastOk: tick?.ok ?? null, last: tick?.message ?? null },
    },
    { status: bg.active ? 200 : 503 },
  );
}
