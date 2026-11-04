# order-log — บันทึกการทำงานของออเดอร์ (ใครสแกน / ใครพิมพ์)

```
GET /api/v1/order/operate/log.json?id={orderId}
```

✅ **ยิงจริงแล้ว** (7 ต.ค. 2026) — ออเดอร์ `2610070YVWAKT7` (orderId `16052149751`)
ได้ `james@G963010006 · สแกนและจัดส่งบน App และย้ายไปที่รอรับสินค้า · 07 ต.ค. 2026 10:38:59`

ที่มาของ endpoint → [`../../../../README.md`](../../../../README.md) (หน้ารายละเอียดคำสั่งซื้อ → บันทึกคำสั่งซื้อ)

---

## ใช้ยังไง

```js
import { findOrderId, listOrderLog, SCAN_PATTERN } from '../api/index.js';

const orderId = await findOrderId('2610070YVWAKT7');   // → '16052149751' (1 request ผ่าน searchOrders)
const log = await listOrderLog(orderId);               // 1 request
const scan = log.filter(e => SCAN_PATTERN.test(e.action)).at(-1);
// { at: '2026-10-07T03:38:59.000Z', user: 'james@G963010006', action: 'สแกนและจัดส่งบน App…', status: 'รอรับสินค้า' }
```

| ฟังก์ชัน | คืนอะไร |
|---|---|
| `getOrderLog(orderId)` | ข้อมูลดิบ `data[]` แบ่งกลุ่มตามสถานะ (ใหม่ → เก่า) |
| `listOrderLog(orderId)` | แบนเป็นแถวเดียว เรียงเก่า → ใหม่ `{ at, raw, user, action, status }` |
| `findOrderId(orderNo)` | เลขออเดอร์แพลตฟอร์ม → `orderId` ของ BigSeller |
| `findOrder(orderNo)` | `{ id, state, statusText, inCancel, returnNo }` — orderId + สถานะปัจจุบัน (`state` เช่น `pickup` = รอรับสินค้า) |
| `parseLogDate(s)` | `"07 ต.ค. 2026 10:38:59"` → `Date` (เวลาไทย) |

## response

```json
[{ "orderId": 16052149751, "orderStatus": "รอรับสินค้า", "minTime": "07 ต.ค. 2026 10:38:59",
   "beforeOperateLogDetails": [{ "userName": "james@G963010006", "contentKey": "สแกนและจัดส่งบน App และย้ายไปที่รอรับสินค้า", "operateDate": "07 ต.ค. 2026 10:38:59" }],
   "afterOperateLogDetails":  [{ "userName": "james@G963010006", "contentKey": "พิมพ์รายการจัดส่ง", "operateDate": "07 ต.ค. 2026 10:40:24" }] }]
```

- `beforeOperateLogDetails` = การกระทำที่ทำให้ **เข้า** สถานะนั้น · `afterOperateLogDetails` = ระหว่างอยู่ในสถานะ (อาจเป็น `null`)
- `userName` = `ชื่อ@รหัสบัญชีย่อย` หรือ `ซิงค์แพลตฟอร์ม`
- `contentKey` / `operateDate` เป็นข้อความตามภาษาบัญชี — `parseLogDate` รองรับเดือนไทยและอังกฤษ
