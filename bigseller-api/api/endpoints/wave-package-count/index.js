/**
 * ตัวเลขนับข้างตัวกรอง (แพลตฟอร์ม / ร้าน / ขนส่ง) + รายชื่อขนส่ง + กลุ่มขนส่ง
 * POST /api/v1/order/wave/getWaveOrderCountData.json
 *
 * ✅ ยิงจริงแล้ว — body เหมือน wave-packages แต่ไม่มี pageNo/pageSize
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { buildWaveCountBody } from '../_shared/wave-body.js';
import { withWarehouses } from '../wave-warehouses/index.js';

export const PATH = '/api/v1/order/wave/getWaveOrderCountData.json';

/**
 * ตัวเลขเป็น facet: ไม่ถูกกรองด้วย platforms / shopIds / shipProviderIds
 * แต่ถูกกรองด้วย view / เวลา / ค้นหา / เครื่องหมาย
 *
 * @param {object} [opt] ตัวกรองชุดเดียวกับ listWavePackages
 * @returns {Promise<{platformCountMap:object,shopCountMap:object,shipProviderCountMap:object,shipProviderList:object[],shipProviderGroupList:object[],shopGroups:object|null}>}
 */
export async function getWavePackageCounts(opt = {}) {
  return post(PATH, buildWaveCountBody(await withWarehouses(opt)));
}
