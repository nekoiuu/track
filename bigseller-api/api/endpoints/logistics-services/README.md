# logistics-services — รายชื่อขนส่ง

```
GET /api/v1/order/constant/queryLogisticsServices.json
```

⚠️ **ยังไม่ได้เจาะ** — ดักเจอว่าหน้าเว็บเรียก แต่ยังไม่ได้ยิงดู response

---

## ใช้ยังไง

```js
import { getLogisticsServices } from '../api/index.js';

const data = await getLogisticsServices();
```

---

## ที่คาดว่าจะได้

รายชื่อขนส่งที่บัญชีนี้เลือกได้ (Flash, J&T, Kerry, SPX …) พร้อม id ของแต่ละเจ้า

path มีคำว่า `constant` → เป็นข้อมูลนิ่ง **ยิงครั้งเดียวแล้วเก็บไว้ใช้ยาว ๆ ได้**
ไม่ต้องยิงซ้ำทุกรอบ ประหยัดโควตา rate limit

---

## ช่วยเติมข้อมูลตรงนี้

```bash
node -e "import('./api/index.js').then(a=>a.getLogisticsServices()).then(d=>console.log(JSON.stringify(d,null,2)))"
```
