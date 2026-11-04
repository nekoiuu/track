/**
 * เหตุผลที่ยิงออเดอร์ TikTok ไม่ผ่าน
 * GET /api/v1/order/tiktok/getFailReason.json
 *
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';

export const PATH = '/api/v1/order/tiktok/getFailReason.json';

/** @param {object} [params] */
export const getTiktokFailReason = params => get(PATH, params);
