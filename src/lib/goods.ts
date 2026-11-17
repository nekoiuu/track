import "server-only";
import { db } from "./db";

/**
 * สรุปว่าใบนำจ่าย "เป็นของอะไร" — ให้เจ้าหน้าที่เทียบกับของในกรง (จับเอาใบผิดมา)
 * เช่น "ถุงเท้าสีดำล้วน 12 · กาวหมา 200ML 5 · +3 อย่าง" (ตัวเลข = จำนวนกล่อง)
 *
 * รวมใน DB (jsonb) แล้วส่งกลับแค่ยอดต่อสินค้า — ไม่ลากรายการสินค้าทุกกล่องข้ามมาหน้าเว็บ
 * รายการสินค้า (ManifestParcel.items) ได้มาตอนดึงสถานะ BigSeller · ยังไม่มี = ไม่มีสรุป
 */

/** โชว์กี่อย่างก่อน "+N อย่าง" */
const TOP = 2;
/** ตัดชื่อยาวเกินนี้ */
const MAX_NAME = 22;

/**
 * ชื่อ SKU ในคลังสั้นและจำง่ายกว่าชื่อสินค้าบนแพลตฟอร์ม (ที่ยาวเป็นประโยคโฆษณา)
 * ตัดป้ายที่ไม่ช่วยจำ: (12คู่) (5ถุง!) · !!ป้ายแดง!! · * · ขนาด 6x11 นิ้ว (รวมไซส์ต่าง ๆ เป็นของอย่างเดียว) แล้วรวมช่องว่าง
 */
export function shortGoodsName(sku: string) {
  const s = sku
    .replace(/!!.*?!!/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\d+(\.\d+)?\s*[x×]\s*\d+(\.\d+)?\s*(นิ้ว|ซม\.?|cm)?/gi, " ")
    .replace(/[!*]/g, "")
    .replace(/\s+[-–]\s*$/, "")
    .replace(/\s*[-–]\s*(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const name = s || sku.trim();
  return name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name;
}

/** manifestId → ข้อความสรุป (ใบที่ยังไม่มีรายการสินค้า ไม่อยู่ใน Map) */
export async function goodsSummaryByManifest(manifestIds: string[]) {
  const out = new Map<string, string>();
  if (!manifestIds.length) return out;
  // นับกล่องที่มีสินค้านั้น (ไม่ใช่จำนวนชิ้น) — คนดูกล่องในกรง
  const rows = await db.$queryRaw<{ manifestId: string; sku: string; boxes: bigint }[]>`
    SELECT p."manifestId", i->>'sku' AS sku, COUNT(DISTINCT p.id) AS boxes
    FROM "ManifestParcel" p, jsonb_array_elements(p.items) AS i
    WHERE p."manifestId" = ANY(${manifestIds}) AND jsonb_typeof(p.items) = 'array' AND coalesce(i->>'sku', '') <> ''
    GROUP BY 1, 2`;

  // SKU ต่างกันแต่ชื่อย่อเหมือนกัน (เช่น ขนาดแพ็คต่างกัน) → รวมเป็นอย่างเดียว
  const byManifest = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const m = byManifest.get(r.manifestId) ?? new Map<string, number>();
    const name = shortGoodsName(r.sku);
    m.set(name, (m.get(name) ?? 0) + Number(r.boxes));
    byManifest.set(r.manifestId, m);
  }
  for (const [id, m] of byManifest) {
    const sorted = [...m].sort((a, b) => b[1] - a[1]);
    const head = sorted.slice(0, TOP).map(([name, n]) => `${name} ${n}`);
    const rest = sorted.length - TOP;
    out.set(id, rest > 0 ? `${head.join(" · ")} · +${rest} อย่าง` : head.join(" · "));
  }
  return out;
}
