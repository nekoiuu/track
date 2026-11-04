/**
 * ใบนำจ่าย (manifest) ที่พิมพ์ไปแล้ว
 * POST /api/v1/order/sign/manifest/pageList.json
 *
 * ✅ ยิงจริงผ่านแล้ว — พฤติกรรมทุกข้อข้างล่างทดสอบมาแล้ว ไม่ใช่การเดา
 * วิธีใช้ + ข้อควรระวัง → ./README.md
 */

import { post } from '../../core/http.js';
import { CHUNK_SIZE } from '../../core/config.js';
import { pickPage, fetchAllPages, MAX_PAGES } from '../_shared/page.js';

export const PATH = '/api/v1/order/sign/manifest/pageList.json';
/** pageSize ที่ยิงทดสอบแล้วรับจริง — 1000 ก็ยังคืนครบ */
export const MAX_PAGE_SIZE = 1000;

/**
 * ประกอบ body
 *
 * ค้นได้ทีละ 1 เลขออเดอร์เท่านั้น และ **ต้องส่ง `searchType: 'orderNo'` ด้วยเสมอ**
 * (ทดสอบแล้ว: ไม่ส่ง searchType → ได้ 0 / ส่งค่าอื่น → ได้ 0 / คั่นด้วย , หรือ \n → ได้ 0)
 *
 * @param {object} [opt]
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=CHUNK_SIZE] สูงสุด MAX_PAGE_SIZE
 * @param {string} [opt.orderNo] เลขออเดอร์ 1 เลข — ไม่ส่ง = เอาทั้งหมด
 */
export function buildManifestBody(opt = {}) {
  const { pageNo = 1, pageSize = CHUNK_SIZE, orderNo, ...rest } = opt;

  const body = { pageNo, pageSize, ...rest };

  if (orderNo) {
    body.searchType    = 'orderNo';   // ค่าอื่นใช้ไม่ได้ ห้ามเปลี่ยน
    body.searchContent = String(orderNo);
  }

  return body;
}

/**
 * ขอ 1 หน้า
 * @param {object} [opt] ดู buildManifestBody
 * @returns {Promise<{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[],raw:object|null}>}
 */
export async function listManifests(opt = {}) {
  return pickPage(await post(PATH, buildManifestBody(opt)));
}

/**
 * เอาทุกหน้า — ตั้ง pageSize ใหญ่ ๆ ไปเลยจะจบใน 2 request (1942 ใบ = 2 หน้า ที่ pageSize 1000)
 * @param {object} [opt] เหมือน listManifests + maxPages / quiet
 */
export function listManifestsAll(opt = {}) {
  const { maxPages = MAX_PAGES, quiet = false, pageSize = MAX_PAGE_SIZE, ...rest } = opt;
  return fetchAllPages(
    pageNo => listManifests({ ...rest, pageSize, pageNo }),
    { maxPages, quiet, label: 'ใบนำจ่าย' }
  );
}

/**
 * หาใบนำจ่ายของเลขออเดอร์ที่ระบุ — ยิงทีละเลขเพราะ API ไม่รับหลายเลขต่อ request
 * ไม่ต้อง sleep เอง core/http.js จัดคิวเว้นระยะให้แล้ว (ยิง N เลข = ใช้เวลา N × DELAY_MS)
 *
 * @param {string|string[]} orderNos
 * @returns {Promise<{rows:object[], missing:string[]}>}
 */
export async function findManifests(orderNos) {
  const list = [].concat(orderNos).filter(Boolean).map(String);
  const rows = [];

  for (const orderNo of list) {
    const page = await listManifests({ orderNo, pageSize: MAX_PAGE_SIZE });
    rows.push(...page.rows);
  }

  const found = new Set(rows.map(r => String(r.orderNo)));
  return { rows, missing: list.filter(n => !found.has(n)) };
}