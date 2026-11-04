/**
 * นับจำนวนออเดอร์ตามสถานะ + ข้อมูลร้าน/คลัง
 * POST /api/v1/order/getOrderStatusCount.json
 *
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { buildSearchBody } from '../_shared/search-body.js';

export const PATH = '/api/v1/order/getOrderStatusCount.json';

/**
 * ใช้ body ชุดเดียวกับ search-orders เป๊ะ — หน้าเว็บยิงสองตัวนี้พร้อมกันเสมอ
 *
 * @param {string|string[]} orderNos
 * @param {object} [opt] ดู _shared/search-body.js
 * @returns {Promise<{statusCountMap:object, shopLists:object[], warehouseMap:object, platformStatusMap:object}>}
 */
export function getStatusCount(orderNos, opt = {}) {
  return post(PATH, buildSearchBody(orderNos, opt));
}
