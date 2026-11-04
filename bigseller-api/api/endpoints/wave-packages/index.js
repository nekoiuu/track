/**
 * ลิสต์พัสดุในระบบ Wave (WMS → การจัดการพัสดุ)
 * POST /api/v1/order/wave/getWaveOrderPackageQuery.json
 *
 * หน้าเว็บ: /web/waveShip/packageManage/allPackages.htm
 * ✅ ยิงจริงแล้ว (24 ก.ย. 2026) — ต้องเป็นแพ็กเกจ Pro VIP ขึ้นไป
 * ตัวกรองทั้งหมด → ../_shared/wave-body.js   วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { pickPage, fetchAllPages, MAX_PAGES } from '../_shared/page.js';
import { buildWavePackageBody, MAX_PAGE_SIZE } from '../_shared/wave-body.js';
import { withWarehouses } from '../wave-warehouses/index.js';

export const PATH = '/api/v1/order/wave/getWaveOrderPackageQuery.json';

/**
 * 1 หน้า
 * @param {object} [opt] ดู buildWavePackageBody
 * @returns {Promise<{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[],raw:object|null}>}
 */
export async function listWavePackages(opt = {}) {
  return pickPage(await post(PATH, buildWavePackageBody(await withWarehouses(opt))));
}

/**
 * ทุกหน้า — pageSize ตั้ง 1000 ให้เลย (~4,000 ใบ = 4 request)
 * @param {object} [opt] เหมือน listWavePackages + maxPages / quiet
 */
export async function listWavePackagesAll(opt = {}) {
  const { maxPages = MAX_PAGES, quiet = false, pageSize = MAX_PAGE_SIZE, ...rest } = opt;
  const base = await withWarehouses(rest);   // ดึงคลังครั้งเดียว ไม่ต้องยิงซ้ำทุกหน้า
  return fetchAllPages(
    pageNo => listWavePackages({ ...base, pageSize, pageNo }),
    { maxPages, quiet, label: 'พัสดุ Wave' }
  );
}
