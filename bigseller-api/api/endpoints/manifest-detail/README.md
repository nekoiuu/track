# manifest-detail — เลขแทร็คกิ้งทั้งหมดในใบนำจ่าย

```
POST /api/v1/order/sign/manifest/detail.json      (form-urlencoded)
```

✅ **ยิงจริงแล้ว** (7 ต.ค. 2026) — `MFG963088665` ได้ครบ 20 กล่องใน 1 request (~0.4 วิ)

หาเจอจากโค้ดหน้าเว็บ `/web/order/sign/index.htm` (เมนูใบนำจ่าย) → ปุ่มดูรายละเอียดใบ
หน้าเว็บเรียกผ่าน `signingManagement.getDetails` = `axios.postForm`

> [`../manifests/`](../manifests/) (`pageList`) ได้แค่หัวใบ — 1 แถว/ใบ เห็นเลขแทร็คกิ้งแค่เลขแรก
> และ `manifestInfomation` คือ**จำนวนกล่องในใบ** ตัวนี้คือที่ได้รายการกล่องครบ

---

## ใช้ยังไง

```js
import { listManifestTrackings, getManifestDetail } from '../api/index.js';

const { trackingNos, totalSize } = await listManifestTrackings('MFG963098665');
// trackingNos = ['THT71035FT8A61Z', …]  (20 เลข)  totalSize = 20

// หน้าเดียว ได้ row ดิบ
const page = await getManifestDetail('MFG963088665', { pageSize: 50 });
```

---

## body (form) — แบบเดียวกับที่หน้าเว็บส่ง

| field | ค่า | คืออะไร |
|---|---|---|
| `orderSignNo` | `MFG963088665` | เลขใบนำจ่าย |
| `flag` | `1` | หน้าเว็บส่ง `1` เสมอตอนเปิดใบ |
| `pageNo` / `pageSize` | `1` / `1000` | หน้าเว็บใช้ 50 — ส่ง 1000 ให้จบหน้าเดียว |
| `searchType` | `orderNo` | `orderNo` หรือ `tackingNo` (สะกดตาม BigSeller) |
| `searchContent` | `''` | ว่าง = ทั้งใบ |

**ต้องส่งเป็น form** — `core/http.js` มี `postForm()` ให้แล้ว

## rows[]

`{ id, flag, puid, orderNo, trackingNo, storeName, shippingMethod, packageNo }`

`listManifestTrackings` วนหน้าให้เองถ้าเกิน `pageSize` และหยุดที่ `totalPage`
(หน้าเกินจริงของ BigSeller คืนหน้าสุดท้ายซ้ำ — ห้ามวนจนเจอหน้าว่าง)
