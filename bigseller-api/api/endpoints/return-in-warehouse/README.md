# return-in-warehouse — ของตีกลับถึงคลังแล้วหรือยัง

```
POST /api/v1/order/saleAfter/inWarehouse/search.json
```

✅ **ยิงจริงแล้ว ผ่าน** (ค้น `THT66015GN6U78Z` เจอ 1 แถว · ค้น 4 เลขคั่นขึ้นบรรทัดใหม่ได้ 3 แถว เลขที่ไม่มีถูกข้ามไปเฉย ๆ)

หน้าเว็บ: คำสั่งซื้อ → การจัดการหลังการขาย → **การคืนสินค้า Stock-In**
(`/web/order/inwarehouse/index.htm`) → ช่อง "หมายเลขแทร็คกิ้ง" แบบ "แม่นยำ"

---

## ใช้ยังไง

```js
import { findReturns } from '../api/index.js';

const map = await findReturns(['THT66015GN6U78Z']);
const r = map.get('THT66015GN6U78Z');
console.log(r?.returnStatusDesc, r?.inWarehouseStatusDesc, r?.returned);
// ยังไม่รับสินค้า  ยังไม่ Stock-In  false
```

| ฟังก์ชัน | คืออะไร |
|---|---|
| `findReturns(trackingNos)` | `Map<เลขแทร็ค(ตัวใหญ่), pickReturn>` · ค้นทีละ 50 เลข · ไม่เจอใน 90 วันค้นประวัติ (`history: 1`) ต่อ |
| `searchReturns(trackingNos, opt?)` | ยิงตรง คืน `{ total, rows }` ดิบ |
| `buildReturnSearchBody(trackingNos, opt?)` | body ที่หน้าเว็บส่ง |
| `pickReturn(row)` | ตัดเหลือช่องที่ใช้ + `returned` |

`opt`: `searchFieldName` (`TRACKING_NO` / `RETURN_TRACKING_NO`), `searchType` (`FULL` = แม่นยำ), `history` (`0`/`1`), `pageNo`, `pageSize`

⚠️ `history: 1` = ประวัติเกิน 90 วัน — BigSeller รับ body นี้ (code 0) แต่ยังไม่เคยเจอแถวที่มาจากประวัติจริง

---

## response ที่ใช้ได้จริง (`data.rows[]`)

| ช่อง | ตัวอย่าง | คืออะไร |
|---|---|---|
| `trackingNo` | `THT66015GN6U78Z` | เลขแทร็คขาออก |
| `orderNo` / `packageNo` | `586785908761789530` / `BSG9632022592` | |
| `returnStatus` | `NOT_PICKUP` | ดู `RETURN_STATUS` |
| `inWarehouseStatus` | `WAIT_IN_WAREHOUSE` | ดู `IN_WAREHOUSE_STATUS` |
| `returnTrackingNo` | `""` | เลขแทร็คขากลับ (ถ้ามี) |
| `arriveWarehouseTime` / `inWarehouseTime` | `""` | ถึงคลัง / Stock-In เมื่อไหร่ (ข้อความไทย เช่น `26 ต.ค. 2026 19:49`) |
| `saleAfterType` | `CANCEL_PICKUP` | `REFUND_RETURN` `ONLY_REFUND` `REPLACE_GOODS` `EXCEPTION_RETURN` `CANCEL_PICKUP` |
| `orderStatus` | `ยกเลิกแล้ว` | |

### `returnStatus`

| ค่า | หน้าเว็บ |
|---|---|
| `WAIT_RETURN` | รอคืนสินค้า |
| `RETURNING` | อยู่ระหว่างคืนสินค้า |
| `RETURNED` | คืนสินค้าแล้ว |
| `RETURN_FAIL` | การคืนสินค้าล้มเหลว |
| `LOST_PACKAGE` | สูญหาย |
| `NOT_PICKUP` | ยังไม่รับสินค้า |

### `inWarehouseStatus`

| ค่า | หน้าเว็บ |
|---|---|
| `WAIT_IN_WAREHOUSE` | ยังไม่ Stock-In |
| `PART_IN_WAREHOUSE` | Stock-In บางส่วน |
| `ALL_IN_WAREHOUSE` | Stock-In ทั้งหมด |
| `NOT_IN_WAREHOUSE` | ไม่ Stock-In |

`returned` ใน `pickReturn` = **`ALL_IN_WAREHOUSE` เท่านั้น**
- ไม่นับ `returnStatus === 'RETURNED'` — สถานะขนส่งขากลับของแพลตฟอร์ม ทดสอบจริง (27 ต.ค. 2026): `THT41125GN4WM2Z` Stock-In ครบแล้วแต่ `returnStatus` ยังเป็น `NOT_PICKUP`
- ไม่นับ `PART_IN_WAREHOUSE` — ของอาจยังไม่ครบ

ช่องเพิ่มใน `pickReturn`: `latestOperator` (คนล่าสุดที่ทำรายการ — หลัง Stock-In = คนกด เช่น `bank@G963080137`) · `inWarehouseAt` (ISO จาก `inWarehouseTime`)

`findReturns(trackingNos, { history: false })` = ไม่ค้นประวัติรอบสอง (ของที่ออกไม่ถึง 90 วัน)

---

## body ที่ส่งออกไปจริง

```json
{
  "inWarehouseStatus": "", "platform": "", "shopIdList": [], "warehouseId": "", "returnStatus": "",
  "labelFilterType": "ALL", "labelIdList": [], "shippingCarrier": "", "providerOpenIdList": [],
  "payMethod": "", "hasRemark": "", "saleAfterType": "", "source": null, "distributorCodeList": [],
  "arriveWarehouseTimeStart": "", "arriveWarehouseTimeEnd": "", "createOrderTimeStart": "", "createOrderTimeEnd": "",
  "orderShippedTimeStart": null, "orderShippedTimeEnd": null, "inWarehouseTimeStart": null, "inWarehouseTimeEnd": null,
  "searchFieldName": "TRACKING_NO", "searchType": "FULL", "searchContent": "THT66015GN6U78Z",
  "history": 0, "pageNo": 1, "pageSize": 50, "sortFieldName": "ARRIVE_WAREHOUSE_TIME", "sortType": "DESC"
}
```

ยอดตามตัวกรอง (สถานะ/ร้าน/แพลตฟอร์ม): `POST /api/v1/order/saleAfter/inWarehouse/filterConditionStat.json` body ชุดเดียวกัน — ยังไม่มี wrapper
