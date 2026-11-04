# BigSeller API — ชุดไฟล์สำหรับเชื่อมต่อระบบอื่น

รวบรวมจากการดักจับ request จริงบนหน้า `bigseller.com` แยกเป็น
**api / body / data / cookie** ให้หยิบไปต่อกับระบบอื่นได้ทันที

```
bigseller-api/
├── api/
│   ├── README.md               ← ภาพรวม auth/header/rate limit + สารบัญ
│   ├── index.js                ← ทางเข้าเดียว import จากไฟล์นี้
│   ├── core/                   ← แกนกลาง ปกติไม่ต้องแตะ
│   │   ├── config.js  http.js  errors.js
│   │   └── README.md
│   ├── endpoints/              ← 1 endpoint = 1 โฟลเดอร์ (index.js + README.md)
│   │   ├── README.md           ← สารบัญ + วิธีเพิ่ม endpoint ใหม่
│   │   ├── search-orders/          ค้นหา / ลิสต์ออเดอร์
│   │   ├── order-status-count/     นับตามสถานะ + ร้าน/คลัง
│   │   ├── filter-list/            รายการตัวกรอง
│   │   ├── logistics-services/     รายชื่อขนส่ง
│   │   ├── search-config/          config ช่องค้นหา
│   │   ├── sync-check/             สถานะ sync
│   │   ├── tiktok-fail-reason/     เหตุผลที่ยิง TikTok ไม่ผ่าน
│   │   └── _shared/                body ที่ใช้ร่วมกัน
│   └── client.js               ← shim ของเดิม (deprecated)
├── body/
│   ├── search-orders.json      ← payload ค้นหาออเดอร์
│   ├── order-status-count.json ← payload นับสถานะ
│   └── README.md               ← อธิบายทุก field + ค่าที่รับ
├── data/
│   ├── order-numbers.json      ← 48 เลขออเดอร์ พร้อมป้อนเข้า API
│   ├── orders-from-labels.csv  ← ผลอ่านป้าย 50 รูป (เปิดใน Excel)
│   ├── orders-from-labels.json
│   └── README.md
├── cookie/
│   └── HOWTO.md                ← วิธีดึง cookie + ข้อควรระวัง
├── examples/
│   ├── get-statuses.js         ← ดึงสถานะครบทุกเลข → CSV/JSON
│   ├── browser-console.js      ← เวอร์ชันวางใน Console (ไม่ต้องยุ่ง cookie)
│   └── sniffer.js              ← ดัก endpoint ที่ยังไม่รู้ (เช่นปุ่ม stock in)
├── env-template.txt            ← ต้นแบบ .env
└── .gitignore
```

---

## สรุป 30 วินาที

```
POST https://www.bigseller.com/api/v1/order/new/pageList.json

Headers:
  Content-Type: application/json
  clientType: 1                 ← ขาดไม่ได้
  Cookie: <session>

Body:
  {"allOrder":true,"historyOrder":0,"searchType":"orderNo",
   "searchContent":"5855...,5854...","inquireType":2,
   "desc":1,"orderBy":"orderTime","pageNo":1,"pageSize":50}

ผลลัพธ์อยู่ที่ → data.page.rows
```

---

## เริ่มใช้

### แบบ Node — ต้องใช้ Node 18 ขึ้นไป

```bash
cd bigseller-api
npm install                 # ลง axios + dotenv (มี package.json ให้แล้ว)
copy env-template.txt .env  # แล้วเปิดแก้
# เปิด .env วาง cookie (ดู cookie/HOWTO.md)
npm run statuses            # = node examples/get-statuses.js
```

ได้ `out/statuses.csv` + `out/statuses.json` พร้อมแยกตัวที่สถานะยกเลิกให้แล้ว

> โค้ดเป็น **ESM** (`import`) — `package.json` ตั้ง `"type": "module"` ไว้แล้ว
> ถ้าย้ายไฟล์ไปโปรเจกต์อื่น อย่าลืมตั้งด้วย ไม่งั้นเจอ
> `Cannot use import statement outside a module`

### แบบไม่ต้องตั้งอะไรเลย

เปิด `bigseller.com` → F12 → Console → วาง `examples/browser-console.js`
cookie ติดไปเองเพราะรันบนโดเมนเดียวกัน

---

## 3 เรื่องที่ทำให้พังบ่อยสุด

| อาการ | สาเหตุ | แก้ |
|---|---|---|
| `Cannot use import statement outside a module` | ไม่มี `package.json` หรือลืม `"type": "module"` | ใช้ `package.json` ที่ให้มา |
| API ไม่รับ / ตอบแปลก ๆ | ลืม header `clientType: 1` | ใส่เข้าไป |
| `"The request is too frequent"` | ยิงถี่เกิน | `core/http.js` จัดคิวเว้นระยะ + retry ให้อัตโนมัติ |
| อยู่ ๆ ก็ 401 / เด้งหน้า login | cookie หมดอายุ | ดึงใหม่ตาม `cookie/HOWTO.md` |
| เด้งไป `noPermissionPage.htm` | บัญชีไม่มีสิทธิ์เมนูนั้น (cookie ยังดี) | ให้ admin เปิดสิทธิ์ให้ — ดึง cookie ใหม่ไม่ช่วย |

เช็ค error ต้องดู `code` ใน body — **HTTP status เป็น 200 เสมอแม้ตอน error**
(`core/http.js` เช็คให้ทั้งสองชั้นแล้ว และแยก error เป็น 6 แบบ:
`no-cookie` / `auth` / `permission` / `rate-limit` / `api` / `network`)

---

## ⚠️ ข้อจำกัดที่ต้องรู้ก่อนเอาไปต่อระบบ

**1. นี่ไม่ใช่ public API** เป็น endpoint ภายในที่หน้าเว็บเรียกเอง
BigSeller เปลี่ยนได้ทุกเมื่อโดยไม่แจ้ง — ระบบที่ต่อไว้อาจพังวันไหนก็ได้
ถ้าจะใช้ระยะยาว **ควรถามซัพพอร์ต BigSeller ว่ามี Open API ให้ใช้ไหม**

**2. Auth เป็น cookie ที่หมดอายุ** ไม่ใช่ API key
ระบบที่ต่อไว้จะหยุดทำงานทุกครั้งที่ session หมด — ต้องมีคนไปแปะ cookie ใหม่
ควรทำ error handling ให้แจ้งเตือนชัด ๆ แทนที่จะเงียบ

**3. cookie = รหัสผ่าน** ใครได้ไปเข้าระบบแทนได้ทันที
`.gitignore` กัน `.env` ไว้ให้แล้ว — อย่าเผลอ commit หรือส่งต่อ

---

## สถานะการทดสอบ

| ส่วน | สถานะ |
|---|---|
| `pageList.json` | ✅ ยิงบน bigseller.com จริงแล้ว — โครงสร้าง request/response ยืนยันแล้ว |
| `getOrderStatusCount.json` | ✅ ยิงจริงแล้ว ผ่าน |
| `api/core/` + `get-statuses.js` | ✅ เทสต์กับ mock server แล้ว: แบ่งก้อน 50, วนหน้า, retry ตอนโดน rate limit, จับเลขที่ไม่เจอ, กรองตัวยกเลิก, เขียน CSV/JSON |
| error handling | ✅ เทสต์ครบ 4 เคส: ไม่ได้ตั้ง cookie / cookie หมดอายุ (401) / ต่อเซิร์ฟเวอร์ไม่ได้ / โดน rate limit |
| ปุ่ม **stock in** | ❌ **ยังไม่รู้ endpoint** |

เรื่อง stock in: บัญชีที่ทดสอบ (`66803015848`) มีร้าน TikTok ชื่อ `b` (TH) ต่ออยู่
แต่ **ไม่มีออเดอร์ในระบบเลยสักรายการ** — ทุกสถานะเป็น 0 รวมถึงยกเลิก
เลยกดปุ่มจริงไม่ได้ ดัก endpoint ไม่ได้

พอเจอบัญชีที่มีข้อมูลแล้ว: วาง `examples/sniffer.js` ใน Console →
กดปุ่ม stock in 1 ครั้ง → รัน `showApi()` จะได้ URL/header/body ของปุ่มนั้นมาครบ
