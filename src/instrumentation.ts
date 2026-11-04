/**
 * ตั้งเวลาต่ออายุ cookie BigSeller ทุก BIGSELLER_KEEPALIVE_MINUTES นาที (ค่าเริ่มต้น 15, ใส่ 0 = ปิด)
 * ทำงานเมื่อรันเป็นเซิร์ฟเวอร์ค้างไว้ (npm run dev / npm start)
 * ถ้า deploy แบบ serverless (เช่น Vercel) ให้ตั้ง cron เรียก /api/bigseller/keepalive แทน
 */
import { tickMinutes } from "./lib/track-config";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const g = globalThis as unknown as { __bigsellerKeepAlive?: boolean };
  if (g.__bigsellerKeepAlive) return; // dev hot-reload เรียกซ้ำได้
  g.__bigsellerKeepAlive = true;

  startDailyReportTimer();
  startTrackingTickTimer();

  const { keepAlive, KEEPALIVE_MINUTES } = await import("./lib/bigseller-session");
  if (!KEEPALIVE_MINUTES) return;

  const tick = async () => {
    try {
      const r = await keepAlive();
      if (r.ran) console.log(`[bigseller] keep-alive: ${r.ok ? "ok" : `ไม่ผ่าน (${r.errorKind})`}`);
    } catch (e) {
      console.warn("[bigseller] keep-alive พัง:", (e as Error).message);
    }
  };

  setTimeout(tick, 30_000).unref();
  setInterval(tick, KEEPALIVE_MINUTES * 60_000).unref();
}

/**
 * อัปเดตสถานะพัสดุเบื้องหลังทุก TRACK_TICK_MINUTES นาที (ค่าเริ่มต้น 15, ใส่ 0 = ปิด)
 * ยิงไปที่ /api/track/tick ของตัวเองด้วยกุญแจภายในเดียวกับรายงานประจำวัน → src/lib/track-tick.ts
 * หน้า "ติดตามสถานะ" จึงอ่านจากฐานข้อมูลได้เลย ไม่ต้องรอยิงถาม Flash ตอนเปิดหน้า
 */
function startTrackingTickTimer() {
  const minutes = tickMinutes();
  if (!minutes) return;
  let warnedNoPort = false;
  const g = globalThis as unknown as { __shippedInternalKey?: string };
  g.__shippedInternalKey ??= crypto.randomUUID();

  const tick = async () => {
    const port = process.env.PORT;
    if (!port) {
      // ไม่รู้พอร์ตของตัวเอง = เรียกตัวเองไม่ได้ — บอกครั้งเดียว (หน้าติดตามจะรู้เองว่าไม่มีอัปเดตเบื้องหลัง → เช็คตอนเปิดหน้าแทน)
      if (!warnedNoPort) console.warn("[track] ไม่รู้ PORT ของเซิร์ฟเวอร์ — อัปเดตเบื้องหลังในเว็บไม่ทำงาน (ใช้ cron เรียก /api/track/tick แทน)");
      warnedNoPort = true;
      return;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/track/tick`, { headers: { "x-internal-key": g.__shippedInternalKey! } });
      const r = (await res.json()) as { ran?: boolean; ok?: boolean; message?: string };
      if (r.ran) console.log(`[track] อัปเดตสถานะเบื้องหลัง: ${r.ok ? "ok" : "ไม่ครบ"} — ${(r.message ?? "").split("\n").join(" | ")}`);
    } catch (e) {
      console.warn("[track] เรียกอัปเดตสถานะเบื้องหลังไม่สำเร็จ:", (e as Error).message);
    }
  };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, minutes * 60_000).unref();
}

/**
 * รายงานสถานะพัสดุประจำวัน (LINE + Sheets) — เช็คทุก 5 นาทีว่าถึงเวลา LINE_DAILY_AT หรือยัง
 * โค้ดรายงานใช้โมดูล server-only ที่โหลดในนี้ไม่ได้ เลยยิงไปที่ /api/line/daily ของตัวเอง
 * พร้อมกุญแจภายในที่สุ่มใหม่ทุกครั้งที่เปิดเซิร์ฟเวอร์ (ไม่ต้องตั้ง CRON_SECRET)
 */
function startDailyReportTimer() {
  const g = globalThis as unknown as { __shippedInternalKey?: string };
  g.__shippedInternalKey ??= crypto.randomUUID();

  const tick = async () => {
    const port = process.env.PORT; // Next ใส่ให้หลังเปิดพอร์ตแล้ว
    if (!port) return;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/line/daily`, { headers: { "x-internal-key": g.__shippedInternalKey! } });
      const r = (await res.json()) as { ran?: boolean; ok?: boolean; message?: string };
      if (r.ran) console.log(`[report] รายงานประจำวัน: ${r.ok ? "ส่งแล้ว" : "ไม่สำเร็จ"} — ${r.message}`);
    } catch (e) {
      console.warn("[report] เรียกรายงานประจำวันไม่สำเร็จ:", (e as Error).message);
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 5 * 60_000).unref();
}
