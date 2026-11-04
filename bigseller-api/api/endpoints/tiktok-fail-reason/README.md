# tiktok-fail-reason — เหตุผลที่ยิงออเดอร์ TikTok ไม่ผ่าน

```
GET /api/v1/order/tiktok/getFailReason.json
```

⚠️ **ยังไม่ได้เจาะ** — ดักเจอว่าหน้าเว็บเรียก แต่ยังไม่ได้ยิงดู response
และยังไม่รู้ว่าต้องส่ง query อะไร (น่าจะต้องมี order id)

---

## ใช้ยังไง

```js
import { getTiktokFailReason } from '../api/index.js';

// ยังไม่รู้ว่ารับ param อะไร — ลองแบบไม่ส่งก่อน
const data = await getTiktokFailReason();

// ถ้าต้องระบุออเดอร์ น่าจะประมาณนี้
const data2 = await getTiktokFailReason({ orderId: '...' });
```

---

## ที่คาดว่าจะได้

ข้อความบอกสาเหตุที่ออเดอร์ TikTok ยิงเข้าระบบไม่สำเร็จ
ใช้คู่กับออเดอร์ที่ `platform === 'tiktok'` แล้วสถานะค้าง

---

## หา param ที่ถูกต้องยังไง

วาง [`../../../examples/sniffer.js`](../../../examples/sniffer.js) ใน Console ของหน้า bigseller.com
แล้วไปกดดูออเดอร์ TikTok ที่ fail จริง 1 ครั้ง จากนั้นรัน

```js
window.__cap.filter(r => /getFailReason/.test(r.url))
```

จะได้ URL เต็ม ๆ พร้อม query string ที่หน้าเว็บใช้จริง
