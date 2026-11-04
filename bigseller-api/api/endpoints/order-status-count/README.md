# order-status-count — นับออเดอร์ตามสถานะ + ข้อมูลร้าน/คลัง

```
POST /api/v1/order/getOrderStatusCount.json
```

✅ **ยิงจริงแล้ว ผ่าน**

หน้าเว็บยิงตัวนี้พร้อมกับ [`search-orders`](../search-orders/) เสมอ — **body ชุดเดียวกันเป๊ะ**
ใช้ตอนอยากได้ยอดรวมโดยไม่ต้องดึงออเดอร์ทุกใบมานับเอง

---

## ใช้ยังไง

```js
import { getStatusCount } from '../api/index.js';

const data = await getStatusCount(orderNos);

console.log('ยกเลิกทั้งหมด:', data.statusCountMap.cancelSumCount);
console.log('ร้านที่ต่ออยู่:', data.shopLists);
```

---

## `getStatusCount(orderNos, opt?)`

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `orderNos` | — | `string` หรือ `string[]` |
| `opt.historyOrder` | `0` | `1` = นับในประวัติ (เกิน 90 วัน) |
| `opt.searchType` | `'orderNo'` | |
| `opt.allOrder` | `true` | |
| `opt.inquireType` | `2` | |

รับ `opt` ชุดเดียวกับ `searchOrders` แต่ **ไม่มี** `pageNo` / `pageSize` / `orderBy` / `desc` เพราะไม่ได้แบ่งหน้า

---

## response ที่ใช้ได้จริง

| path | คืออะไร |
|---|---|
| `data.statusCountMap.cancelSumCount` | จำนวนออเดอร์ที่ยกเลิก |
| `data.shopLists[]` | ร้านที่เชื่อมต่ออยู่ — `{id, name, platform, site}` |
| `data.warehouseMap` | `{ "56465": "Default Warehouse" }` |
| `data.platformStatusMap.tiktok[]` | ค่า status ของ TikTok ที่เอาไปใช้กรองได้ |

---

## body ที่ส่งออกไปจริง

```json
{
  "allOrder": true,
  "historyOrder": 0,
  "searchType": "orderNo",
  "searchContent": "585451537185604754,585518459275151310",
  "inquireType": 2
}
```

สร้างจาก [`../_shared/search-body.js`](../_shared/search-body.js) ล้วน ไม่มี field เพิ่มเลย
→ แก้ที่ไฟล์นั้นจะมีผลกับ `search-orders` ด้วย

---

## เกร็ด

`warehouseMap` กับ `shopLists` ไม่เกี่ยวกับเลขออเดอร์ที่ค้น — มันคืนรายชื่อร้าน/คลังทั้งบัญชีมาให้เสมอ
ถ้าแค่อยากได้รายชื่อร้าน ยิงตัวนี้ด้วยเลขมั่ว ๆ ก็ได้ ประหยัดกว่าไปหา endpoint อื่น
