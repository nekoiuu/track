# wave-sidebar-count — ตัวเลขเมนูซ้าย

```
POST /api/v1/order/wave/getWaveDetailsQuantityStatistics.json
```

✅ **ยิงจริงแล้ว** (24 ก.ย. 2026) — body `{}` ได้เลย (ส่ง `warehouseIdList` ไปก็ได้ตัวเลขเท่าเดิม)

## ใช้ยังไง

```js
import { getWaveSidebarCount } from '../api/index.js';

const n = await getWaveSidebarCount();
// { waiting: 3970, abnormal: 1, missing: 0, raw: { '4': 3970, '7': 1, '100': 0 } }
```

## response ดิบ

| key | เมนู |
|---|---|
| `"4"` | รอจัดส่ง |
| `"7"` | พัสดุผิดปกติ |
| `"100"` | ตำแหน่งของขาด |

key เป็นเลข `packageState` เดียวกับที่ใช้ใน [`../wave-packages/`](../wave-packages/) (ยกเว้น `100`)
ถูกกว่าการยิง `listWavePackages({ pageSize: 1 })` แล้วอ่าน `totalSize` — ได้ทุกเมนูใน request เดียว
