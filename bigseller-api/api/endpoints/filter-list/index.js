/**
 * รายการตัวกรองของหน้า Orders
 * GET /api/v1/order/v2/filterList.json
 *
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';

export const PATH = '/api/v1/order/v2/filterList.json';

/** @param {object} [params] query string (ยังไม่รู้ว่ารับอะไรบ้าง) */
export const getFilterList = params => get(PATH, params);
