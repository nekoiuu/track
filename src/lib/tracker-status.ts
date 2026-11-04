import "server-only";
import { db } from "./db";
import { tickMinutes } from "./track-config";

export { tickMinutes };

/**
 * มีอะไรอัปเดตสถานะเบื้องหลังอยู่จริงไหม — ดูจากผลที่เกิดขึ้นจริง ไม่ใช่แค่ค่าที่ตั้งไว้
 * tick = ตัวตั้งเวลาในเว็บ/cron รันสำเร็จภายใน 2 เท่าของรอบ
 * (deploy แบบ serverless ไม่มี cron / host ไม่มี PORT → tick ไม่เคยรัน → false)
 */
export async function backgroundStatus() {
  const minutes = tickMinutes() || 15;
  const tick = await db.syncRun
    .findFirst({
      where: { kind: "track-tick", ok: true, finishedAt: { gte: new Date(Date.now() - 2 * minutes * 60_000) } },
      select: { id: true },
    })
    .then(Boolean);
  return { tick, active: tick };
}
