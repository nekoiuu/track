/**
 * ค้นพัสดุตีกลับในหน้า "การคืนสินค้า Stock-In" — ดูว่าของคืนถึงคลังแล้วหรือยัง
 * POST /api/v1/order/saleAfter/inWarehouse/search.json
 *
 * วิธีใช้ → ./README.md
 */

import { post } from '../../core/http.js';
import { parseLogDate } from '../order-log/index.js';

export const PATH = '/api/v1/order/saleAfter/inWarehouse/search.json';

/** สถานะการคืนสินค้า (returnStatus) — ค่าจาก filterConditionStat.json */
export const RETURN_STATUS = {
  WAIT_RETURN: 'รอคืนสินค้า',
  RETURNING: 'อยู่ระหว่างคืนสินค้า',
  RETURNED: 'คืนสินค้าแล้ว',
  RETURN_FAIL: 'การคืนสินค้าล้มเหลว',
  LOST_PACKAGE: 'สูญหาย',
  NOT_PICKUP: 'ยังไม่รับสินค้า',
};

/** สถานะ Stock-In (inWarehouseStatus) */
export const IN_WAREHOUSE_STATUS = {
  WAIT_IN_WAREHOUSE: 'ยังไม่ Stock-In',
  PART_IN_WAREHOUSE: 'Stock-In บางส่วน',
  ALL_IN_WAREHOUSE: 'Stock-In ทั้งหมด',
  NOT_IN_WAREHOUSE: 'ไม่ Stock-In',
};

/** ช่องค้นหา (searchFieldName) */
export const SEARCH_FIELDS = { TRACKING_NO: 'TRACKING_NO', RETURN_TRACKING_NO: 'RETURN_TRACKING_NO' };

/**
 * body เหมือนที่หน้าเว็บส่งเป๊ะ (ตัวกรองว่างทั้งหมด เหลือแค่ช่องค้นหา)
 * ค้นหลายเลขพร้อมกันได้ — หน้าเว็บคั่นด้วยขึ้นบรรทัดใหม่
 *
 * @param {string|string[]} trackingNos
 * @param {object} [opt]
 * @param {string} [opt.searchFieldName='TRACKING_NO']
 * @param {'FULL'|'LIKE'} [opt.searchType='FULL'] FULL = ตรงเป๊ะ (หน้าเว็บ: "แม่นยำ")
 * @param {0|1} [opt.history=0] 1 = ค้นในประวัติ (หลังการขายเกิน 90 วัน)
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=50]
 */
export function buildReturnSearchBody(trackingNos, opt = {}) {
  const list = (Array.isArray(trackingNos) ? trackingNos : [trackingNos]).map((s) => String(s).trim()).filter(Boolean);
  return {
    inWarehouseStatus: '',
    platform: '',
    shopIdList: [],
    warehouseId: '',
    returnStatus: '',
    labelFilterType: 'ALL',
    labelIdList: [],
    shippingCarrier: '',
    providerOpenIdList: [],
    payMethod: '',
    hasRemark: '',
    saleAfterType: '',
    source: null,
    distributorCodeList: [],
    arriveWarehouseTimeStart: '',
    arriveWarehouseTimeEnd: '',
    createOrderTimeStart: '',
    createOrderTimeEnd: '',
    orderShippedTimeStart: null,
    orderShippedTimeEnd: null,
    inWarehouseTimeStart: null,
    inWarehouseTimeEnd: null,
    searchFieldName: opt.searchFieldName ?? SEARCH_FIELDS.TRACKING_NO,
    searchType: opt.searchType ?? 'FULL',
    searchContent: list.join('\n'),
    history: opt.history ?? 0,
    pageNo: opt.pageNo ?? 1,
    pageSize: opt.pageSize ?? 50,
    sortFieldName: 'ARRIVE_WAREHOUSE_TIME',
    sortType: 'DESC',
  };
}

/**
 * ยิงตรง — คืน data ดิบของ BigSeller
 * @returns {Promise<{total:number, rows:object[]}>}
 */
export function searchReturns(trackingNos, opt = {}) {
  return post(PATH, buildReturnSearchBody(trackingNos, opt));
}

/** row ดิบ → เฉพาะช่องที่ใช้ตัดสินว่าได้ของคืนแล้วหรือยัง */
export function pickReturn(row) {
  return {
    trackingNo: row.trackingNo,
    orderNo: row.orderNo || null,
    packageNo: row.packageNo || null,
    platform: row.platform || null,
    shopName: row.shopName || null,
    orderStatus: row.orderStatus || null,
    saleAfterType: row.saleAfterType || null,
    saleAfterTypeDesc: row.saleAfterTypeDesc || null,
    returnStatus: row.returnStatus || null,
    returnStatusDesc: row.returnStatusDesc || null,
    inWarehouseStatus: row.inWarehouseStatus || null,
    inWarehouseStatusDesc: row.inWarehouseStatusDesc || null,
    returnTrackingNo: row.returnTrackingNo || null,
    arriveWarehouseTime: row.arriveWarehouseTime || null,
    inWarehouseTime: row.inWarehouseTime || null,
    /** inWarehouseTime เป็น ISO (เวลาไทย → UTC) · null = ยังไม่ Stock-In / อ่านไม่ออก */
    inWarehouseAt: parseLogDate(row.inWarehouseTime)?.toISOString() ?? null,
    /** คนล่าสุดที่ทำรายการนี้ — หลัง Stock-In = คนกด Stock-In (เช่น bank@G963080137) */
    latestOperator: row.latestOperator || null,
    // ได้ของคืนแล้ว = Stock-In เข้าคลังครบแล้วเท่านั้น
    // ไม่นับ returnStatus RETURNED (สถานะขนส่งขากลับของแพลตฟอร์ม — ทดสอบแล้ว Stock-In ครบแต่ยังขึ้น NOT_PICKUP ได้)
    // ไม่นับ PART_IN_WAREHOUSE (ของอาจยังไม่ครบ ให้คนเช็คเอง)
    returned: row.inWarehouseStatus === 'ALL_IN_WAREHOUSE',
  };
}

/**
 * สถานะคืนของแต่ละเลขแทร็ค — ค้นทีละ 50 เลข ไม่เจอใน 90 วันค่อยค้นในประวัติอีกรอบ
 * @param {string[]} trackingNos
 * @param {object} [opt]
 * @param {boolean} [opt.history=true] false = ไม่ค้นประวัติ (ของที่ออกไม่ถึง 90 วัน — ประหยัด request)
 * @returns {Promise<Map<string, ReturnType<typeof pickReturn>>>} เลขที่ไม่เจอจะไม่อยู่ใน Map
 */
export async function findReturns(trackingNos, { history: withHistory = true } = {}) {
  const want = [...new Set(trackingNos.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
  const found = new Map();
  for (const history of withHistory ? [0, 1] : [0]) {
    const left = want.filter((t) => !found.has(t));
    for (let i = 0; i < left.length; i += 50) {
      const chunk = left.slice(i, i + 50);
      const data = await searchReturns(chunk, { history, pageSize: 100 });
      for (const row of data?.rows ?? []) {
        const key = String(row.trackingNo ?? '').toUpperCase();
        if (chunk.includes(key) && !found.has(key)) found.set(key, pickReturn(row));
      }
    }
  }
  return found;
}
