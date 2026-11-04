# list-products — ลิสต์สินค้า

```
POST /api/v1/inventory/merchant/pageList.json
```

สินค้าในคลังของร้าน (master product) ไม่ใช่สินค้าฝั่งแพลตฟอร์ม

> 🚧 **โค้ดพร้อม แต่บัญชีนี้ยังยิงไม่ผ่าน** — ผลตรวจจริง (ยิงด้วย cookie ที่ใช้งานได้)
>
> | ยิงแบบไหน | ได้อะไรกลับมา | แปลว่า |
> |---|---|---|
> | `POST` path นี้ | `302 → /noPermissionPage.htm` | มี route จริง แต่โดน**ด่านสิทธิ์**กั้น |
> | `GET` path นี้ | `200 {code:-1 …}` | ทะลุด่านสิทธิ์ได้ แต่ handler ไม่รับ (endpoint นี้เป็น POST) |
> | `POST` path มั่ว | `404` | ยืนยันว่า path ข้างบน**มีอยู่จริง** ไม่ใช่พิมพ์ผิด |
> | `POST /api/v1/order/…` | `200 {code:0}` | cookie ใช้ได้ — ปัญหาอยู่ที่สิทธิ์ ไม่ใช่ auth |
>
> เปลี่ยน `Referer` เป็นหน้า inventory แล้วก็ยัง 302 เหมือนเดิม
> → ต้องเปิดสิทธิ์เมนูสินค้า/คลัง ให้บัญชีนี้ก่อน แล้วโค้ดจะทำงานทันทีโดยไม่ต้องแก้
>
> ชื่อ field ใน `rows[]` ข้างล่างจึงยังเป็นการเดา — ยืนยันด้วย `--raw` เมื่อยิงผ่านแล้ว

---

## ใช้ยังไง

```js
import { listProducts, listProductsAll, listProductsWithStock } from '../api/index.js';

// หน้าเดียว
const page = await listProducts({ pageSize: 100 });
console.log(page.totalSize, page.rows);

// ทุกหน้า
const { rows } = await listProductsAll({ pageSize: 100 });

// เฉพาะ SKU ที่ต้องการ
const { rows: some } = await listProductsAll({ search: ['SKU-A', 'SKU-B'] });

// สินค้า + สต็อก/ต้นทุน/คลัง ในก้อนเดียว
const { rows: full } = await listProductsWithStock({ pageSize: 100 });
// full[0].stock = [ { …แถวสต็อกของ SKU นี้ (มีหลายแถวถ้าหลายคลัง) } ]
```

สคริปต์พร้อมใช้ → [`../../../examples/list-products.js`](../../../examples/list-products.js)

---

## `listProducts(opt?)` — 1 หน้า

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `opt.pageNo` | `1` | หน้าที่เอา |
| `opt.pageSize` | `CHUNK_SIZE` (50) | กี่รายการต่อหน้า |
| `opt.search` | — | คำค้น `string` หรือ `string[]` — ต่อด้วย `,` ให้เอง ไม่ส่ง = เอาหมด |
| `opt.searchType` | `'sku'` | ค้นด้วย field ไหน |
| **field อื่น ๆ** | — | **ส่งผ่านไปที่ body ตรง ๆ** เช่น `{ warehouseId: 123 }` |

`...rest` ที่ส่งผ่านตรง ๆ คือทางออกตอนยังไม่รู้ body จริงครบ — สนิฟมาได้ field ไหน
ใส่เพิ่มได้เลยโดยไม่ต้องแก้ [`index.js`](index.js)

คืนหน้าที่ผ่าน [`../_shared/page.js`](../_shared/page.js) แล้ว — รูปเดียวกันเสมอ:

```js
{ pageNo: 1, pageSize: 100, totalPage: 3, totalSize: 240, rows: [...], raw: {...} }
```

> ต่างจาก `search-orders` ตรงที่**ไม่ต้องหยิบ `.page` เอง** — `pickPage()` แกะให้แล้ว
> ไม่ว่า BigSeller จะห่อมาเป็น `data.page` / `data.rows` / `data.list`
> ของดิบยังอยู่ที่ `.raw` เผื่อมี field พิเศษที่ยังไม่ได้แมป

---

## `listProductsAll(opt?)` — ทุกหน้า

เหมือน `listProducts` + สองตัวนี้:

| พารามิเตอร์ | ค่าเริ่มต้น | คืออะไร |
|---|---|---|
| `opt.maxPages` | `20` | เพดานจำนวนหน้า กันวนไม่รู้จบตอน `totalPage` เพี้ยน |
| `opt.quiet` | `false` | `true` = ไม่ต้อง log ความคืบหน้า |

```js
const { rows, totalSize, totalPage, truncated } = await listProductsAll();
// truncated: true = ยังไม่ครบ ชนเพดาน maxPages → เพิ่ม maxPages หรือ pageSize
```

ไม่ต้องหน่วงเอง — [`../../core/http.js`](../../core/http.js) จัดคิวเว้นระยะ `REQUEST_DELAY_MS` ให้ทุก request แล้ว

---

## `listProductsWithStock(opt?)` — สินค้า + สต็อก

ยิงสอง endpoint แล้ว join ด้วย SKU:

```
listProductsAll()  →  /api/v1/inventory/merchant/pageList.json   (ข้อมูลสินค้า)
listStockAll()     →  /api/v1/inventory/pageList.json            (สต็อก/ต้นทุน/คลัง)
```

| พารามิเตอร์ | คืออะไร |
|---|---|
| `opt.skuKey` | บังคับชื่อ field ที่ใช้ join — ไม่ส่ง = ไล่เดาตาม [`../_shared/sku.js`](../_shared/sku.js) |
| `opt.stock` | opt เฉพาะฝั่งสต็อก เช่น `{ warehouseId: 123 }` |

```js
{
  rows: [ { …สินค้า, sku: 'SKU-A', stock: [ …แถวสต็อกของ SKU นี้ ] } ],
  totalSize, truncated,
  unmatchedStock: ['SKU-Z'],   // มีสต็อกแต่ไม่มีสินค้าคู่ → แปลว่า join ผิด field
}
```

> `unmatchedStock` ยาวผิดปกติ = เดา field ผิด ส่ง `skuKey` ที่ถูกเข้าไป

---

## ยังไม่รู้ชื่อ field จริง — หายังไง

**1. ดูจากของจริง** (เร็วสุด ถ้า cookie ยังไม่หมดอายุ)

```bash
node examples/list-products.js --size 1 --pages 1 --raw
```

**2. สนิฟจากหน้าเว็บ** (ได้ body จริงที่หน้าเว็บส่งด้วย)

เปิดหน้า Products บน bigseller.com → F12 → Console → วาง
[`../../../examples/sniffer.js`](../../../examples/sniffer.js) → กดค้นหา/เปลี่ยนหน้า 1 ครั้ง → รัน

```js
window.__cap.filter(r => /inventory/.test(r.url))
```

ได้ body จริงมาแล้วเทียบกับ `buildProductBody()` ใน [`index.js`](index.js) — field ไหนขาด เติมได้เลย

---

## ข้อควรระวัง

- **`pageSize` ใหญ่ไปอาจโดนตีกลับ** ลองไล่จาก 50 → 100 → 200 ถ้าเจอ `code != 0` ให้ลดลง
- HTTP เป็น `200` เสมอแม้ตอน error — `core/http.js` เช็ค `code` ให้แล้ว
- แยกให้ออกระหว่างสองอาการ:
  - `302 → /noPermissionPage.htm` = **สิทธิ์ไม่พอ** (cookie ยังดีอยู่) → ให้ admin เปิดเมนูสินค้า/คลังให้บัญชีนี้
  - `code=2001 msg=…401006` หรือได้ HTML หน้า login = **cookie หมดอายุ** → ดึงใหม่ตาม [`../../../cookie/HOWTO.md`](../../../cookie/HOWTO.md)
