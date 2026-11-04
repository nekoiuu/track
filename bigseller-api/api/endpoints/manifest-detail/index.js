/**
 * รายละเอียดใบนำจ่าย — พัสดุ (เลขแทร็คกิ้ง) ทั้งหมดในใบ
 * POST /api/v1/order/sign/manifest/detail.json   (form-urlencoded)
 *
 * หาเจอจากโค้ดหน้าเว็บ /web/order/sign/index.htm → ปุ่มดูรายละเอียดใบ
 * (signingManagement.getDetails = axios.postForm) — วิธีใช้ → ./README.md
 */

import { postForm } from '../../core/http.js';
import { pickPage } from '../_shared/page.js';

export const PATH = '/api/v1/order/sign/manifest/detail.json';
/** ใบนึงไม่กี่สิบกล่อง ขอทีเดียวให้หมดในหน้าเดียว */
export const MAX_PAGE_SIZE = 1000;

/**
 * body แบบเดียวกับที่หน้าเว็บส่งตอนเปิดดูใบ
 * @param {string} manifestNo เช่น MFG963088665 (หน้าเว็บเรียก orderSignNo)
 * @param {object} [opt]
 */
export function buildManifestDetailBody(manifestNo, { pageNo = 1, pageSize = MAX_PAGE_SIZE, searchType = 'orderNo', searchContent = '' } = {}) {
  return { flag: 1, orderSignNo: String(manifestNo), pageNo, pageSize, searchType, searchContent };
}

/** 1 หน้า — rows: [{ flag, trackingNo, orderNo, storeName, shippingMethod }] */
export async function getManifestDetail(manifestNo, opt = {}) {
  return pickPage(await postForm(PATH, buildManifestDetailBody(manifestNo, opt)));
}

/**
 * เลขแทร็คกิ้งทั้งหมดในใบ — ปกติจบใน 1 request (pageSize ใหญ่)
 * ถ้าใบใหญ่เกินหน้าเดียวค่อยวนต่อ หยุดที่ totalPage (หน้าเกินจริงของ BigSeller คืนหน้าสุดท้ายซ้ำ)
 * @returns {Promise<{ trackingNos: string[], rows: object[], totalSize: number }>}
 */
export async function listManifestTrackings(manifestNo, { pageSize = MAX_PAGE_SIZE } = {}) {
  const first = await getManifestDetail(manifestNo, { pageSize });
  const rows = [...first.rows];
  for (let p = 2; p <= first.totalPage; p++) rows.push(...(await getManifestDetail(manifestNo, { pageNo: p, pageSize })).rows);

  const trackingNos = [...new Set(rows.map(r => String(r.trackingNo ?? '').trim()).filter(Boolean))];
  return { trackingNos, rows, totalSize: first.totalSize };
}
