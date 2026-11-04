/**
 * ลิสต์สินค้าจาก BigSeller แล้วเซฟเป็น out/products.json + out/products.csv
 *
 *   node examples/list-products.js                     ทุกสินค้า (วนหน้าจนครบ)
 *   node examples/list-products.js SKU-A SKU-B         เฉพาะ SKU ที่ระบุ
 *   node examples/list-products.js --stock             แนบสต็อก/ต้นทุน/คลัง มาด้วย
 *   node examples/list-products.js --size 100 --pages 50
 *   node examples/list-products.js --raw               ดู row ดิบ 1 ตัว (ไว้หาชื่อ field)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// import แบบนี้เพื่อจับ error ตอนโหลด (เช่นยังไม่ได้ตั้ง cookie) ให้แสดงสวย ๆ
let api;
try {
  api = await import('../api/index.js');
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}

// ------------------------------------------------------------------ อ่าน argv

const argv     = process.argv.slice(2);
const hasFlag  = f => argv.includes(f);
const flagVal  = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : Number(argv[i + 1]); };
const skus     = argv.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));

const withStock = hasFlag('--stock');
const showRaw   = hasFlag('--raw');
const pageSize  = flagVal('--size', 100);
const maxPages  = flagVal('--pages', 20);

// --------------------------------------------------------------------- ยิงจริง

const opt = { pageSize, maxPages, ...(skus.length ? { search: skus } : {}) };

console.log(
  `กำลังดึงสินค้า${skus.length ? ` ${skus.length} SKU` : 'ทั้งหมด'}` +
  `${withStock ? ' + สต็อก' : ''} (หน้าละ ${pageSize}, สูงสุด ${maxPages} หน้า)...\n`
);

let result;
try {
  result = withStock
    ? await api.listProductsWithStock(opt)
    : await api.listProductsAll(opt);
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  if (e.detail) console.error('   detail:', JSON.stringify(e.detail));
  process.exit(1);
}

const rows = result.rows;
console.log(`\nได้ ${rows.length} รายการ (ทั้งหมด ${result.totalSize ?? rows.length})`);

if (!rows.length) {
  console.log('ไม่มีข้อมูล — ถ้ามั่นใจว่ามีสินค้า ให้สนิฟ body จริงตาม README ของ endpoint');
  process.exit(0);
}

// row ดิบ 1 ตัว — ชื่อ field ที่ BigSeller ส่งมาจริงอยู่ตรงนี้
if (showRaw) {
  console.log('\n--- row ดิบตัวแรก ---');
  console.log(JSON.stringify(rows[0], null, 2));
}

// ------------------------------------------------- เลือกเฉพาะ field ที่ใช้บ่อย

const pick = r => ({
  sku:       api.skuOf(r) ?? '',
  name:      r.productName ?? r.name ?? r.itemName ?? '',
  status:    r.status ?? r.statusStr ?? '',
  price:     r.price ?? r.salePrice ?? '',
  cost:      r.costPrice ?? r.cost ?? '',
  qty:       r.quantity ?? r.stockQty ?? r.availableQty ?? '',
  warehouse: r.warehouseName ?? '',
  ...(withStock ? { stockRows: (r.stock ?? []).length } : {}),
});

const table = rows.map(pick);
console.table(table.slice(0, 20));
if (table.length > 20) console.log(`  ... อีก ${table.length - 20} รายการ (ดูครบใน out/products.json)`);

if (withStock && result.unmatchedStock?.length) {
  console.log(`\n⚠ สต็อก ${result.unmatchedStock.length} SKU ไม่มีสินค้าคู่ (join ไม่ติด):`);
  console.log('  ' + result.unmatchedStock.slice(0, 10).join(', '));
}

// ------------------------------------------------------------------- เซฟไฟล์

const ROOT   = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'products.json'),
  JSON.stringify({ totalSize: result.totalSize, truncated: result.truncated, rows }, null, 2)
);

const cols = Object.keys(table[0]);
const csv  = [
  cols.join(','),
  ...table.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')),
].join('\n');

fs.writeFileSync(path.join(outDir, 'products.csv'), '\ufeff' + csv);   // BOM ให้ Excel อ่านไทยออก

console.log('\nเซฟแล้ว → out/products.json, out/products.csv');
