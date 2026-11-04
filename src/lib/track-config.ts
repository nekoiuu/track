/**
 * ค่าตั้งของการอัปเดตสถานะเบื้องหลัง — ไม่ import อะไรเลย ใช้ได้ทั้ง instrumentation.ts และโค้ดฝั่ง server
 */

/** ตั้งเวลาอัปเดตเบื้องหลังทุกกี่นาที (TRACK_TICK_MINUTES · 0 = ปิด · ค่าเริ่มต้น 15) */
export function tickMinutes() {
  const raw = process.env.TRACK_TICK_MINUTES?.trim();
  if (raw === "0") return 0;
  return Number(raw) > 0 ? Number(raw) : 15;
}
