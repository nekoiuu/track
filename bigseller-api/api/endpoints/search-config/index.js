/**
 * config ช่องค้นหา + id ที่ผู้ใช้ไม่ได้ติ๊ก
 * GET /api/v1/order/searchConfig/getSearchConfigsAndUncheckedIds.json
 *
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';

export const PATH = '/api/v1/order/searchConfig/getSearchConfigsAndUncheckedIds.json';

/** @param {object} [params] */
export const getSearchConfigs = params => get(PATH, params);
