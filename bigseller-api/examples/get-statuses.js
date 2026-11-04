/**
 * ดึงสถานะออเดอร์ทั้งหมดจากไฟล์ data/order-numbers.json
 * แล้วเซฟผลเป็น out/statuses.json + แยกตัวที่สถานะ "ยกเลิก" ออกมา
 *
 *   npm i axios dotenv
 *   node examples/get-statuses.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// import แบบนี้เพื่อจับ error ตอนโหลด (เช่นยังไม่ได้ตั้ง cookie) ให้แสดงสวย ๆ
let searchOrdersBatch;
try {
  ({ searchOrdersBatch } = await import('../api/index.js'));
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const orderNos = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data/order-numbers.json'), 'utf8')
);

console.log(`กำลังค้น ${orderNos.length} เลขออเดอร์...\n`);

let rows, missing;
try {
  ({ rows, missing } = await searchOrdersBatch(orderNos));
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}

// ---- ปรับให้เหลือเฉพาะ field ที่ใช้ ----
const result = rows.map(o => ({
  orderNo:         o.orderNo,
  platformOrderNo: o.platformOrderNo,
  platform:        o.platform,
  shopName:        o.shopName,
  status:          o.status,
  statusStr:       o.statusStr,
  platformStatus:  o.platformStatus,
  trackingNo:      o.trackingNo,
  orderTime:       o.orderTime,
  totalAmount:     o.totalAmount,
}));

console.log(`\nเจอ ${result.length} / ${orderNos.length}`);
console.table(result);

if (missing.length) {
  console.log(`\nไม่เจอ ${missing.length} เลข:`);
  console.log(missing.join('\n'));
}

// ---- แยกตัวที่ยกเลิก ----
const isCancelled = o =>
  /cancel|ยกเลิก/i.test(`${o.statusStr ?? ''} ${o.platformStatus ?? ''} ${o.status ?? ''}`);

const cancelled = result.filter(isCancelled);
console.log(`\nสถานะยกเลิก: ${cancelled.length} รายการ`);
console.table(cancelled);

// ---- เซฟผล ----
const outDir = path.join(ROOT, 'out');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(
  path.join(outDir, 'statuses.json'),
  JSON.stringify({ all: result, cancelled, missing }, null, 2)
);

const csv = [
  'orderNo,platform,status,statusStr,platformStatus,trackingNo,orderTime',
  ...result.map(o =>
    [o.orderNo, o.platform, o.status, o.statusStr, o.platformStatus, o.trackingNo, o.orderTime]
      .map(v => `"${v ?? ''}"`).join(',')
  ),
].join('\n');

fs.writeFileSync(path.join(outDir, 'statuses.csv'), '﻿' + csv);

console.log('\nเซฟแล้ว → out/statuses.json, out/statuses.csv');
