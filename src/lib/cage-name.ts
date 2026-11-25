/**
 * ชื่อกรง — คนจดตั้งเอง (เช่น เลขบนกรงจริง) · ไม่ได้ตั้ง (label ว่าง) = พาเลท
 * ใช้ได้ทั้งฝั่ง server และหน้าเว็บ
 */
export const PALLET = "พาเลท";

/** ชื่อสั้นสำหรับปุ่ม/ป้าย: "A" · ไม่มีชื่อ = "พาเลท" */
export const cageName = (label: string | null | undefined) => label?.trim() || PALLET;

/** ชื่อกรงที่ระบบตั้งให้เอง — เลท1, เลท2, … นับต่อกันทั้งวัน (เริ่มใหม่ทุกวัน) */
export const AUTO_PREFIX = "เลท";
const isAuto = (l: string) => l.startsWith(AUTO_PREFIX);

/** ชื่อในประโยค: "เลท3" · ชื่อที่ตั้งเอง = "กรง A" · ไม่มีชื่อ = "พาเลท" */
export const cageTitle = (label: string | null | undefined) => {
  const l = label?.trim();
  return !l ? PALLET : isAuto(l) ? l : `กรง ${l}`;
};

/** ป้ายสี่เหลี่ยมเล็ก — เลท3 → "3" (คำว่าเลทอยู่ในชื่อข้างๆ แล้ว) */
export const cageBadge = (label: string) => (isAuto(label) ? label.slice(AUTO_PREFIX.length) : label);

/**
 * ชื่อที่โชว์ในหน้ารอบรถ — พาเลทหลายอันในรอบเดียวกัน → ใส่เลขกำกับ (พาเลท 1, พาเลท 2) จะได้แยกออก
 * @param labels ตามลำดับที่แสดง
 */
export function displayCageNames(labels: string[]) {
  const unnamed = labels.filter((l) => !l.trim()).length;
  let i = 0;
  return labels.map((l) => (l.trim() ? cageTitle(l) : unnamed > 1 ? `${PALLET} ${++i}` : PALLET));
}
