/**
 * บันทึกการทำงานของออเดอร์ (Order Operate Log) — ใคร ทำอะไร เมื่อไหร่
 * GET /api/v1/order/operate/log.json?id={orderId}
 *
 * orderId = ID ภายในของ BigSeller (เช่น 16052149751) ไม่ใช่เลขออเดอร์แพลตฟอร์ม
 * → หาจาก searchOrders(orderNo).rows[0].id · findOrderId ทำให้แล้ว
 * วิธีใช้ → ./README.md
 */

import { get } from '../../core/http.js';
import { searchOrders } from '../search-orders/index.js';

export const PATH = '/api/v1/order/operate/log.json';

/** ข้อความ log ที่แปลว่า "สแกนส่งของ" (ภาษาไทย/อังกฤษ ตามที่ตั้งบัญชี) */
export const SCAN_PATTERN = /สแกน|scan/i;

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * "07 ต.ค. 2026 10:38:59" (เวลาไทย ปี ค.ศ.) → Date · อ่านไม่ออกคืน null
 * @param {string} s
 */
export function parseLogDate(s) {
  // วินาทีไม่บังคับ — หน้าคืนสินค้าส่งมาแค่ "26 ต.ค. 2026 23:15"
  const m = /^(\d{1,2})\s+(\S+)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, d, mon, y, hh, mm, ss = '00'] = m;
  let i = TH_MONTHS.indexOf(mon);
  if (i < 0) i = EN_MONTHS.indexOf(mon.slice(0, 3).toLowerCase());
  if (i < 0) return null;
  const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);   // เผื่อบัญชีตั้งเป็น พ.ศ.
  const iso = `${year}-${String(i + 1).padStart(2, '0')}-${d.padStart(2, '0')}T${hh}:${mm}:${ss}+07:00`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ข้อมูลดิบ — data[] แบ่งกลุ่มตามสถานะ (ใหม่ → เก่า) */
export async function getOrderLog(orderId) {
  return get(PATH, { id: String(orderId) });
}

/**
 * log แบบแบน เรียงเก่า → ใหม่
 * @returns {Promise<{ at: string|null, raw: string, user: string, action: string, status: string }[]>}
 *   at = ISO string (null ถ้าอ่านวันที่ไม่ออก) · raw = วันที่ตามที่ BigSeller ส่งมา
 */
export async function listOrderLog(orderId) {
  const groups = (await getOrderLog(orderId)) ?? [];
  const out = [];
  for (const g of groups) {
    for (const e of [...(g.beforeOperateLogDetails ?? []), ...(g.afterOperateLogDetails ?? [])]) {
      out.push({
        at: parseLogDate(e.operateDate)?.toISOString() ?? null,
        raw: String(e.operateDate ?? ''),
        user: String(e.userName ?? ''),
        action: String(e.contentKey ?? ''),
        status: String(g.orderStatus ?? ''),
      });
    }
  }
  return out.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
}

/**
 * เลขออเดอร์แพลตฟอร์ม (เช่น 2610070YVWAKT7) → orderId ของ BigSeller
 * @returns {Promise<string|null>}
 */
export async function findOrderId(orderNo) {
  return (await findOrder(orderNo))?.id ?? null;
}

/**
 * เลขออเดอร์แพลตฟอร์ม → orderId + สถานะปัจจุบันใน BigSeller (1 request)
 * state = โค้ดสถานะ เช่น 'pickup' (รอรับสินค้า) · statusText = ชื่อตามภาษาบัญชี
 * @returns {Promise<{ id: string, state: string, statusText: string, inCancel: boolean, returnNo: string|null } | null>}
 */
export async function findOrder(orderNo) {
  const page = await searchOrders(String(orderNo), { pageSize: 5 });
  const row = page?.rows?.[0];
  if (row?.id == null) return null;
  return {
    id: String(row.id),
    state: String(row.state ?? ''),
    statusText: String(row.multilingualViewStatus ?? row.viewStatus ?? ''),
    inCancel: Boolean(row.inCancel),
    returnNo: row.returnNo ? String(row.returnNo) : null,
  };
}
