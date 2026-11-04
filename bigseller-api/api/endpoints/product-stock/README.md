# product-stock — สต็อก / ต้นทุน / คลัง

```
POST /api/v1/inventory/pageList.json
```

คู่กับ [`../list-products/`](../list-products/) — อันนั้นให้ "ข้อมูลสินค้า" อันนี้ให้ "ของในคลัง"

> 🚧 **โค้ดพร้อม แต่บัญชีนี้ยังยิงไม่ผ่าน** — อาการเดียวกับ list-products เป๊ะ
> `POST` → `302 /noPermissionPage.htm` (ด่านสิทธิ์), `GET` → `200 {code:-1}`, path มั่ว → `404`
> รายละเอียด + วิธีแยกอาการ → [`../list-products/README.md`](../list-products/README.md)

---

## ใช้ยังไง

```js
import { listStock, listStockAll } from '../api/index.js';

const page = await listStock({ pageSize: 100 });
const { rows } = await listStockAll({ pageSize: 100 });

// เฉพาะคลังเดียว
const { rows: wh } = await listStockAll({ warehouseId: 123 });

// เฉพาะ SKU
const { rows: some } = await listStockAll({ search: ['SKU-A', 'SKU-B'] });
```

ส่วนใหญ่ไม่ต้องเรียกตัวนี้ตรง ๆ — `listProductsWithStock()` เรียกให้แล้วพร้อม join

---

## พารามิเตอร์

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `opt.pageNo` | `1` | |
| `opt.pageSize` | `CHUNK_SIZE` (50) | |
| `opt.search` | — | คำค้น `string` / `string[]` |
| `opt.searchType` | `'sku'` | |
| `opt.warehouseId` | — | จำกัดเฉพาะคลังนี้ (ส่งผ่านไป body ตรง ๆ) |
| `opt.maxPages` | `20` | เฉพาะ `listStockAll` |
| **field อื่น ๆ** | — | ส่งผ่านไป body ตรง ๆ |

คืนรูปหน้าเดียวกับทุก endpoint ที่เป็น pageList (ผ่าน [`../_shared/page.js`](../_shared/page.js))

---

## SKU เดียวมีได้หลายแถว

1 SKU × 1 คลัง = 1 แถว — สินค้าที่อยู่ 3 คลังจะได้ 3 แถว
ตอน join `listProductsWithStock()` จึงเก็บเป็น array (`row.stock`) ไม่ใช่ object เดียว

---

## ยืนยันชื่อ field จริง

```js
const p = await listStock({ pageSize: 1 });
console.log(JSON.stringify(p.rows[0], null, 2));
```

หรือสนิฟจากหน้าเว็บด้วย [`../../../examples/sniffer.js`](../../../examples/sniffer.js) แล้วกรอง

```js
window.__cap.filter(r => /inventory\/pageList/.test(r.url))
```
