/* ============================================================
 * ยิงจาก Console ของหน้า bigseller.com โดยตรง
 * ข้อดี: ไม่ต้องยุ่งกับ cookie เลย (browser ส่งให้เอง)
 *
 * วิธีใช้: เปิด bigseller.com (ล็อกอินแล้ว) → F12 → Console → วางทั้งไฟล์
 * ============================================================ */

const BS = {
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'include',                 // ← cookie ติดไปเอง
      headers: { 'Content-Type': 'application/json', 'clientType': '1' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`${path} → ${j.msg}`);
    return j.data;
  },

  async search(orderNos, opt = {}) {
    const { historyOrder = 0, searchType = 'orderNo', inquireType = 2,
            pageNo = 1, pageSize = 50 } = opt;
    const d = await this.post('/api/v1/order/new/pageList.json', {
      allOrder: true, historyOrder, searchType,
      searchContent: [].concat(orderNos).join(','),
      inquireType, desc: 1, orderBy: 'orderTime', pageNo, pageSize,
    });
    return d.page;
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** ยิงทีละก้อน + หน่วงกัน rate limit */
async function fetchAll(nos, chunkSize = 50, delayMs = 1500) {
  const out = [];
  for (let i = 0; i < nos.length; i += chunkSize) {
    const chunk = nos.slice(i, i + chunkSize);
    const p = await BS.search(chunk, { pageSize: chunkSize });
    out.push(...p.rows);
    console.log(`ก้อน ${i / chunkSize + 1}: ขอ ${chunk.length} → ได้ ${p.rows.length}`);
    if (i + chunkSize < nos.length) await sleep(delayMs);
  }
  return out;
}

// ---- ใส่เลขออเดอร์ตรงนี้ (ก๊อปจาก data/order-numbers.json) ----
const ORDER_NOS = [
  '585451537185604754',
  '585518459275151310',
  '585503201170981907',
];

const rows = await fetchAll(ORDER_NOS);

console.table(rows.map(o => ({
  orderNo:   o.orderNo,
  status:    o.status,
  statusStr: o.statusStr,
  tracking:  o.trackingNo,
  platform:  o.platform,
})));

const found = new Set(rows.map(o => String(o.orderNo)));
console.log('ไม่เจอ:', ORDER_NOS.filter(n => !found.has(n)));

// เก็บไว้ใช้ต่อ
window.__rows = rows;

/* โหลดผลเป็นไฟล์ JSON:
copy(JSON.stringify(window.__rows, null, 2))   // ← ก๊อปลง clipboard
*/
