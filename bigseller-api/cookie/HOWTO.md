# Cookie — วิธีดึงมาใช้

BigSeller ไม่มี API key ใช้ **cookie session** อย่างเดียว
cookie ตัวที่ใช้ยืนยันตัวตนเป็น **HttpOnly** → JavaScript อ่านไม่ได้
ต้องก๊อปจาก DevTools ด้วยมือ

---

## ตัวไหนคือ session?

**ส่งทั้งก้อนไปเลยง่ายที่สุด** ไม่ต้องแยกว่าตัวไหนคือตัวไหน
แต่ถ้าอยากรู้ว่าตัวไหนคือตัวจริง — **ตัวที่ JS อ่านไม่ได้ นั่นแหละคือ session**

รันใน Console จะเห็นชัด:

```js
// เอารายชื่อทั้งหมดจาก DevTools → Application → Cookies → bigseller.com
// มาเทียบกับตัวที่ JS อ่านได้
const readable = document.cookie.split(';').map(c => c.split('=')[0].trim());
console.log('JS อ่านได้ (ไม่ใช่ session):', readable);
// ตัวที่อยู่ใน Application แต่ไม่โผล่ในลิสต์นี้ = HttpOnly = ตัวที่ใช้ยืนยันตัวตน
```

หรือดูตรง ๆ ที่ **Application → Cookies → `https://www.bigseller.com`**
แล้วดูคอลัมน์ **HttpOnly** — ตัวที่ติ๊กถูก คือตัวที่ต้องมี

### ตัวที่ JS อ่านได้ (เป็นของ analytics/ตั้งค่า — ไม่ใช่ session)

`_ga` `_ga_CMT5216T6L` `_gcl_au` `_fbp` `_clck` `_clsk`
`_tt_enable_cookie` `_ttp` `ttcsid` `ttcsid_*`
`_hjSession_*` `_hjSessionUser_*` `__lt__cid` `__lt__sid` `_ss_s_uid`
`language` `i18n_redirected` `org.springframework...CookieLocaleResolver.LOCALE`
`fingerPrint` `muc_login_account_type` `MYJ_yosu7anwoc` `MYJ_MKTG_yosu7anwoc` `TDC_itoken`

> BigSeller หลังบ้านเป็น Spring (เห็นจาก cookie `org.springframework...`)
> ตัว session ของ Spring มักชื่อ **`JSESSIONID`** — เช็คในคอลัมน์ HttpOnly ได้เลย
> แต่ย้ำอีกที: **ก๊อปทั้งก้อนไปเลย ไม่ต้องเลือก** จะไม่มีปัญหาว่าขาดตัวไหน

---

## ขั้นตอน

1. เปิด `https://www.bigseller.com` แล้วล็อกอินให้เรียบร้อย
2. กด **F12** → แท็บ **Network**
3. บนหน้าเว็บ กดค้นหาออเดอร์อะไรก็ได้ 1 ครั้ง
4. ในลิสต์ Network หา request ชื่อ **`pageList.json`** แล้วคลิก
5. เลื่อนไปที่ **Headers → Request Headers → `Cookie`**
6. คลิกขวาที่ค่า → Copy value (ก๊อปทั้งก้อน ตั้งแต่ตัวแรกถึงตัวสุดท้าย)

> ทางลัด: คลิกขวาที่ request → **Copy → Copy as fetch**
> จะได้ทั้ง URL + headers + body มาครบเลย

7. เปิดไฟล์ `.env` (ก๊อปจาก `.env.example`) แล้ววางลงในบรรทัด

```
BIGSELLER_COOKIE="ก้อนที่ก๊อปมา"
```

ครอบด้วย `"` ด้วย เพราะในก้อนมี `;` และช่องว่าง

---

## หน้าตาของ cookie ที่ได้

```
BIGSELLER_COOKIE="_ga=GA1.1.xxx; MYJ_xxxxx=xxxxx; TDC_itoken=xxxxx; language=th_TH; ..."
```

---

## ข้อควรระวัง

**cookie นี้ = รหัสผ่านของบัญชี** ใครได้ไปเข้าระบบแทนคุณได้ทันที

- อย่า commit ขึ้น git — มี `.gitignore` กัน `.env` ไว้ให้แล้ว
- อย่าส่งในแชท / อีเมล / ทิ้งไว้ในโค้ด
- ถ้าเผลอหลุด → ล็อกเอาต์จาก BigSeller ทุกอุปกรณ์ แล้วดึงใหม่
- ถ้าจะเก็บบนเซิร์ฟเวอร์ ใช้ secret manager อย่าเก็บเป็นไฟล์เปล่า

---

## cookie หมดอายุแล้วรู้ได้ยังไง

request จะเริ่ม redirect ไปหน้า login หรือคืน `code` ที่ไม่ใช่ `0`
แก้โดยดึง cookie ใหม่ตามขั้นตอนข้างบน

**นี่คือจุดอ่อนของวิธีนี้** — ระบบที่ต่อไว้จะพังทุกครั้งที่ session หมดอายุ
ถ้าจะใช้ยาว ๆ ควรทำ 2 อย่าง:

1. ให้ระบบตรวจจับ error แล้วแจ้งเตือนว่า "cookie หมดอายุ" แทนที่จะเงียบ
2. ลองถามฝ่ายซัพพอร์ต BigSeller ว่ามี Open API ให้ใช้ไหม — จะได้ token ที่ไม่หมดอายุง่าย
