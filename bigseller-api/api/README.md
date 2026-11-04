# BigSeller — Internal Web API

> ไม่ใช่ public API — เป็น endpoint ที่หน้าเว็บ `bigseller.com` เรียกใช้เอง
> ดักจับมาจาก Network ตอนกดค้นหาจริงบนหน้า Orders
> **อาจเปลี่ยนได้ทุกเมื่อโดยไม่แจ้งล่วงหน้า**

Base URL: `https://www.bigseller.com`

---

## เริ่มตรงนี้

```js
import { searchOrders } from './api/index.js';

const page = await searchOrders('585451537185604754');
console.log(page.totalSize, page.rows);
```

import จาก [`index.js`](index.js) ที่เดียวพอ ไม่ต้องไปไล่ import จากโฟลเดอร์ย่อย

---

## โครงสร้าง

```
api/
├── index.js          ← ทางเข้าเดียว import จากไฟล์นี้
├── core/             ← แกนกลาง ปกติไม่ต้องแตะ
│   ├── config.js         อ่าน .env + ตรวจ cookie
│   ├── http.js           header, ตรวจ response, คิวเว้นระยะ, retry
│   ├── errors.js         BigSellerError + KINDS
│   └── README.md     ← อธิบายแกนกลาง
├── endpoints/        ← 1 endpoint = 1 โฟลเดอร์ (เพิ่มของใหม่ที่นี่)
│   ├── search-orders/        index.js + README.md
│   ├── order-status-count/   index.js + README.md
│   ├── filter-list/          index.js + README.md
│   ├── logistics-services/   index.js + README.md
│   ├── search-config/        index.js + README.md
│   ├── sync-check/           index.js + README.md
│   ├── tiktok-fail-reason/   index.js + README.md
│   ├── _shared/              body ที่ใช้ร่วมกัน (ไม่ใช่ endpoint)
│   └── README.md     ← สารบัญ endpoint + วิธีเพิ่มอันใหม่
└── client.js         ← shim ของเดิม (deprecated → ใช้ index.js)
```

**แยกสองชั้น** — `core/` รู้เรื่อง auth/http/error, `endpoints/` รู้แค่ path กับ body
เพิ่ม endpoint ใหม่จึงแตะแค่ `endpoints/` ไม่กระทบของเดิม

---

## endpoint ทั้งหมด

แต่ละตัวมี README สอนใช้ของตัวเอง — กดเข้าไปดูได้เลย

| endpoint | method | ใช้ทำอะไร | สถานะ |
|---|---|---|---|
| [`search-orders`](endpoints/search-orders/) | POST | ค้นหา / ลิสต์ออเดอร์ | ✅ ยิงจริงแล้ว |
| [`order-status-count`](endpoints/order-status-count/) | POST | นับตามสถานะ + ข้อมูลร้าน/คลัง | ✅ ยิงจริงแล้ว |
| [`filter-list`](endpoints/filter-list/) | GET | รายการตัวกรอง | ⚠️ ยังไม่ได้เจาะ |
| [`logistics-services`](endpoints/logistics-services/) | GET | รายชื่อขนส่ง | ⚠️ ยังไม่ได้เจาะ |
| [`search-config`](endpoints/search-config/) | GET | config ช่องค้นหา | ⚠️ ยังไม่ได้เจาะ |
| [`sync-check`](endpoints/sync-check/) | GET | สถานะ sync | ⚠️ ยังไม่ได้เจาะ |
| [`tiktok-fail-reason`](endpoints/tiktok-fail-reason/) | GET | เหตุผลที่ยิง TikTok ไม่ผ่าน | ⚠️ ยังไม่ได้เจาะ |

---

## Auth

ใช้ **cookie session** ล้วน ๆ ไม่มี API key / Bearer token

| | |
|---|---|
| ส่งยังไง | header `Cookie: <ทั้งก้อน>` |
| ได้มาจากไหน | [`../cookie/HOWTO.md`](../cookie/HOWTO.md) |
| อายุ | ตามรอบ session — หมดแล้วต้องดึงใหม่ |
| ยิงจากเบราว์เซอร์ | `credentials: 'include'` (fetch) หรือ `withCredentials: true` (axios) แล้ว cookie ติดไปเอง |

ตั้งค่าที่ `BIGSELLER_COOKIE` ใน `.env` — [`core/config.js`](core/config.js) ตรวจให้ตั้งแต่ตอน import
วางผิดรูปแบบจะรู้ทันทีโดยไม่เสีย request

---

## Headers ที่ต้องส่งทุก request

```
Content-Type: application/json
clientType: 1          ← ขาดไม่ได้ ไม่ใส่แล้ว API ไม่รับ
Cookie: <session>
```

**ไม่พอแค่นั้นถ้ายิงจาก Node** — ต้องมี `User-Agent` แบบเบราว์เซอร์ + `Origin` + `Referer`
+ `Sec-Fetch-*` ด้วย ไม่งั้นตัวตรวจ bot เด้งทิ้งแล้วคืนหน้า login มาแทน JSON

[`core/http.js`](core/http.js) ใส่ให้ครบแล้ว ไม่ต้องทำเอง

(`sentry-trace`, `baggage` ที่เห็นใน DevTools เป็นของ Sentry ตัดทิ้งได้)

---

## Rate limit

ยิงรัวเกินไปจะได้

```json
{ "code": <ไม่ใช่ 0>, "msg": "The request is too frequent. Please try again later" }
```

เว้นระยะ **~1.5 วินาที** กำลังดี — ตั้งที่ `REQUEST_DELAY_MS` ใน `.env`

[`core/http.js`](core/http.js) จัดคิวเว้นระยะให้ทุก request อัตโนมัติ และ retry เองเมื่อโดน
**ไม่ต้อง `sleep` เองในโค้ดที่เรียกใช้**

---

## เช็ค error ยังไง

`code: 0` เท่านั้นคือสำเร็จ — **HTTP ยังเป็น 200 แม้ตอน error** จึงต้องเช็ค `code` เสมอ

[`core/http.js`](core/http.js) เช็คให้ทั้งสองชั้นแล้ว แล้วโยน `BigSellerError` ที่มี `.kind` 6 แบบ:

```
no-cookie   ตั้งค่าผิด        → แก้ .env
auth        cookie ใช้ไม่ได้   → ดึงใหม่
permission  สิทธิ์ไม่พอ        → cookie ดีอยู่ ให้ admin เปิดเมนูให้
rate-limit  ยิงถี่ไป          → retry ให้เองแล้ว
api         code != 0 อื่น ๆ
network     ต่อไม่ติด
```

รายละเอียด → [`core/README.md`](core/README.md)

---

## ยังไม่รู้ endpoint: ปุ่ม stock in

บัญชีที่ทดสอบยังไม่มีออเดอร์ในระบบ เลยกดปุ่มจริงไม่ได้

วิธีหา: วาง [`../examples/sniffer.js`](../examples/sniffer.js) ใน Console ก่อน
แล้วไปกดปุ่ม stock in บนหน้าเว็บ 1 ครั้ง จากนั้นรัน

```js
window.__cap.filter(r => /\/api\/v1\//.test(r.url))
```

จะได้ URL + headers + body ของปุ่มนั้นมาครบ แล้วเอาไปสร้างโฟลเดอร์ใหม่ตาม
[`endpoints/README.md`](endpoints/README.md)

---

## ข้อควรระวังจากการทดสอบจริง

- `searchContent` ใส่หลายเลขได้ คั่นด้วย `,` หรือ `\n`
- `allOrder: true` = โหมด "ค้นหาแบบรวม" → **ละเว้นตัวกรองทุกอัน** (แพลตฟอร์ม/ร้าน/คลัง/ช่วงเวลา)
  ถ้าอยากให้ตัวกรองมีผล ต้องส่ง `false` แล้วใส่ field กรองเพิ่มเอง
- ออเดอร์เกิน 90 วันย้ายไป "ประวัติคำสั่งซื้อ" → ต้องยิงซ้ำด้วย `historyOrder: 1`
- ผลลัพธ์ของ `pageList` อยู่ที่ `data.page.rows` ไม่ใช่ `data.rows`
