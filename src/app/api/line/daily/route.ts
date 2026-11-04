import { dailyReportDue, runStatusReport } from "@/lib/status-report";

/**
 * รายงานสถานะพัสดุประจำวัน — ส่งเมื่อถึงเวลา LINE_DAILY_AT (เวลาไทย) วันละครั้ง
 *
 * ใครเรียก:
 *   - instrumentation.ts เรียกเองทุก 5 นาที ตอนรันเซิร์ฟเวอร์ค้างไว้ (ส่งกุญแจภายใน x-internal-key)
 *   - cron ภายนอกตอน deploy แบบ serverless: GET พร้อม Authorization: Bearer <CRON_SECRET>
 * ยังไม่ถึงเวลา / วันนี้ส่งแล้ว → ไม่ทำอะไร · ?force=1 = ส่งเลย (ทดสอบ)
 * ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) — ตรวจกุญแจเอง
 */

const g = globalThis as unknown as { __shippedInternalKey?: string; __shippedDailyRunning?: boolean };

function authorized(req: Request) {
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  const internal = g.__shippedInternalKey;
  return Boolean(internal && req.headers.get("x-internal-key") === internal);
}

export async function GET(req: Request) {
  if (!authorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && !(await dailyReportDue())) return Response.json({ ran: false, reason: "ยังไม่ถึงเวลา หรือวันนี้ส่งแล้ว" });
  // กันรันซ้อน (cron กับตัวตั้งเวลาเรียกพร้อมกัน)
  if (g.__shippedDailyRunning) return Response.json({ ran: false, reason: "กำลังทำรายงานอยู่" });
  g.__shippedDailyRunning = true;
  try {
    const r = await runStatusReport({ trigger: "auto" });
    return Response.json({ ran: true, ...r });
  } finally {
    g.__shippedDailyRunning = false;
  }
}
