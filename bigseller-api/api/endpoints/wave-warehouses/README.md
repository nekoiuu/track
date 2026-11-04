# wave-warehouses — คลังที่เปิด Wave + จำนวนพัสดุ

```
POST /api/v1/order/wave/waveWarehouseListWithCount.json
```

✅ **ยิงจริงแล้ว** (24 ก.ย. 2026)

## ใช้ยังไง

```js
import { listWaveWarehouses } from '../api/index.js';

const whs = await listWaveWarehouses();              // นับตาม "รอจัดส่ง"
const bad = await listWaveWarehouses({ view: 'abnormal' });
// [{ id: 40694, name: 'Default Warehouse', count: 3969, isDefault: 1, openWave: 1, ... }]
```

## body

```json
{ "type": 3, "packageState": 4, "tabStatus": "printLabelMark" }
```

| field | ค่า |
|---|---|
| `type` | `3` = หน้าการจัดการพัสดุ (หน้า waitWave ใช้ `2`) |
| `packageState` | `4` รอจัดส่ง / `7` ผิดปกติ / `5` จัดส่งแล้ว — ตาม `view` |
| `tabStatus` | `'printLabelMark'` คงที่ |

⚠️ ส่ง `{}` หรือขาด `type` / `tabStatus` → `"params error"` (ทดสอบแล้ว)
⚠️ ต้องเป็น JSON — form-urlencoded ได้ `code:-1`

## `withWarehouses(opt)` (ตัวช่วยภายใน)

ถ้า `opt.warehouseIds` ว่าง จะยิง `listWaveWarehouses` แล้วเติม id ทุกคลังให้
`wave-packages` กับ `wave-package-count` ใช้ตัวนี้ — ทำแบบเดียวกับหน้าเว็บ

> ทดสอบแล้ว: ไม่ส่ง `warehouseIdList` เลย API ก็ยังตอบ (ได้ทุกคลัง) แต่เติมไว้ให้ตรงกับหน้าเว็บ
> อยากประหยัด 1 request ให้ส่ง `warehouseIds` เองไปเลย
