/**
 * หัวตารางของแท็บรายวันใน Google Sheets (ตามแบบฟอร์มของร้าน)
 * ใช้ทั้งฝั่ง server (เขียนหัวแท็บ) และหน้าเว็บ (โชว์ในกล่องยืนยันก่อนส่ง) — ไม่มี "server-only"
 * แก้ลำดับ/ชื่อที่นี่ แล้วแก้ row ใน src/app/actions/sheets.ts ให้ตรงกัน
 */
export const SHEET_COLUMNS = [
  "วัน",
  "สถานะ",
  "Update",
  "Manifest", // เลขใบนำจ่าย (เดิมชื่อ "เลขตระก้า" ใส่เลขออเดอร์ — แท็บเก่าเปลี่ยนชื่อหัวให้เอง: RENAMED_COLUMNS ใน src/lib/sheets.ts)
  "เวลาการสร้าง",
  // (เดิมมี "สินค้าลงกรง (จาก พนักงานบ้านไท)…" ตรงนี้ — เลิกใช้ แท็บเก่าจะถูกลบคอลัมน์นี้ให้เอง: RETIRED_COLUMNS ใน src/lib/sheets.ts)
  "หมายเลข tracking",
  "สินค้า",
  "เลข รถ รับ งาน",
  "/เวลา",
  "ชื่อ",
  "ตอนขึ้น/ปิด รถ",
  "ตอนขึ้น/ปิด รถ",
  // เพิ่มต่อท้าย — แท็บเก่าคอลัมน์ไม่เลื่อน (หัวแถว 1 อัปเดตให้เองตอนส่ง)
  "ผู้สแกน (BigSeller)",
  "เวลาสแกน",
  "ความเคลื่อนไหวล่าสุด (Flash)",
  "ลิงก์ติดตาม",
  "Stock-In (BigSeller)", // ของคืนที่ Stock-In ใน BigSeller: เวลา + คนกด (แบบเดียวกับผู้สแกน)
];

/** หัวตารางแท็บ "ติดตาม" (ส่งออกทีละเคสจากหน้าติดตามสถานะ) — แท็บนี้เขียนทับทั้งแท็บทุกครั้ง */
export const CASE_COLUMNS = [
  "เลขพัสดุ",
  "เลขออเดอร์",
  "สินค้า",
  "สถานะร้าน",
  "สถานะ Flash",
  "ความเคลื่อนไหวล่าสุด",
  "ล่าสุดเมื่อ",
  "ไม่ขยับ (วัน)",
  "รถที่รับ",
  "รถออก",
  "ใบนำจ่าย",
  "ผู้สแกน (BigSeller)",
  "เวลาสแกน",
  "หมายเหตุ",
  "ลิงก์ติดตาม",
];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** ชื่อแท็บรายวัน (เวลาไทย): 8 ต.ค. 2026 → "8OCT26" — ตามวันที่รถเข้ารับ (วันที่ทำงาน) */
export function dailyTabName(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", day: "numeric", month: "numeric", year: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${Number(p.day)}${MONTHS[Number(p.month) - 1]}${p.year}`;
}
