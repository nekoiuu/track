import "server-only";
import products from "../../productData/products.json";

/**
 * น้ำหนักสินค้า (กรัม) จาก productData/products.json — ส่งออกจากคลัง BigSeller
 * จับคู่ด้วยชื่อ SKU ของคลัง (inventorySku ในออเดอร์) · อัปเดตไฟล์แล้วรีสตาร์ทเซิร์ฟเวอร์
 */
type Product = { skuId: number; sku: string; name: string; weight: number };

/** ชื่อ SKU เทียบกันได้: ตัดช่องว่างหัวท้าย รวมช่องว่างซ้ำ ไม่สนตัวพิมพ์ */
export const skuKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const bySku = new Map((products as Product[]).map((p) => [skuKey(p.sku), p]));

export const productBySku = (sku: string | null | undefined) => (sku ? bySku.get(skuKey(sku)) : undefined);

/** สินค้าในกล่อง — เก็บใน ManifestParcel.items ตอนดึงจาก BigSeller */
export type ParcelItem = { sku: string; name?: string; qty: number };

/**
 * น้ำหนักรวมของกล่อง = Σ จำนวน × น้ำหนักต่อชิ้น
 * unknown = SKU ที่ไม่มีใน products.json (ไม่ได้นับน้ำหนัก)
 */
export function parcelWeight(items: ParcelItem[] | null | undefined) {
  if (!items) return null;
  let grams = 0;
  const unknown: string[] = [];
  for (const i of items) {
    const p = productBySku(i.sku);
    if (p) grams += p.weight * i.qty;
    else unknown.push(i.sku);
  }
  return { grams, unknown };
}

/** รวมหลายกล่อง — กล่องที่ยังไม่มีรายการสินค้านับแยกไว้ */
export function totalWeight(parcels: { items: unknown }[]) {
  let grams = 0;
  let missing = 0;
  const unknown = new Set<string>();
  for (const p of parcels) {
    const w = parcelWeight(p.items as ParcelItem[] | null);
    if (!w) {
      missing++;
      continue;
    }
    grams += w.grams;
    w.unknown.forEach((s) => unknown.add(s));
  }
  return { grams, missing, unknown: [...unknown] };
}
