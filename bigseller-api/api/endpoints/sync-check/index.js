/**
 * เช็คสถานะ sync กับแพลตฟอร์ม
 * GET /api/v1/order/refreshSyncCheck.json
 *
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';

export const PATH = '/api/v1/order/refreshSyncCheck.json';

/** @param {object} [params] */
export const getSyncCheck = params => get(PATH, params);
