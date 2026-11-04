/**
 * body ที่ endpoint ตระกูล "ค้นออเดอร์" ใช้ร่วมกัน
 *
 * search-orders กับ order-status-count ส่ง body ชุดเดียวกันเป๊ะ
 * (หน้าเว็บยิงสองตัวนี้พร้อมกันเสมอ) — รวมไว้ที่เดียว
 * เวลา BigSeller เปลี่ยน field จะได้ไม่ต้องไล่แก้สองที่
 *
 * โฟลเดอร์ _shared ไม่ใช่ endpoint — ขึ้นต้นด้วย _ เพื่อให้เรียงมาก่อนและแยกออกจากกัน
 */

/**
 * @param {string|string[]} orderNos เลขออเดอร์ ตัวเดียวหรือหลายตัว
 * @param {object} [opt]
 * @param {boolean} [opt.allOrder=true]   true = โหมดค้นหาแบบรวม → ละเว้นตัวกรองทุกอัน
 * @param {0|1}     [opt.historyOrder=0]  1 = ค้นในประวัติ (ออเดอร์เกิน 90 วันย้ายไปอยู่ตรงนั้น)
 * @param {string}  [opt.searchType='orderNo']
 * @param {1|2}     [opt.inquireType=2]
 */
export function buildSearchBody(orderNos, opt = {}) {
  const {
    allOrder     = true,
    historyOrder = 0,
    searchType   = 'orderNo',
    inquireType  = 2,
  } = opt;

  return {
    allOrder,
    historyOrder,
    searchType,
    searchContent: [].concat(orderNos).join(','),
    inquireType,
  };
}
