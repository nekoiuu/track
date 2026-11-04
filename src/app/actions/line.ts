"use server";

import { ADMIN_ONLY, audit, isAdmin, requireUser } from "@/lib/auth";
import { dayRange, fmtDateTime, todayKey } from "@/lib/format";
import { lineConfigured, lineHint, pushText } from "@/lib/line";
import { dailyReportText, pickupReportText } from "@/lib/line-messages";
import { refreshPickupStatuses, runStatusReport } from "@/lib/status-report";
import { requirePickupAccess } from "@/lib/pickup-access";
import type { SyncState } from "./manifests";

const NOT_SET = "ยังไม่ได้ตั้งค่า LINE — แอดมินตั้งได้ที่หน้าแจ้งเตือน LINE";

/** ส่งแล้วสรุปผลเป็นข้อความบนหน้าเว็บ */
async function send(text: string) {
  const r = await pushText(text);
  if (r.ok && !r.error) return { ok: true, message: r.sent ? "ส่งเข้า LINE แล้ว" : "ส่งแล้ว (โหมดทดลอง — ดูใน log)" };
  return { ok: false, message: r.error ? lineHint(r.error) : "ส่ง LINE ไม่สำเร็จ" };
}

/** ปุ่ม "ส่งเข้า LINE" ในหน้ารอบรถ — กดเมื่อไหร่ส่งเมื่อนั้น (ไม่ขึ้นกับ LINE_NOTIFY) */
export async function sendPickupReport(pickupId: string): Promise<SyncState> {
  const user = await requirePickupAccess(pickupId);
  if (!lineConfigured()) return { ok: false, message: NOT_SET };
  const note = await refreshPickupStatuses(pickupId).catch(() => "ดึงสถานะไม่สำเร็จ — ใช้สถานะล่าสุดที่เคยดึง");
  const text = await pickupReportText(pickupId, { statusNote: note });
  if (!text) return { ok: false, message: "ไม่พบรอบรถนี้" };
  const res = await send(text);
  audit(user, "line.pickup", "pickup", pickupId, res.ok ? "ส่งรายงานรอบรถเข้า LINE" : res.message);
  return res;
}

/** ปุ่ม "ส่งสรุปวันนี้เข้า LINE" ในหน้าภาพรวม */
export async function sendDailyReport(): Promise<SyncState> {
  const user = await requireUser();
  if (!lineConfigured()) return { ok: false, message: NOT_SET };
  const res = await send(await dailyReportText(dayRange(todayKey())));
  audit(user, "line.daily", "line", null, res.ok ? "ส่งสรุปวันนี้เข้า LINE" : res.message);
  return res;
}

/** ปุ่ม "ส่งข้อความทดสอบ" ในหน้า LINE — แอดมินเท่านั้น */
export async function sendLineTest(): Promise<SyncState> {
  const user = await requireUser();
  if (!(await isAdmin(user))) return { ok: false, message: ADMIN_ONLY };
  if (!lineConfigured()) return { ok: false, message: "ยังตั้งค่าไม่ครบ — ใส่ LINE_CHANNEL_ACCESS_TOKEN และ LINE_TO ใน .env" };

  const r = await pushText(`✅ ทดสอบการแจ้งเตือนจาก TrackFlow\nส่งโดย ${user.name} · ${fmtDateTime(new Date())}`);
  audit(user, "line.test", "line", null, r.ok ? `ส่ง ${r.sent} ที่` : r.error);
  if (r.ok && !r.error) return { ok: true, message: `ส่งแล้ว ${r.sent} ที่ — ดูใน LINE ได้เลย` };
  return { ok: false, message: r.error ? lineHint(r.error) : "ส่งไม่สำเร็จ" };
}

/**
 * ปุ่ม "รายงานสถานะพัสดุ" — ทำรายงานแบบเดียวกับที่ส่งอัตโนมัติทุกวัน ทันที
 * (ดึงสถานะจาก BigSeller → การ์ดสีเข้า LINE → อัปเดตช่องสถานะใน Sheets)
 */
export async function runStatusReportNow(): Promise<SyncState> {
  const user = await requireUser();
  if (!lineConfigured()) return { ok: false, message: NOT_SET };
  const r = await runStatusReport({ trigger: "manual", by: user.name });
  audit(user, "line.status", "line", null, r.message.slice(0, 300));
  return { ok: r.ok, message: r.message };
}

/**
 * ปุ่ม "ทดสอบรายงาน" — ส่งการ์ดเข้า LINE ให้ดูหน้าตา (หัวการ์ด 🧪 ทดสอบ)
 * ไม่เขียน Google Sheets (แค่นับว่าจะอัปเดตกี่แถว) และไม่เลิกติดตามชิ้นที่สำเร็จ/ยกเลิก — กดซ้ำได้ ไม่กระทบรายงานจริง
 */
export async function runStatusReportTest(): Promise<SyncState> {
  const user = await requireUser();
  if (!lineConfigured()) return { ok: false, message: NOT_SET };
  const r = await runStatusReport({ trigger: "test", by: user.name });
  audit(user, "line.status.test", "line", null, r.message.slice(0, 300));
  return { ok: r.ok, message: `ทดสอบ: ${r.message}` };
}
