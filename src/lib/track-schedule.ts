/**
 * นัดเช็ค Flash รอบหน้า (ManifestParcel.nextCheckAt) — สูตรเดียวทุกช่องทาง
 * (รอบเบื้องหลังในเว็บ · ปุ่มในหน้าเว็บ) ชิ้นที่เพิ่งเช็คจากทางไหน ทางอื่นจะไม่วนมาเช็คซ้ำก่อนถึงคิว
 * ไม่ import อะไร — ใช้จากที่ไหนก็ได้โดยไม่วน import กัน
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** TRACKER_INTERVAL_SCALE — คูณระยะห่างทุกสถานะ (2 = ห่างลงครึ่งหนึ่ง · 0.5 = ถี่ขึ้นเท่าตัว) */
export const intervalScale = () => (Number(process.env.TRACKER_INTERVAL_SCALE) > 0 ? Number(process.env.TRACKER_INTERVAL_SCALE) : 1);

/**
 * เช็คชิ้นนี้อีกทีเมื่อไหร่ — ตามสถานะ Flash ล่าสุด
 * กำลังนำส่ง ขยับเร็วและสำคัญ → ถี่ · ระหว่างขนส่งปกติ → ห่าง · ค้าง/มีปัญหา ไม่ค่อยขยับ → ห่างมาก
 */
export function delayFor(state: number | null, departedAt: Date | null, scale = intervalScale()) {
  let ms: number;
  if (state === 3) ms = 45 * MIN;
  else if (state === 1 || state === 2) ms = 2 * HOUR;
  else if (state === 4 || state === 6 || state === 8) ms = 3 * HOUR;
  else if (state == null) ms = departedAt && Date.now() - departedAt.getTime() < DAY ? 1 * HOUR : 3 * HOUR; // ยังไม่เข้า Flash
  else ms = 6 * HOUR;
  // ±15% กระจายคิวไม่ให้ถึงพร้อมกันเป็นก้อน
  return Math.round(ms * scale * (0.85 + Math.random() * 0.3));
}

/** วันที่ของรอบหน้า (ปัดเป็นนาที) */
export const nextCheckFor = (state: number | null, departedAt: Date | null = null) => new Date(Math.round((Date.now() + delayFor(state, departedAt)) / MIN) * MIN);

/** จองชิ้นไว้ระหว่างกำลังถาม — ช่องทางอื่นไม่หยิบซ้ำ (ถามเสร็จค่อยตั้งคิวจริงทับ) */
export const LEASE_MS = 10 * MIN;
