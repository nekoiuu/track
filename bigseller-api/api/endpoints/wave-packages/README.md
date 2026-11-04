# wave-packages — พัสดุในระบบ Wave (WMS → การจัดการพัสดุ)

```
POST /api/v1/order/wave/getWaveOrderPackageQuery.json
```

endpoint อื่นของหน้าเดียวกัน (แยกโฟลเดอร์):

| โฟลเดอร์ | ทำอะไร |
|---|---|
| [`../wave-package-count/`](../wave-package-count/) | ตัวเลขนับข้างตัวกรอง + รายชื่อขนส่ง |
| [`../wave-warehouses/`](../wave-warehouses/) | คลัง + จำนวน (ใช้เติม `warehouseIds` ให้อัตโนมัติ) |
| [`../wave-sidebar-count/`](../wave-sidebar-count/) | ตัวเลขเมนูซ้าย |

ตัวประกอบ body อยู่ที่ [`../_shared/wave-body.js`](../_shared/wave-body.js) (ใช้ร่วมกับ wave-package-count)

หน้าเว็บ: `https://www.bigseller.com/web/waveShip/packageManage/allPackages.htm`

✅ **ยิงจริงแล้ว** (24 ก.ย. 2026) ตัวกรองทุกตัวในหน้านี้ทดสอบกับ API จริงแล้ว
⚠️ ต้องเป็นแพ็กเกจ **Pro VIP ขึ้นไป** ไม่งั้นหน้าเว็บขึ้นให้อัปเกรด

body เป็น **JSON** (ส่ง form-urlencoded → `code:-1`)

---

## ใช้ยังไง

```js
import { listWavePackages, listWavePackagesAll, getWavePackageCounts } from '../api/index.js';

// หน้าเดียว (ค่าเริ่มต้น = เมนู "รอจัดส่ง")
const page = await listWavePackages({ pageSize: 50 });
console.log(page.totalSize, page.rows);

// ทุกหน้า
const { rows } = await listWavePackagesAll({ platforms: 'tiktok', days: 'today' });

// ค้นเลขพัสดุ / เลขออเดอร์ / tracking (หลายค่าได้)
await listWavePackages({ searchType: 'orderNo', search: ['260924TRBK6G1E', '260924TR0S18Y6'] });

// SKU แบบคลุมเครือ
await listWavePackages({ searchType: 'sku', search: 'ถุงดำ', fuzzy: true });

// ช่วงเวลากำหนดเอง
await listWavePackages({ from: '2026-09-23 00:00:00', to: '2026-09-23 23:59:59' });

// ตัวเลขนับ + รายชื่อขนส่ง (เอา id ไปใช้กับ shipProviderIds) → ../wave-package-count/
const c = await getWavePackageCounts();
c.shipProviderList.map(s => [s.id, s.name, s.count]);
```

---

## ตัวกรอง — หน้าเว็บ → พารามิเตอร์ → field จริงใน body

| หน้าเว็บ | พารามิเตอร์ของเรา | field ที่ส่งจริง | ค่า |
|---|---|---|---|
| เมนูซ้าย | `view` | `packageState` | `'all'`→`4` (รอจัดส่ง), `'abnormal'`→`7` (ผิดปกติ), `'shipped'`→`5` (จัดส่งแล้ว) |
| — | `packageState` | `packageState` | ส่งตรง ๆ ทับ `view` (`1` รอหยิบ, `8` รอคัดแยก, `2` รอบรรจุ, `3` กำลังบรรจุ) |
| คลังสินค้าจัดส่ง | `warehouseIds` | `warehouseIdList: number[]` | ไม่ส่ง = ดึงทุกคลังจาก `listWaveWarehouses()` ให้เอง |
| แพลตฟอร์ม | `platforms` | `platformList: string[]` | `'shopee'` `'lazada'` `'tiktok'` |
| ร้านค้า | `shopIds` | `shopIdList: number[]` | id ร้าน (ดูได้จาก `getWavePackageCounts().shopCountMap`) |
| โลจิสติกส์ | `shipProviderIds` | `providerOpenIds: "id,id"` | **string คั่นจุลภาค** ไม่ใช่ array |
| กลุ่มการจัดส่ง | — | — | หน้าเว็บแค่แตกกลุ่มเป็น `providerOpenIds` → ใช้ `shipProviderGroupList[i].providerOpenIds` |
| เครื่องหมายคำสั่งซื้อ | `mark` + `markIds` | `hasLable` + `lableIds` | `'none'`→`0`, `'any'`→`1`, `'all'`→`2` — any/all **ต้องมี** `markIds` ไม่งั้น `"ไม่พบแท็ก"` |
| เลือกเวลา (ประเภท) | `timeType` | `timeType` | `'order'`→`1`, `'expire'`→`7`, `'confirm'`→`8`, `'print'`→`3` (view abnormal ส่ง null) |
| ทั้งหมด/วันนี้/… | `days` | `days` | `'today'`/`0`, `'yesterday'`/`1`, `3`, `7`, `30` |
| วันที่กำหนดเอง | `from` `to` | `beginDate` `endDate` | `'YYYY-MM-DD HH:mm:ss'` หรือ `Date` (ไม่ต้องส่ง `days`) |
| ค้นหา | `searchType` + `search` | `searchType` + `searchContent` | ดูตารางข้างล่าง |
| แม่นยำ/คลุมเครือ | `fuzzy` | `inquireType` | `false`→`2` แม่นยำ, `true`→`0` คลุมเครือ (≥ 2 ตัวอักษร) |
| 50/100/300 ต่อหน้า | `pageSize` | `pageSize` | ยิงทดสอบแล้ว **1000** ก็ได้ |

field คงที่ที่หน้าเว็บส่งเสมอ: `tabStatus: 'printLabelMark'`, `isNew: 1`
ค่าว่าง / null ถูกตัดทิ้งก่อนส่ง (หน้าเว็บก็ทำ)

### searchType

| ของเรา | ส่งจริง | ค้นแบบ |
|---|---|---|
| `packageNo` (ค่าเริ่มต้น) | `packageNo` | แม่นยำ |
| `waveNo` | `waveNo` | แม่นยำ |
| `orderNo` | `orderNo` | แม่นยำ |
| `trackingNo` | **`tackingNo`** (BigSeller สะกดผิดเอง) | แม่นยำ |
| `sku` | `commoditySku` | แม่นยำ / คลุมเครือ |
| `picker` | `picker` | คลุมเครือ |
| `packer` | `packer` | คลุมเครือ |

---

## ผลที่ทดสอบ (บัญชีนี้ 24 ก.ย. 2026)

| ตัวกรอง | totalSize |
|---|---|
| ไม่กรอง (รอจัดส่ง) | 3,846 |
| `platforms: 'lazada'` | 62 |
| `shopIds: 2400879` | 62 |
| `shipProviderIds: 4196047` (Lazada LEX) | 6 |
| `days: 'today'` | 1,056 |
| `from/to` 23 ก.ย. ทั้งวัน | 2,722 |
| `mark: 'any', markIds: 1100` (โกดัง2) | 356 |
| `mark: 'none'` | 3,489 |
| `search: 'BSG9631W31507'` | 1 |
| `searchType: 'sku', search: 'ถุงดำ', fuzzy: true` | 86 |
| `view: 'abnormal'` | 1 |
| `view: 'shipped', days: 7` | 63,963 |

---

## response (1 row)

```js
{
  id, waveId, waveNo: 'WMG963080495', orderId, platformOrderId: '260924TRBK6G1E',
  platform: 'shopee', shopName: 'BTHSP', packageNo: 'BSG9631W31507',
  packageType: 1,            // 1 สินค้าเดียว 1 ชิ้น / 2 สินค้าเดียวหลายชิ้น / 3 หลายชนิด
  shipProviderName, trackingNo, receiving, area,
  createTime, payTime, expireTime,        // เป็นข้อความภาษาไทย เช่น '24 ก.ย. 2026 10:25'
  picker, packer, shipper, printNum, printTimeList: ['2026-09-24 10:27'],
  labelList: [{ id: 1100, title: 'โกดัง2', color }],   // ← id ใช้กับ markIds
  skuVos: [{ skuId, sku, skuName, skuImg, num }],
  warehouseId,
}
```
