/**
 * รายชื่อขนส่งที่เลือกได้
 * GET /api/v1/order/constant/queryLogisticsServices.json
 *
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';

export const PATH = '/api/v1/order/constant/queryLogisticsServices.json';

/** @param {object} [params] */
export const getLogisticsServices = params => get(PATH, params);
