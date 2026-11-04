/**
 * คลังที่เปิด Wave + จำนวนพัสดุต่อคลัง
 * POST /api/v1/order/wave/waveWarehouseListWithCount.json
 *
 * ✅ ยิงจริงแล้ว — body ต้องมี type + tabStatus ไม่งั้นได้ "params error"
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { VIEWS, list } from '../_shared/wave-body.js';

export const PATH = '/api/v1/order/wave/waveWarehouseListWithCount.json';

/**
 * @param {object} [opt]
 * @param {'all'|'abnormal'|'shipped'} [opt.view='all'] count จะนับตาม view นี้
 * @returns {Promise<{id:number,name:string,count:number,isDefault:number,openWave:number}[]>}
 */
export async function listWaveWarehouses({ view = 'all' } = {}) {
  const body = { type: 3, packageState: VIEWS[view] ?? 4, tabStatus: 'printLabelMark' };
  return (await post(PATH, body)) || [];
}

/** เติม warehouseIds = ทุกคลัง ถ้ายังไม่ได้ส่งมา (หน้าเว็บก็ทำแบบนี้) */
export async function withWarehouses(opt = {}) {
  if (list(opt.warehouseIds).length) return opt;
  const whs = await listWaveWarehouses({ view: opt.view });
  return { ...opt, warehouseIds: whs.map(w => w.id) };
}
