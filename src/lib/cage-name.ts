/**
 * ชื่อกรง — คนจดตั้งเอง (เช่น เลขบนกรงจริง) · ไม่ได้ตั้ง (label ว่าง) = พาเลท
 * ใช้ได้ทั้งฝั่ง server และหน้าเว็บ
 */
export const PALLET = "พาเลท";

/** ชื่อสั้นสำหรับปุ่ม/ป้าย: "A" · ไม่มีชื่อ = "พาเลท" */
export const cageName = (label: string | null | undefined) => label?.trim() || PALLET;

/** ชื่อในประโยค: "กรง A" · ไม่มีชื่อ = "พาเลท" */
export const cageTitle = (label: string | null | undefined) => (label?.trim() ? `กรง ${label.trim()}` : PALLET);

/**
 * ชื่อที่โชว์ในหน้ารอบรถ — พาเลทหลายอันในรอบเดียวกัน → ใส่เลขกำกับ (พาเลท 1, พาเลท 2) จะได้แยกออก
 * @param labels ตามลำดับที่แสดง
 */
export function displayCageNames(labels: string[]) {
  const unnamed = labels.filter((l) => !l.trim()).length;
  let i = 0;
  return labels.map((l) => (l.trim() ? cageTitle(l) : unnamed > 1 ? `${PALLET} ${++i}` : PALLET));
}
