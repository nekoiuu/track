# sync-check — เช็คสถานะ sync กับแพลตฟอร์ม

```
GET /api/v1/order/refreshSyncCheck.json
```

⚠️ **ยังไม่ได้เจาะ** — ดักเจอว่าหน้าเว็บเรียก แต่ยังไม่ได้ยิงดู response

---

## ใช้ยังไง

```js
import { getSyncCheck } from '../api/index.js';

const data = await getSyncCheck();
```

---

## ที่คาดว่าจะได้

หน้าเว็บเรียกตอนกดปุ่ม refresh เพื่อถามว่า "ดึงออเดอร์จากแพลตฟอร์มเสร็จหรือยัง"
น่าจะคืนสถานะกำลัง sync / เสร็จแล้ว / เวลาที่ sync ล่าสุด

**มีประโยชน์ตรงนี้:** ถ้าค้นออเดอร์แล้วไม่เจอทั้งที่มีจริงบนแพลตฟอร์ม
อาจเป็นเพราะ BigSeller ยัง sync ไม่ถึง — เช็คตัวนี้ก่อนจะได้แยกออกว่า
"ไม่มีจริง" กับ "ยังไม่ sync" คนละเรื่องกัน

---

## ช่วยเติมข้อมูลตรงนี้

```bash
node -e "import('./api/index.js').then(a=>a.getSyncCheck()).then(d=>console.log(JSON.stringify(d,null,2)))"
```
