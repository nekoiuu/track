# endpoints — 1 endpoint = 1 โฟลเดอร์

แต่ละโฟลเดอร์มี 2 ไฟล์เท่านั้น

```
<ชื่อ-endpoint>/
├── index.js      PATH + ฟังก์ชันบาง ๆ ครอบ
└── README.md     วิธีใช้ พารามิเตอร์ response ข้อควรระวัง
```

เพิ่ม endpoint ใหม่ = สร้างโฟลเดอร์ใหม่ ไม่ต้องแตะของเดิม ไม่ต้องแตะ `core/`

---

## รายการทั้งหมด

| โฟลเดอร์ | method | ฟังก์ชัน | สถานะ |
|---|---|---|---|
| [`search-orders/`](search-orders/) | POST | `searchOrders` `searchOrdersBatch` | ✅ ยิงจริงแล้ว |
| [`order-status-count/`](order-status-count/) | POST | `getStatusCount` | ✅ ยิงจริงแล้ว |
| [`filter-list/`](filter-list/) | GET | `getFilterList` | ⚠️ ยังไม่ได้เจาะ |
| [`logistics-services/`](logistics-services/) | GET | `getLogisticsServices` | ⚠️ ยังไม่ได้เจาะ |
| [`search-config/`](search-config/) | GET | `getSearchConfigs` | ⚠️ ยังไม่ได้เจาะ |
| [`sync-check/`](sync-check/) | GET | `getSyncCheck` | ⚠️ ยังไม่ได้เจาะ |
| [`tiktok-fail-reason/`](tiktok-fail-reason/) | GET | `getTiktokFailReason` | ⚠️ ยังไม่ได้เจาะ |
| [`list-products/`](list-products/) | POST | `listProducts` `listProductsAll` `listProductsWithStock` | 🚧 path มีจริง แต่โดน 302 noPermission |
| [`product-stock/`](product-stock/) | POST | `listStock` `listStockAll` | 🚧 path มีจริง แต่โดน 302 noPermission |
| [`manifests/`](manifests/) | POST | `listManifests` `listManifestsAll` `findManifests` | ✅ ยิงจริงแล้ว |
| [`manifest-detail/`](manifest-detail/) | POST (form) | `listManifestTrackings` `getManifestDetail` | ✅ ยิงจริงแล้ว — เลขแทร็คกิ้งทั้งใบ |
| [`wave-packages/`](wave-packages/) | POST | `listWavePackages` `listWavePackagesAll` | ✅ ยิงจริงแล้ว (ต้อง Pro VIP) |
| [`wave-package-count/`](wave-package-count/) | POST | `getWavePackageCounts` | ✅ ยิงจริงแล้ว |
| [`wave-warehouses/`](wave-warehouses/) | POST | `listWaveWarehouses` | ✅ ยิงจริงแล้ว |
| [`wave-sidebar-count/`](wave-sidebar-count/) | POST | `getWaveSidebarCount` | ✅ ยิงจริงแล้ว |
| [`order-log/`](order-log/) | GET | `listOrderLog` `getOrderLog` `findOrderId` | ✅ ยิงจริงแล้ว — ใครสแกน/พิมพ์ |
| [`return-in-warehouse/`](return-in-warehouse/) | POST | `searchReturns` `findReturns` | ✅ ยิงจริงแล้ว — ของตีกลับถึงคลังหรือยัง |

**ยังไม่รู้ endpoint:** ปุ่ม **stock in** — วิธีหาอยู่ใน [`../README.md`](../README.md)

---

## `_shared/` ไม่ใช่ endpoint

| ไฟล์ | ใครใช้ |
|---|---|
| [`_shared/search-body.js`](_shared/search-body.js) | body ที่ `search-orders` กับ `order-status-count` ใช้ร่วมกัน (หน้าเว็บยิงสองตัวนี้พร้อมกันเสมอ body เหมือนกันเป๊ะ) |
| [`_shared/page.js`](_shared/page.js) | `pickPage` ทำให้ response ทุก pageList หน้าตาเหมือนกัน + `fetchAllPages` วนหน้าจนครบ — ใช้โดย `list-products` / `product-stock` |
| [`_shared/sku.js`](_shared/sku.js) | `skuOf` หา SKU จาก row เพื่อ join สินค้ากับสต็อก |
| [`_shared/wave-body.js`](_shared/wave-body.js) | body + ค่าคงที่ตัวกรองที่ `wave-packages` กับ `wave-package-count` ใช้ร่วมกัน |

แก้ไฟล์พวกนี้ = มีผลกับทุก endpoint ที่ใช้ ระวังด้วย

ขึ้นต้นด้วย `_` เพื่อให้เรียงมาก่อนและแยกออกจากโฟลเดอร์ endpoint จริง

---

## เพิ่ม endpoint ใหม่

**1.** สร้างโฟลเดอร์ + `index.js`

```js
import { post } from '../../core/http.js';

export const PATH = '/api/v1/order/stockIn.json';

/** ดันออเดอร์เข้าคลัง */
export function stockIn(orderIds) {
  return post(PATH, { orderIdList: [].concat(orderIds) });
}
```

`get` / `post` คืน **`data`** ที่แกะออกมาแล้ว (ไม่ใช่ทั้ง response)
ถ้า `code != 0` หรือโดนเด้งหน้า login มันโยน `BigSellerError` ให้เอง ไม่ต้องเช็คเอง

**2.** เติมใน [`../index.js`](../index.js) สองที่ — บล็อก `export` กับ `export default`

**3.** เขียน `README.md` ในโฟลเดอร์ ลอกโครงจาก [`search-orders/README.md`](search-orders/README.md)

**4.** เติมแถวในตารางข้างบน

---

## ของที่ได้ฟรีทุก endpoint

จัดการโดย [`../core/`](../core/) ไม่ต้องเขียนเอง

| | |
|---|---|
| header ครบ | `clientType: 1`, Cookie, UA + `Origin`/`Referer`/`Sec-Fetch-*` แบบเบราว์เซอร์ |
| เว้นระยะยิง | คิวเส้นเดียวทั้งโปรเจกต์ ห่างกัน `REQUEST_DELAY_MS` เอง ไม่ต้อง `sleep` |
| retry | โดน `"too frequent"` แล้วถอยรอเองสูงสุด `MAX_RETRIES` ครั้ง |
| error | แยกเป็น `no-cookie` / `auth` / `permission` / `rate-limit` / `api` / `network` พร้อม `.detail` |
