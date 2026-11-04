/**
 * หา SKU จาก row — ใช้เชื่อม "ข้อมูลสินค้า" กับ "สต็อก" เข้าด้วยกัน
 *
 * สอง endpoint ตั้งชื่อ field ไม่ตรงกัน (merchantSku / skuCode / sku / mSku)
 * และยังไม่ได้ยืนยันกับ response จริง — ไล่ลองตามลำดับแทนที่จะฟันธงตัวเดียว
 * เจอชื่อจริงแล้วค่อยมาตัดลิสต์นี้ให้สั้นลงได้
 */

/** ลำดับที่ไล่หา — ซ้ายสุดคือที่น่าจะใช่ที่สุด */
export const SKU_FIELDS = ['sku', 'skuCode', 'merchantSku', 'mSku', 'skuName', 'productSku'];

/**
 * @param {object} row
 * @param {string} [key] บังคับใช้ field นี้ตัวเดียว (รู้ชื่อจริงแล้วส่งมาได้)
 * @returns {string|null}
 */
export function skuOf(row, key) {
  if (!row) return null;

  if (key) {
    const v = row[key];
    return v == null || v === '' ? null : String(v);
  }

  for (const f of SKU_FIELDS) {
    const v = row[f];
    if (v != null && v !== '') return String(v);
  }
  return null;
}
