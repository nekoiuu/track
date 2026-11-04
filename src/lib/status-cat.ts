/**
 * กลุ่มสถานะพัสดุตามสถานะ BigSeller + สีของแต่ละกลุ่ม
 * ไม่ import อะไรเลย — ใช้ได้ทั้งรายงานประจำวัน สรุปปิดงาน และหน้าเว็บ (กัน import วนกัน)
 */
import type { Rgb } from "./sheets"; // type อย่างเดียว — ไม่ได้โหลดโค้ด sheets จริง

export type StatusCat = "waiting" | "shipped" | "done" | "cancel" | "problem" | "other";

/** สีของแต่ละกลุ่ม — การ์ด LINE (hex) และพื้นช่องใน Sheets (0–1) */
export const STATUS_CAT: Record<StatusCat, { label: string; emoji: string; color: string; soft: string; sheet: Rgb }> = {
  waiting: { label: "รอรับสินค้า", emoji: "🟡", color: "#AB570A", soft: "#FFEFCF", sheet: { red: 1, green: 0.94, blue: 0.81 } },
  shipped: { label: "จัดส่งแล้ว", emoji: "🔵", color: "#0761D1", soft: "#D3E5FF", sheet: { red: 0.83, green: 0.9, blue: 1 } },
  done: { label: "สำเร็จ", emoji: "🟢", color: "#0F7A62", soft: "#D6F7EF", sheet: { red: 0.84, green: 0.97, blue: 0.94 } },
  cancel: { label: "ยกเลิก", emoji: "🔴", color: "#C50000", soft: "#F7D4D6", sheet: { red: 0.97, green: 0.83, blue: 0.84 } },
  problem: { label: "ไม่สำเร็จ/ตีกลับ", emoji: "🟠", color: "#C2410C", soft: "#FFE4D5", sheet: { red: 1, green: 0.89, blue: 0.84 } },
  other: { label: "อื่น ๆ", emoji: "⚪", color: "#4D4D4D", soft: "#F5F5F5", sheet: { red: 0.96, green: 0.96, blue: 0.96 } },
};

/**
 * สถานะ → กลุ่ม
 * 1) ยกเลิกหลังขึ้นรถ / BigSeller ขึ้นยกเลิก (Flash ไม่รู้เรื่องยกเลิกฝั่งแพลตฟอร์ม)
 * 2) สถานะจากเว็บ Flash (ถ้าเคยเช็คแล้ว) — ใช้แทน BigSeller
 * 3) ไม่มีสถานะ Flash → สถานะ BigSeller · เช็ค "ไม่สำเร็จ" ก่อน "สำเร็จ" (คำว่าสำเร็จซ้อนอยู่ข้างใน)
 */
export function statusCat(p: { bsState?: string | null; bsStatusText?: string | null; status?: string | null; flashState?: number | null }): StatusCat {
  const s = `${p.bsState ?? ""} ${p.bsStatusText ?? ""}`.toLowerCase();
  if (p.status === "CANCELLED_AFTER" || /cancel|ยกเลิก/.test(s)) return "cancel";
  switch (p.flashState) {
    case 1:
    case 2:
    case 3:
      return "shipped";
    case 5:
      return "done";
    case 4:
    case 6:
    case 7:
    case 8:
      return "problem";
    case 9:
      return "cancel";
  }
  if (/ไม่สำเร็จ|fail|undeliver|exception|return|refund|คืน/.test(s)) return "problem";
  if (/complet|finish|delivered|เสร็จสิ้น|สำเร็จ/.test(s)) return "done";
  if (/shipped|shipping|transit|จัดส่งแล้ว|กำลังจัดส่ง/.test(s)) return "shipped";
  if (/pickup|รอรับ|ready|to_ship|รอจัดส่ง|processing|กำลังดำเนินการ/.test(s)) return "waiting";
  return "other";
}
