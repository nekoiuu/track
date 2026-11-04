# search-config — config ช่องค้นหา

```
GET /api/v1/order/searchConfig/getSearchConfigsAndUncheckedIds.json
```

⚠️ **ยังไม่ได้เจาะ** — ดักเจอว่าหน้าเว็บเรียก แต่ยังไม่ได้ยิงดู response

---

## ใช้ยังไง

```js
import { getSearchConfigs } from '../api/index.js';

const data = await getSearchConfigs();
```

---

## ที่คาดว่าจะได้

ชื่อบอกว่าคืนสองอย่าง: **searchConfigs** (ช่องค้นหามีอะไรให้เลือกบ้าง) กับ
**uncheckedIds** (อันไหนที่ผู้ใช้ไม่ได้ติ๊ก)

ตัว searchConfigs น่าจะเป็นที่มาของค่า `searchType` ที่ใส่ได้ใน [`search-orders`](../search-orders/)
ตอนนี้เรารู้แค่ `'orderNo'` ตัวเดียว — ยิงตัวนี้น่าจะได้ครบว่าค้นด้วยอะไรได้อีก
(เลขพัสดุ / ชื่อลูกค้า / SKU …)

---

## ช่วยเติมข้อมูลตรงนี้

```bash
node -e "import('./api/index.js').then(a=>a.getSearchConfigs()).then(d=>console.log(JSON.stringify(d,null,2)))"
```

ถ้าเจอรายชื่อ `searchType` ให้เอาไปเติมในตารางของ [`../search-orders/README.md`](../search-orders/README.md) ด้วย
