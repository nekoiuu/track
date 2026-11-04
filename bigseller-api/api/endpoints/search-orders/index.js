/**
 * ค้นหา / ลิสต์ออเดอร์
 * POST /api/v1/order/new/pageList.json
 *
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { CHUNK_SIZE } from '../../core/config.js';
import { buildSearchBody } from '../_shared/search-body.js';

export const PATH = '/api/v1/order/new/pageList.json';

/**
 * ค้น 1 หน้า
 *
 * @param {string|string[]} orderNos
 * @param {object} [opt]
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=CHUNK_SIZE]
 * @param {string} [opt.orderBy='orderTime']
 * @param {0|1}    [opt.desc=1]
 * @param {0|1}    [opt.historyOrder] ส่งต่อให้ buildSearchBody
 * @param {string} [opt.searchType]
 * @param {boolean}[opt.allOrder]
 * @returns {Promise<{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[]}>}
 */
export async function searchOrders(orderNos, opt = {}) {
  const {
    pageNo   = 1,
    pageSize = CHUNK_SIZE,
    orderBy  = 'orderTime',
    desc     = 1,
  } = opt;

  const data = await post(PATH, {
    ...buildSearchBody(orderNos, opt),
    desc,
    orderBy,
    pageNo,
    pageSize,
  });

  return data.page;   // ข้อมูลอยู่ที่ data.page.rows ไม่ใช่ data.rows
}

/**
 * ค้นทีละก้อน + วนหน้าให้ครบเอง + บอกด้วยว่าเลขไหนไม่เจอ
 * ไม่ต้อง sleep เอง — core/http.js จัดคิวเว้นระยะให้ทุก request อยู่แล้ว
 *
 * @param {string[]} orderNos
 * @param {object} [opt] ส่งต่อให้ searchOrders
 * @returns {Promise<{rows:object[], missing:string[]}>}
 */
export async function searchOrdersBatch(orderNos, opt = {}) {
  const rows = [];

  for (let i = 0; i < orderNos.length; i += CHUNK_SIZE) {
    const chunk = orderNos.slice(i, i + CHUNK_SIZE);
    const n = Math.floor(i / CHUNK_SIZE) + 1;

    let page = await searchOrders(chunk, opt);
    rows.push(...page.rows);
    const { totalPage, totalSize } = page;

    for (let p = 2; p <= totalPage; p++) {
      page = await searchOrders(chunk, { ...opt, pageNo: p });
      rows.push(...page.rows);
    }

    console.log(`ก้อน ${n}: ขอ ${chunk.length} → ได้ ${totalSize} (${totalPage} หน้า)`);
  }

  const found   = new Set(rows.map(o => String(o.orderNo)));
  const missing = orderNos.filter(n => !found.has(String(n)));

  return { rows, missing };
}
