# search-orders — ค้นหา / ลิสต์ออเดอร์

```
POST /api/v1/order/new/pageList.json
```

endpoint หลักของทั้งโปรเจกต์ ✅ **ยิงบน bigseller.com จริงแล้ว** โครงสร้างยืนยันแล้ว

---

## ใช้ยังไง

```js
import { searchOrders, searchOrdersBatch } from '../api/index.js';

// เลขเดียว
const page = await searchOrders('585451537185604754');
console.log(page.totalSize, page.rows);

// หลายเลขในครั้งเดียว (สูงสุด pageSize ต่อ 1 request)
const page2 = await searchOrders(['58545...', '58551...']);

// เยอะมาก — แบ่งก้อน + วนหน้า + บอกเลขที่ไม่เจอ ให้อัตโนมัติ
const { rows, missing } = await searchOrdersBatch(orderNos);
```

---

## `searchOrders(orderNos, opt?)`

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `orderNos` | — | `string` หรือ `string[]` — ต่อกันด้วย `,` ให้เอง |
| `opt.pageNo` | `1` | หน้าที่เอา |
| `opt.pageSize` | `CHUNK_SIZE` (50) | กี่รายการต่อหน้า |
| `opt.orderBy` | `'orderTime'` | field ที่ใช้เรียง |
| `opt.desc` | `1` | `1` = ใหม่→เก่า, `0` = เก่า→ใหม่ |
| `opt.historyOrder` | `0` | `1` = ค้นในประวัติ (ออเดอร์เกิน 90 วัน) |
| `opt.searchType` | `'orderNo'` | ค้นด้วย field ไหน |
| `opt.allOrder` | `true` | `true` = ละเว้นตัวกรองทุกอัน |
| `opt.inquireType` | `2` | |

คืน **`data.page`** — ไม่ใช่ทั้ง response

```js
{ pageNo: 1, pageSize: 50, totalPage: 1, totalSize: 2, rows: [ /* ออเดอร์ */ ] }
```

> ข้อมูลอยู่ที่ `page.rows` — เผลอไปหยิบ `data.rows` จะได้ `undefined`

---

## `searchOrdersBatch(orderNos, opt?)`

รับเลขเยอะเท่าไหร่ก็ได้ แล้วจัดการให้ครบ:

1. แบ่งเป็นก้อนละ `CHUNK_SIZE`
2. ก้อนไหนมีหลายหน้า วนจนครบเอง
3. เทียบเลขที่ขอกับเลขที่ได้ → บอกว่าตัวไหนไม่เจอ

```js
const { rows, missing } = await searchOrdersBatch(orderNos);
// rows    = ออเดอร์ทั้งหมดที่เจอ
// missing = ['58551...']  เลขที่ค้นไม่เจอ
```

ไม่ต้องหน่วงเอง — `core/http.js` จัดคิวเว้นระยะให้ทุก request แล้ว

---

## body ที่ส่งออกไปจริง

```json
{
  "allOrder": true,
  "historyOrder": 0,
  "searchType": "orderNo",
  "searchContent": "585451537185604754,585518459275151310",
  "inquireType": 2,
  "desc": 1,
  "orderBy": "orderTime",
  "pageNo": 1,
  "pageSize": 50
}
```

5 field แรกมาจาก [`../_shared/search-body.js`](../_shared/search-body.js) (ใช้ร่วมกับ order-status-count)
4 field ท้ายเป็นของ endpoint นี้เอง อยู่ใน [`index.js`](index.js)

---

## field ที่ใช้บ่อยใน `rows[]`

| field | คืออะไร |
|---|---|
| `orderNo` | เลขออเดอร์ของ BigSeller |
| `platformOrderNo` | เลขออเดอร์ฝั่งแพลตฟอร์ม |
| `platform` | `tiktok` / `shopee` / `lazada` … |
| `shopName` | ชื่อร้าน |
| `status` / `statusStr` | สถานะ (ตัวเลข / ข้อความ) |
| `platformStatus` | สถานะฝั่งแพลตฟอร์ม |
| `trackingNo` | เลขพัสดุ |
| `orderTime` | เวลาสั่งซื้อ |
| `totalAmount` | ยอดรวม |

---

## ข้อควรระวัง

- **ออเดอร์เกิน 90 วัน** ย้ายไป "ประวัติคำสั่งซื้อ" — ต้องยิงซ้ำด้วย `historyOrder: 1` ถึงจะเจอ
- **`allOrder: true` ละเว้นตัวกรองทุกอัน** (แพลตฟอร์ม/ร้าน/คลัง/ช่วงเวลา) ถ้าอยากให้ตัวกรองมีผลต้องส่ง `false` แล้วใส่ field กรองเพิ่มเอง
- `searchContent` คั่นได้ทั้ง `,` และ `\n`
- HTTP เป็น 200 เสมอแม้ตอน error — `core/http.js` เช็ค `code` ให้แล้ว ไม่ต้องเช็คเอง
