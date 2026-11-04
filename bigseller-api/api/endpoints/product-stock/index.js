/**
 * สต็อก + ต้นทุน + คลัง ของแต่ละ SKU
 * POST /api/v1/inventory/pageList.json
 *
 * คู่กับ list-products/ — อันนั้นให้ "ข้อมูลสินค้า" อันนี้ให้ "ของในคลัง"
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { CHUNK_SIZE } from '../../core/config.js';
import { pickPage, fetchAllPages, MAX_PAGES } from '../_shared/page.js';

export const PATH = '/api/v1/inventory/pageList.json';

/**
 * ประกอบ body — field ที่ไม่รู้จักส่งผ่านไปตรง ๆ ได้เลย (`...rest`)
 * สนิฟ body จริงจากหน้าเว็บมาได้เมื่อไหร่ ใส่เพิ่มได้ทันทีโดยไม่ต้องแก้ไฟล์นี้
 *
 * @param {object} [opt]
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=CHUNK_SIZE]
 * @param {string|string[]} [opt.search] คำค้น (หลายค่าได้ ต่อด้วย , ให้เอง)
 * @param {string} [opt.searchType='sku']
 * @param {number} [opt.warehouseId] จำกัดเฉพาะคลังนี้
 */
export function buildStockBody(opt = {}) {
  const {
    pageNo     = 1,
    pageSize   = CHUNK_SIZE,
    search,
    searchType = 'sku',
    ...rest
  } = opt;

  const body = { pageNo, pageSize, ...rest };

  const content = [].concat(search ?? []).filter(Boolean).join(',');
  if (content) {
    body.searchType    = searchType;
    body.searchContent = content;
  }

  return body;
}

/**
 * ขอสต็อก 1 หน้า
 * @param {object} [opt] ดู buildStockBody
 * @returns {Promise<{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[],raw:object|null}>}
 */
export async function listStock(opt = {}) {
  return pickPage(await post(PATH, buildStockBody(opt)));
}

/**
 * วนทุกหน้าจนครบ
 * @param {object} [opt] เหมือน listStock + maxPages / quiet
 * @returns {Promise<{rows:object[], totalSize:number, totalPage:number, truncated:boolean}>}
 */
export function listStockAll(opt = {}) {
  const { maxPages = MAX_PAGES, quiet = false, ...rest } = opt;
  return fetchAllPages(
    pageNo => listStock({ ...rest, pageNo }),
    { maxPages, quiet, label: 'สต็อก' }
  );
}
