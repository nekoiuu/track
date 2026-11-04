/** ใช้ได้ทั้งฝั่ง server และ client (ไม่มี "server-only") */
import { flashLabel } from "./flash-state";

/** ค่าสำหรับพัสดุที่ไม่รู้ขนส่ง */
export const SHIP_UNKNOWN = "-";
export const shipKey = (m: string | null | undefined) => m || SHIP_UNKNOWN;

/** นับตามขนส่ง — มากไปน้อย (นับฝั่ง server แล้วส่งแค่ผลไป client) */
export function countByShipping(parcels: { shippingMethod: string | null }[]): [string, number][] {
  const n = new Map<string, number>();
  for (const p of parcels) n.set(shipKey(p.shippingMethod), (n.get(shipKey(p.shippingMethod)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
}

/** ค่าที่ค้นได้ของแถวตาราง (ใส่เป็น data-q ให้ TableSearch) — ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง */
export const searchKey = (...parts: (string | null | undefined)[]) =>
  parts
    .filter(Boolean)
    .map((s) => s!.replace(/\s+/g, "").toUpperCase())
    .join(" ");

/** สถานะใน BigSeller ของแถว (ใส่เป็น data-bs) — ยังไม่เคยดึง = SHIP_UNKNOWN */
export const bsKey = (t: string | null | undefined) => t || SHIP_UNKNOWN;

/** นับตามสถานะ BigSeller — มากไปน้อย */
export function countByBigSeller(parcels: { bsStatusText: string | null }[]): [string, number][] {
  const n = new Map<string, number>();
  for (const p of parcels) n.set(bsKey(p.bsStatusText), (n.get(bsKey(p.bsStatusText)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
}

/** สถานะที่ต้องสะดุดตา — ยกเลิก (แดง) / จัดส่งยังไม่สำเร็จ (ส้ม) · อื่น ๆ ไม่ใส่สี */
export type BsTone = "cancel" | "fail" | null;

export function bsTone(p: { bsState?: string | null; bsStatusText?: string | null; status?: string | null; flashState?: number | null }): BsTone {
  const s = `${p.bsState ?? ""} ${p.bsStatusText ?? ""}`.toLowerCase();
  if (p.status === "CANCELLED_AFTER" || /cancel|ยกเลิก/.test(s) || p.flashState === 9) return "cancel";
  // Flash: ตกค้าง / มีปัญหา / ตีกลับ / ปิดงานผิดปกติ
  if (p.flashState != null && [4, 6, 7, 8].includes(p.flashState)) return "fail";
  if (p.flashState != null) return null;
  if (/ไม่สำเร็จ|fail|undeliver|exception/.test(s)) return "fail";
  return null;
}

/** พื้นหลังทั้งแถว */
export const BS_ROW: Record<Exclude<BsTone, null>, string> = {
  cancel: "bg-error-soft/70 hover:bg-error-soft",
  fail: "bg-orange-100/80 hover:bg-orange-100",
};

/** ตัวหนังสือสถานะในช่อง BigSeller */
export const BS_TEXT: Record<Exclude<BsTone, null>, string> = {
  cancel: "font-medium text-error-deep",
  fail: "font-medium text-orange-800",
};

/**
 * จำนวนชิ้นที่รถคันนี้รับจาก manifest ใบนี้
 * ใบเดียวแบ่งหลายคัน → ใช้จำนวนที่ใส่ไว้ (PickupManifest.parcelCount) · ไม่ได้ใส่ = ทั้งใบ
 */
export const takenOf = (pm: { parcelCount?: number | null; manifest?: { _count?: { parcels: number }; parcels?: unknown[] } | null }) =>
  pm.parcelCount ?? pm.manifest?._count?.parcels ?? pm.manifest?.parcels?.length ?? 0;

/** ค่าที่ใช้กรอง/นับตามสถานะ — สถานะ Flash ก่อน ไม่มีก็ใช้ BigSeller */
export const statusKey = (p: { flashState?: number | null; flashStateText?: string | null; flashNotFound?: boolean | null; bsStatusText?: string | null }) =>
  flashLabel(p) || p.bsStatusText || SHIP_UNKNOWN;

/** นับตามสถานะ (Flash ก่อน) — มากไปน้อย */
export function countByStatus(parcels: Parameters<typeof statusKey>[0][]): [string, number][] {
  const n = new Map<string, number>();
  for (const p of parcels) n.set(statusKey(p), (n.get(statusKey(p)) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]);
}
