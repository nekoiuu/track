/** สถานะ Flash Express — ใช้ได้ทั้ง server และ client (ไม่มี "server-only") */

export type FlashTone = "done" | "move" | "back" | "issue" | "cancel" | "none";

/** รหัสสถานะตาม Flash (เว็บ + Open API ใช้ชุดเดียวกัน) */
export const FLASH_STATE: Record<number, { label: string; tone: FlashTone }> = {
  1: { label: "รับพัสดุแล้ว", tone: "move" },
  2: { label: "ระหว่างขนส่ง", tone: "move" },
  3: { label: "กำลังนำส่ง", tone: "move" },
  4: { label: "พัสดุตกค้าง", tone: "issue" },
  5: { label: "เซ็นรับแล้ว", tone: "done" },
  6: { label: "พัสดุมีปัญหา", tone: "issue" },
  7: { label: "ตีกลับ", tone: "back" },
  8: { label: "ปิดงานผิดปกติ", tone: "issue" },
  9: { label: "ยกเลิก", tone: "cancel" },
};

export const flashTone = (state: number | null | undefined): FlashTone => (state != null ? (FLASH_STATE[state]?.tone ?? "none") : "none");

/** ข้อความที่จะโชว์ — ใช้ข้อความจากเว็บ Flash ก่อน */
export const flashLabel = (p: { flashState?: number | null; flashStateText?: string | null; flashNotFound?: boolean | null }) =>
  p.flashStateText || (p.flashState != null ? FLASH_STATE[p.flashState]?.label : null) || (p.flashNotFound ? "ยังไม่เข้าระบบ Flash" : null);

/** สีป้ายสถานะ — เขียว สำเร็จ · น้ำเงิน ขนส่ง · ส้ม ตีกลับ · แดง มีปัญหา/ยกเลิก */
export const FLASH_PILL: Record<FlashTone, string> = {
  done: "bg-teal-soft text-teal-deep ring-1 ring-inset ring-teal/20",
  move: "bg-link-soft text-brand-deep ring-1 ring-inset ring-brand/15",
  back: "bg-warning-soft text-warning-deep ring-1 ring-inset ring-warning/25",
  issue: "bg-error-soft text-error-deep ring-1 ring-inset ring-error/20",
  cancel: "bg-error-soft text-error-deep ring-1 ring-inset ring-error/20",
  none: "bg-canvas-soft-2 text-body ring-1 ring-inset ring-hairline",
};

/** ขนส่ง Flash (หรือยังไม่รู้ขนส่ง — ลองถามได้ Flash ตอบไม่พบเฉย ๆ) */
export const isFlashParcel = (p: { shippingMethod?: string | null }) => !p.shippingMethod || /flash/i.test(p.shippingMethod);

/** ชื่อกลุ่มสีแบบสั้น (ชิปสรุปจำนวน) */
export const TONE_LABEL: Record<FlashTone, string> = {
  done: "เซ็นรับ",
  move: "กำลังส่ง",
  back: "ตีกลับ",
  issue: "มีปัญหา",
  cancel: "ยกเลิก",
  none: "ยังไม่มีสถานะ",
};
/** ลำดับแสดงชิป — เรื่องที่ต้องตามขึ้นก่อน */
export const TONE_ORDER: FlashTone[] = ["cancel", "issue", "back", "move", "done", "none"];

/**
 * กลุ่มสีของพัสดุ — สถานะร้าน (คนตั้ง) มาก่อน แล้วค่อยดู Flash (ตรงกับสีที่ส่งไป Sheets)
 * ขนส่งอื่นที่ไม่ใช่ Flash (SPX, J&T …) ถาม Flash ไม่ได้ → ใช้สถานะ BigSeller
 */
export function parcelTone(p: {
  status: string;
  flashState: number | null;
  shippingMethod?: string | null;
  bsStatusText?: string | null;
}): FlashTone {
  if (p.status === "CANCELLED_AFTER" || p.flashState === 9) return "cancel";
  if (p.status === "RETURNING" || p.status === "RETURNED") return "back";
  if (p.status === "PROBLEM") return "issue";
  if (p.status === "DELIVERED") return "done";
  const t = flashTone(p.flashState);
  if (t !== "none" || isFlashParcel(p)) return t;
  const bs = p.bsStatusText ?? "";
  if (/ยกเลิก|cancel/i.test(bs)) return "cancel";
  if (/สำเร็จ|เสร็จ|completed|delivered/i.test(bs)) return "done";
  if (/จัดส่งแล้ว|shipped|รอรับสินค้า/i.test(bs)) return "move";
  return "none";
}

/** กลุ่มขนส่ง (ตัวกรองในหน้ารอบรถ) — เพิ่มขนส่งใหม่ที่นี่ที่เดียว */
export type CarrierFamily = "flash" | "spx" | "other";
export const CARRIER_FAMILIES: { key: CarrierFamily; label: string }[] = [
  { key: "flash", label: "Flash" },
  { key: "spx", label: "SPX" },
  { key: "other", label: "อื่น ๆ" },
];
/** Flash (รวม Bulky · ยังไม่รู้ขนส่งนับเป็น Flash เหมือน isFlashParcel) · SPX / Shopee Express · ที่เหลือ = อื่น ๆ */
export function carrierFamily(p: { shippingMethod?: string | null }): CarrierFamily {
  if (isFlashParcel(p)) return "flash";
  if (/spx|shopee/i.test(p.shippingMethod ?? "")) return "spx";
  return "other";
}
