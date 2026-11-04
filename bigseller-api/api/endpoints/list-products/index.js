/**
 * ลิสต์สินค้า (คลังสินค้าของร้าน — ไม่ใช่สินค้าฝั่งแพลตฟอร์ม)
 * POST /api/v1/inventory/merchant/pageList.json
 *
 * เป็น endpoint หลักของงาน "list product"
 * ถ้าอยากได้สต็อก/ต้นทุนติดมาด้วย ใช้ listProductsWithStock()
 *
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { CHUNK_SIZE } from '../../core/config.js';
import { pickPage, fetchAllPages, MAX_PAGES } from '../_shared/page.js';
import { skuOf } from '../_shared/sku.js';
import { listStockAll } from '../product-stock/index.js';

export const PATH = '/api/v1/inventory/merchant/pageList.json';

/**
 * ประกอบ body — field ที่ไม่รู้จักส่งผ่านไปตรง ๆ ได้เลย (`...rest`)
 *
 * @param {object} [opt]
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=CHUNK_SIZE]
 * @param {string|string[]} [opt.search] คำค้น เช่น SKU หรือชื่อสินค้า (หลายค่าได้)
 * @param {string} [opt.searchType='sku'] ค้นด้วย field ไหน
 */
export function buildProductBody(opt = {}) {
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
 * ขอสินค้า 1 หน้า
 * @param {object} [opt] ดู buildProductBody
 * @returns {Promise<{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[],raw:object|null}>}
 */
export async function listProducts(opt = {}) {
  return pickPage(await post(PATH, buildProductBody(opt)));
}

/**
 * วนทุกหน้าจนครบ
 * @param {object} [opt] เหมือน listProducts + maxPages / quiet
 * @returns {Promise<{rows:object[], totalSize:number, totalPage:number, truncated:boolean}>}
 */
export function listProductsAll(opt = {}) {
  const { maxPages = MAX_PAGES, quiet = false, ...rest } = opt;
  return fetchAllPages(
    pageNo => listProducts({ ...rest, pageNo }),
    { maxPages, quiet, label: 'สินค้า' }
  );
}

/**
 * สินค้า + สต็อก ในก้อนเดียว — ยิงสอง endpoint แล้ว join ด้วย SKU
 *
 * ยิงเรียงกัน ไม่ใช่พร้อมกัน เพราะ core/http.js มีคิวเส้นเดียวอยู่แล้ว
 * ยิงพร้อมกันก็ไม่ได้เร็วขึ้น แถวสต็อกที่ไม่มีสินค้าคู่จะถูกทิ้ง (ดู unmatchedStock)
 *
 * @param {object} [opt]
 * @param {string} [opt.skuKey]   บังคับชื่อ field ที่ใช้ join (ไม่ส่ง = เดาให้ ดู _shared/sku.js)
 * @param {object} [opt.stock]    opt เฉพาะฝั่งสต็อก (เช่น { warehouseId })
 * @returns {Promise<{rows:object[], totalSize:number, truncated:boolean, unmatchedStock:string[]}>}
 */
export async function listProductsWithStock(opt = {}) {
  const { skuKey, stock: stockOpt = {}, ...rest } = opt;

  const products = await listProductsAll(rest);
  const stock    = await listStockAll({ pageSize: rest.pageSize, ...stockOpt });

  // สต็อก 1 SKU อาจมีหลายแถว (หลายคลัง) — เก็บเป็น array
  const bySku = new Map();
  for (const s of stock.rows) {
    const k = skuOf(s, skuKey);
    if (!k) continue;
    bySku.set(k, [...(bySku.get(k) ?? []), s]);
  }

  const used = new Set();
  const rows = products.rows.map(p => {
    const k = skuOf(p, skuKey);
    const matched = (k && bySku.get(k)) || [];
    if (matched.length) used.add(k);
    return { ...p, sku: k, stock: matched };
  });

  return {
    rows,
    totalSize: products.totalSize,
    truncated: products.truncated || stock.truncated,
    unmatchedStock: [...bySku.keys()].filter(k => !used.has(k)),
  };
}
