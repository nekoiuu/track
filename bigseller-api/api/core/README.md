# core — แกนกลาง

ทุก endpoint ยิงผ่าน 3 ไฟล์นี้หมด **ปกติไม่ต้องแตะ**
แตะเมื่อ BigSeller เปลี่ยนวิธี auth หรือเปลี่ยนรูปแบบ response เท่านั้น

| ไฟล์ | ทำอะไร |
|---|---|
| [`config.js`](config.js) | อ่าน `.env` + ตรวจ cookie ตั้งแต่ตอน import |
| [`http.js`](http.js) | header, ตรวจ response, คิวเว้นระยะ, retry |
| [`errors.js`](errors.js) | `BigSellerError` + ชนิดของ error |
| [`cookie-jar.js`](cookie-jar.js) | เก็บ cookie ใหม่ที่ BigSeller หมุนให้ผ่าน `Set-Cookie` |

---

## config.js

โหลด `.env` จาก**รากโปรเจกต์เสมอ** ไม่ผูกกับ cwd — รันจากโฟลเดอร์ไหนก็เจอ
(`import 'dotenv/config'` แบบเดิมหาไฟล์จากที่พิมพ์คำสั่ง รันจากที่อื่นแล้วพังเงียบ ๆ)

ค่าที่อ่านจาก `.env`

| ตัวแปร | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `BIGSELLER_COOKIE` | — | **บังคับ** Cookie header ทั้งก้อน |
| `BIGSELLER_BASE_URL` | `https://www.bigseller.com` | |
| `BIGSELLER_UA` | Chrome 131 | ควรตรงกับเบราว์เซอร์ที่ก๊อป cookie มา |
| `BIGSELLER_REFERER` | `<BASE_URL>/` | |
| `REQUEST_DELAY_MS` | `1500` | ระยะห่างขั้นต่ำระหว่าง request |
| `CHUNK_SIZE` | `50` | เลขออเดอร์ต่อ 1 request |
| `MAX_RETRIES` | `3` | retry ตอนโดน rate limit |

### ตรวจ cookie ก่อนยิง (`validateCookie`)

ตรวจทุกครั้ง**ก่อนส่ง request จริง** — ตั้งผิดก็พังโดยไม่เสียโควตาเหมือนเดิม
(เดิมตรวจตอน import แต่ตอนนี้ cookie เปลี่ยนได้ระหว่างรัน เลยย้ายมาตรวจตอนยิง)

1. ไม่มีค่า → บอกแยกสามกรณี: ไม่มีไฟล์ `.env` / มีไฟล์แต่ไม่มีบรรทัด / โดน env var ของ shell ทับ
2. มีค่าแต่หาคู่ `name=value` ไม่เจอ → วาง token เดี่ยว ๆ มา ไม่ใช่ Cookie header ทั้งก้อน
3. ไม่มี `JSESSIONID` หรือ `muc_token` → เตือน (ไม่ throw เผื่อ BigSeller เปลี่ยนชื่อ)

---

## cookie-jar.js

BigSeller **หมุน cookie ใหม่ไปเรื่อย ๆ** (`muc_token` / `JSESSIONID`) ผ่าน `Set-Cookie`
เบราว์เซอร์รับค่าใหม่เองเลยไม่เคยหลุด แต่ก้อนที่ก๊อปใส่ `.env` ค้างอยู่ที่ค่าเก่า → พังทั้งที่เบราว์เซอร์ยังล็อกอินอยู่

`http.js` ส่งทุก response ให้ `absorbSetCookie()` → รวมค่าใหม่เข้าก้อน (ลบตัวที่ `Max-Age=0` / หมดอายุ) แล้วใช้ก้อนใหม่ใน request ถัดไป

```js
import { getCookie, setCookie, onCookieChange } from "../api/index.js";

setCookie(cookieจากDB);                       // โหลดค่าล่าสุดตอนเริ่ม
onCookieChange((cookie, changed) => save(cookie)); // เก็บทุกครั้งที่ BigSeller หมุนให้
```

ค่าอยู่ในหน่วยความจำเท่านั้น — สคริปต์ CLI ใช้ได้ตลอดการรัน แต่รันครั้งหน้าก็กลับไปอ่าน `.env`
เว็บ (รากโปรเจกต์) เก็บลง DB ให้เอง → `src/lib/bigseller-session.ts`

---

## http.js

### header

axios ใน Node ประกาศตัวเองว่า `User-Agent: axios/1.x` และไม่ส่ง `Origin`/`Referer` เลย
ตัวตรวจ bot ของ BigSeller (มาคู่กับ cookie `fingerPrint` / `MYJ_*` / `__lt__cid`)
เห็นแบบนั้นแล้วเด้งทิ้ง คืนหน้า login มาแทน JSON

เลยต้องใส่ให้ครบ: `clientType: 1` (ขาดไม่ได้), UA, `Origin`, `Referer`,
`X-Requested-With`, `sec-ch-ua*`, `Sec-Fetch-*`

### คิวเว้นระยะ

คิวเส้นเดียวของทั้งโปรเจกต์ — ต่อให้เรียกหลาย endpoint พร้อมกันด้วย `Promise.all`
ก็จะถูกจัดคิวให้ห่างกัน `REQUEST_DELAY_MS` อัตโนมัติ **endpoint ไม่ต้อง `sleep` เอง**

error ตัวหนึ่งไม่ทำให้คิวที่เหลือตาย

### ตรวจ response 2 ชั้น

BigSeller คืน **HTTP 200 แม้ตอน error** ดูแค่ status ไม่พอ

| เจอ | แปลว่า | `kind` |
|---|---|---|
| 401 / 403 | cookie ใช้ไม่ได้ | `auth` |
| 3xx redirect → `noPermissionPage` | cookie ดี แต่บัญชีไม่มีสิทธิ์เมนูนั้น | `permission` |
| 3xx redirect อื่น ๆ | เด้งไปหน้า login (บอกปลายทางด้วย) | `auth` |
| ได้ HTML แทน JSON | หน้า login หรือหน้าตรวจ bot (พ่นเนื้อ 300 ตัวแรกให้ดู) | `auth` |
| `code != 0` + `"too frequent"` | ยิงถี่ไป | `rate-limit` |
| `code != 0` + `login`/`auth`/`登录` | session หมด | `auth` |
| `code != 0` อื่น ๆ | | `api` |
| ต่อไม่ติด | | `network` |

ผ่านหมด → คืน `data` ที่แกะออกมาแล้ว

### retry

`rate-limit` เท่านั้นที่ retry ถอยรอ `DELAY_MS × (รอบ+2)` สูงสุด `MAX_RETRIES` ครั้ง
`auth` / `no-cookie` / `permission` ไม่ retry — ลองไปก็เท่านั้น เปลืองโควตาเปล่า

### ยิงเอง

```js
import { get, post } from '../api/index.js';

const data = await get('/api/v1/order/v2/filterList.json');
const res  = await post('/api/v1/order/xxx.json', { foo: 1 });
```

ได้ header/คิว/retry/error ครบเหมือน endpoint ที่มี wrapper

---

## errors.js

```js
import { BigSellerError, KINDS } from '../api/index.js';

try {
  await searchOrders('123');
} catch (e) {
  if (e.kind === KINDS.AUTH) {
    // แจ้งเตือนให้คนไปแปะ cookie ใหม่
  }
  console.log(e.detail);   // { path, status, code, msg }
  console.log(e.retryable); // true เฉพาะ rate-limit / network
}
```

`.detail` มีข้อมูลดิบไว้ debug — endpoint ไหน, HTTP อะไร, `code`/`msg` ที่ API ตอบ
