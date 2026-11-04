# manifests — ใบนำจ่าย (ที่พิมพ์ไปแล้ว)

```
POST /api/v1/order/sign/manifest/pageList.json
```

✅ **ยิงจริงแล้ว** ทุกข้อในหน้านี้ทดสอบมาแล้ว ไม่ใช่การเดา
ดึงมาได้ครบ 1,942 ใบ ไม่ซ้ำสักใบ

> เป็น endpoint ฝั่งสินค้า/พัสดุตัวเดียวที่บัญชีนี้เรียกได้จริง
> ([`../list-products/`](../list-products/) กับ [`../product-stock/`](../product-stock/) ยังโดน 302 noPermission อยู่)

---

## ใช้ยังไง

```js
import { listManifests, listManifestsAll, findManifests } from '../api/index.js';

// หน้าเดียว
const page = await listManifests({ pageSize: 50 });
console.log(page.totalSize, page.rows);

// ทั้งหมด — 1,942 ใบจบใน 2 request (pageSize 1000)
const { rows } = await listManifestsAll();

// หาของเลขออเดอร์ที่ระบุ
const { rows: mine, missing } = await findManifests(['585959168048268652']);
```

---

## `listManifests(opt?)` — 1 หน้า

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `opt.pageNo` | `1` | หน้าที่เอา |
| `opt.pageSize` | `CHUNK_SIZE` (50) | สูงสุด `MAX_PAGE_SIZE` = **1000** (ทดสอบแล้วรับจริง) |
| `opt.orderNo` | — | เลขออเดอร์ **1 เลข** — ไม่ส่ง = เอาทั้งหมด |

คืนหน้าที่ผ่าน [`../_shared/page.js`](../_shared/page.js) แล้ว

```js
{ pageNo: 1, pageSize: 50, totalPage: 39, totalSize: 1942, rows: [...], raw: {...} }
```

---

## `listManifestsAll(opt?)` — ทุกหน้า

`pageSize` ตั้งไว้ที่ `1000` ให้เลย ยิงแค่ 2 ครั้งก็ครบ (`maxPages` ยังคุมเพดานอยู่ที่ 20)

```js
const { rows, totalSize, totalPage, truncated } = await listManifestsAll();
// rows.length = 1942, truncated = false
```

---

## `findManifests(orderNos)` — หาตามเลขออเดอร์

API รับทีละ 1 เลข ตัวนี้เลยวนยิงให้ แล้วบอกด้วยว่าเลขไหนไม่เจอ

```js
const { rows, missing } = await findManifests(['585959168048268652', '9999999999999999']);
// rows    = [ { manifestNo: 'MFG963072007', … } ]
// missing = [ '9999999999999999' ]
```

> ยิง N เลข = ใช้เวลา N × `REQUEST_DELAY_MS` (1.5 วิ/เลข) — เลขเยอะมากให้ดึงทั้งหมด
> ด้วย `listManifestsAll()` แล้วกรองในเครื่องเอาเร็วกว่า

---

## field ใน `rows[]`

| field | ตัวอย่าง | คืออะไร |
|---|---|---|
| `manifestNo` | `MFG963072007` | เลขใบนำจ่าย |
| `orderNo` | `585959168048268652` | เลขออเดอร์ BigSeller |
| `trackingNo` | `THT12095EP62M4Z` | เลขพัสดุ **กล่องแรกเท่านั้น** — ทั้งใบใช้ [`../manifest-detail/`](../manifest-detail/) |
| `logisticsName` | `All` | ขนส่ง |
| `manifestInfomation` | `20` | **จำนวนกล่องในใบ** (ยืนยันแล้วกับ MFG963088665 — สะกดผิดแบบนี้จริงในฝั่ง API) |
| `printTime` | `1788974428000` | เวลาพิมพ์ (epoch ms) |
| `printTimeStr` | `09 ก.ย. 2026 17:20` | เวลาพิมพ์ (ไทย พร้อมใช้) |

---

## ข้อควรระวัง (ทดสอบมาแล้วทุกข้อ)

| ทำแบบนี้ | ได้ |
|---|---|
| `searchType: 'orderNo'` + 1 เลข | ✅ เจอ |
| **ไม่ส่ง** `searchType` | ❌ `totalSize: 0` — เป็น field บังคับเมื่อจะค้น |
| `searchType: 'trackingNo'` / `'manifestNo'` | ❌ `totalSize: 0` — รับแต่ `'orderNo'` |
| สองเลขคั่นด้วย `,` หรือ `\n` | ❌ `totalSize: 0` — **ต่างจาก `search-orders` ที่คั่นได้** |
| `manifestNo` เป็น field แยก | ❌ ถูกเมิน คืนมาทั้ง 1,942 ใบ |
| `pageSize: 1000` | ✅ ได้ครบ 1000 แถว |

`buildManifestBody()` ใส่ `searchType: 'orderNo'` ให้อัตโนมัติเมื่อส่ง `orderNo` — ไม่ต้องจำเอง

**หน้าเกินจริงไม่ได้คืนค่าว่าง** — ขอ `pageNo: 999` ทั้งที่มี 195 หน้า มันคืนแถวของหน้าสุดท้ายกลับมา
วนหน้าเองต้องหยุดที่ `totalPage` เท่านั้น ห้ามวนจนกว่าจะเจอหน้าว่าง (`listManifestsAll` หยุดถูกให้แล้ว)

**ค้นเป็นแบบตรงตัว** ใส่เลขออเดอร์ไม่ครบ = ไม่เจอ
