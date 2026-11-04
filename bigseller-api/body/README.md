# Body — field reference

ไฟล์ `.json` ในโฟลเดอร์นี้คือ payload จริงที่หน้าเว็บส่งออกไป
ก๊อปไปวางใน Postman / n8n / Make ได้เลย แล้วแก้แค่ `searchContent`

---

## `search-orders.json` → `POST /api/v1/order/new/pageList.json`

| field | type | ค่า | ความหมาย |
|---|---|---|---|
| `allOrder` | bool | `true` | โหมด "การค้นหาแบบรวม" — **ละเว้นตัวกรองทุกอัน** ค้นจากข้อมูลทั้งหมด<br>`false` = ค้นตามเงื่อนไขตัวกรองที่ตั้งไว้ |
| `historyOrder` | int | `0` | `0` = ออเดอร์ในรอบ 90 วัน<br>`1` = ประวัติคำสั่งซื้อ (เกิน 90 วัน) |
| `searchType` | string | `"orderNo"` | ค้นด้วยอะไร — ดูตารางด้านล่าง |
| `searchContent` | string | `"5855...,5854..."` | ค่าที่ค้น **หลายค่าได้** คั่นด้วย `,` หรือ `\n` |
| `inquireType` | int | `2` | `2` = แม่นยำ (exact match)<br>`1` = คลุมเครือ (fuzzy) |
| `desc` | int | `1` | `1` = มาก→น้อย, `0` = น้อย→มาก |
| `orderBy` | string | `"orderTime"` | field ที่ใช้เรียง |
| `pageNo` | int | `1` | หน้าที่เท่าไหร่ (เริ่มที่ 1) |
| `pageSize` | int | `50` | จำนวนต่อหน้า |

### ค่า `searchType` ที่รับ

| ค่า | ค้นจาก |
|---|---|
| `orderNo` | หมายเลขคำสั่งซื้อ |
| `platformOrderNo` | หมายเลขออเดอร์ฝั่งแพลตฟอร์ม |
| `trackingNo` | หมายเลขแทร็กกิ้ง |
| `packageNo` | หมายเลขพัสดุ |
| `buyerName` | ชื่อผู้ซื้อ |

---

## `order-status-count.json` → `POST /api/v1/order/getOrderStatusCount.json`

ใช้ field ชุดย่อยของอันบน — ตัด `desc` / `orderBy` / `pageNo` / `pageSize` ออก
(ส่งเต็มชุดไปก็ได้ ไม่ error)

---

## การแบ่งหน้า

`totalSize` > `pageSize` เมื่อไหร่ ให้วนยิงซ้ำโดยเพิ่ม `pageNo`
`totalPage` บอกไว้แล้วว่ามีกี่หน้า

```
pageNo: 1 → 2 → 3 ... จนถึง data.page.totalPage
```

---

## เช็ค error

HTTP status เป็น `200` เสมอ แม้ตอน error — ต้องดู `code` ใน body

```js
if (json.code !== 0) throw new Error(json.msg);
```

| อาการ | สาเหตุ |
|---|---|
| `msg: "The request is too frequent..."` | ยิงถี่เกิน เว้น ~1.5 วิ |
| `totalSize: 0` ทั้งที่รู้ว่ามีออเดอร์ | ลอง `historyOrder: 1` หรือเช็คว่าล็อกอินถูกบัญชี |
| redirect ไปหน้า login / `code` แปลก ๆ | cookie หมดอายุ → ดึงใหม่ |
