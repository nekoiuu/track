/**
 * ตัวเลขเมนูซ้าย (การจัดการพัสดุ)
 * POST /api/v1/order/wave/getWaveDetailsQuantityStatistics.json
 *
 * ✅ ยิงจริงแล้ว — body ว่าง {} ได้เลย
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';

export const PATH = '/api/v1/order/wave/getWaveDetailsQuantityStatistics.json';

/** key ที่ได้กลับมา → ชื่อเมนู */
export const SIDEBAR_KEYS = {
  4:   'waiting',   // รอจัดส่ง
  7:   'abnormal',  // พัสดุผิดปกติ
  100: 'missing',   // ตำแหน่งของขาด
};

/**
 * @returns {Promise<{waiting:number, abnormal:number, missing:number, raw:object}>}
 */
export async function getWaveSidebarCount() {
  const raw = (await post(PATH, {})) || {};
  const out = { raw };
  for (const [k, name] of Object.entries(SIDEBAR_KEYS)) out[name] = Number(raw[k] ?? 0);
  return out;
}
