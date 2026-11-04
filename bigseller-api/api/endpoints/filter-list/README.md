# filter-list — รายการตัวกรองของหน้า Orders

```
GET /api/v1/order/v2/filterList.json
```

⚠️ **ยังไม่ได้เจาะ** — ดักเจอจาก Network ว่าหน้าเว็บเรียก แต่ยังไม่ได้ยิงดู response

---

## ใช้ยังไง

```js
import { getFilterList } from '../api/index.js';

const data = await getFilterList();
console.log(JSON.stringify(data, null, 2));
```

ส่ง query string ได้ถ้าจำเป็น:

```js
await getFilterList({ someKey: 'value' });
```

---

## ที่คาดว่าจะได้

น่าจะเป็นชุดตัวเลือกของแถบตัวกรองบนหน้า Orders — แพลตฟอร์ม, ร้าน, คลัง, ช่วงเวลา
มีประโยชน์ตอนอยากส่ง `allOrder: false` ใน [`search-orders`](../search-orders/)
แล้วต้องรู้ว่าค่าที่ใส่ได้มีอะไรบ้าง

---

## ช่วยเติมข้อมูลตรงนี้

ยิง 1 ครั้งแล้วเอา response มาเติมในไฟล์นี้:

```bash
node -e "import('./api/index.js').then(a=>a.getFilterList()).then(d=>console.log(JSON.stringify(d,null,2)))"
```

แล้วอัปเดต JSDoc ใน [`index.js`](index.js) ว่า return อะไร
