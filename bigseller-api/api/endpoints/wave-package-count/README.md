# wave-package-count — ตัวเลขนับข้างตัวกรอง

```
POST /api/v1/order/wave/getWaveOrderCountData.json
```

✅ **ยิงจริงแล้ว** (24 ก.ย. 2026) — หน้าเว็บยิงตัวนี้พร้อม `getWaveOrderPackageQuery` ทุกครั้ง

## ใช้ยังไง

```js
import { getWavePackageCounts } from '../api/index.js';

const c = await getWavePackageCounts({ days: 'today' });

c.platformCountMap        // { lazada: 63, tiktok: 3112, shopee: 794 }
c.shopCountMap            // { '2431669': 3079, '2400879': 63, ... }  ← id ร้าน ใช้กับ shopIds
c.shipProviderCountMap    // { '4231110': 3079, ... }
c.shipProviderList        // [{ id: 4231110, name: 'TikTok-TH-Flash Express Thailand', platform: 'tiktok', count: 3079 }, ...]
c.shipProviderGroupList   // [{ id, grepName: 'Flash', providerOpenIds: [4379705, 4230374, 4231110] }, ...]
```

## body

เหมือน [`../wave-packages/`](../wave-packages/) ทุกอย่าง **ยกเว้นไม่มี `pageNo` / `pageSize`**
ประกอบด้วย `buildWaveCountBody` ใน [`../_shared/wave-body.js`](../_shared/wave-body.js)

## ข้อควรรู้

- ตัวเลขเป็น **facet** — ส่ง `platforms: 'lazada'` ไปแล้ว `platformCountMap` ยังนับครบทุกแพลตฟอร์ม
  (ไม่ถูกกรองด้วย `platforms` / `shopIds` / `shipProviderIds`) ทดสอบแล้ว
- แต่ **ถูก**กรองด้วย `view` / เวลา / ค้นหา / เครื่องหมาย
- ใช้หา id สำหรับตัวกรอง:
  - `shipProviderList[].id` → `shipProviderIds`
  - `shipProviderGroupList[].providerOpenIds` → ส่งทั้งก้อนเป็น `shipProviderIds` = กรองตามกลุ่มขนส่ง
  - key ของ `shopCountMap` → `shopIds`
