/**
 * ตัวช่วยเรื่อง "หน้า" ที่ endpoint ตระกูล pageList ใช้ร่วมกัน
 *
 * มีสองหน้าที่:
 *   1. pickPage      — ทำให้ response หน้าตาเหมือนกันหมด ไม่ว่า BigSeller
 *                      จะห่อมาเป็น data.page / data.rows / data.list หรือ array เปล่า ๆ
 *   2. fetchAllPages — วนหน้าจนครบ โดยมีเพดานกันวนไม่รู้จบ
 *
 * โฟลเดอร์ _shared ไม่ใช่ endpoint — ดู ./search-body.js ประกอบ
 */

/** เพดานจำนวนหน้าต่อ 1 คำสั่ง — กันยิงรัวตอน totalPage เพี้ยน */
export const MAX_PAGES = 20;

/** หน้าเปล่า ใช้เป็นค่าตั้งต้น */
const EMPTY = { pageNo: 1, pageSize: 0, totalPage: 0, totalSize: 0, rows: [], raw: null };

/**
 * แกะ `data` ที่ได้จาก post() ให้เป็นรูปหน้าเดียวกันเสมอ
 *
 * endpoint ฝั่ง order ห่อไว้ที่ `data.page` แต่ฝั่ง inventory บาง endpoint
 * คืน `data.rows` ตรง ๆ — เผลอหยิบผิดชั้นจะได้ undefined เงียบ ๆ
 * ตัวนี้รับได้ทั้งสองแบบ (และแบบ array เปล่า ๆ ด้วย)
 *
 * @param {object|any[]|null} data
 * @returns {{pageNo:number,pageSize:number,totalPage:number,totalSize:number,rows:object[],raw:object|null}}
 */
export function pickPage(data) {
  if (data == null) return { ...EMPTY };

  if (Array.isArray(data)) {
    return { pageNo: 1, pageSize: data.length, totalPage: 1, totalSize: data.length, rows: data, raw: null };
  }

  const p    = data.page ?? data;
  const rows = p.rows ?? p.list ?? p.records ?? p.dataList ?? [];

  return {
    pageNo:    Number(p.pageNo    ?? 1),
    pageSize:  Number(p.pageSize  ?? rows.length),
    totalPage: Number(p.totalPage ?? 1),
    totalSize: Number(p.totalSize ?? p.total ?? rows.length),
    rows,
    raw: p,          // ของดิบ เผื่อ endpoint นั้นมี field พิเศษที่ยังไม่ได้แมป
  };
}

/**
 * วนหน้าจนครบ — ไม่ต้อง sleep เอง core/http.js จัดคิวเว้นระยะให้แล้ว
 *
 * @param {(pageNo:number)=>Promise<ReturnType<typeof pickPage>>} fetchPage ยิง 1 หน้า
 * @param {object} [opt]
 * @param {number} [opt.maxPages=MAX_PAGES] เพดานจำนวนหน้า
 * @param {string} [opt.label='']           ชื่อที่ใช้ตอน log
 * @param {boolean}[opt.quiet=false]        true = ไม่ต้อง log ความคืบหน้า
 * @returns {Promise<{rows:object[], totalSize:number, totalPage:number, truncated:boolean}>}
 */
export async function fetchAllPages(fetchPage, opt = {}) {
  const { maxPages = MAX_PAGES, label = '', quiet = false } = opt;

  const first = await fetchPage(1);
  const rows  = [...first.rows];

  const totalPage = Math.max(first.totalPage || 1, 1);
  const stopAt    = Math.min(totalPage, maxPages);

  for (let p = 2; p <= stopAt; p++) {
    const page = await fetchPage(p);
    if (!page.rows.length) break;           // หน้าว่าง = จบจริง ไม่ต้องยิงต่อ
    rows.push(...page.rows);
    if (!quiet) console.log(`  ${label} หน้า ${p}/${stopAt} → รวม ${rows.length} รายการ`);
  }

  const truncated = totalPage > stopAt;
  if (truncated) {
    console.warn(
      `⚠ ${label} มี ${totalPage} หน้า แต่หยุดที่ ${stopAt} (เพดาน maxPages)\n` +
      `  อยากได้ครบสั่ง { maxPages: ${totalPage} } หรือเพิ่ม pageSize`
    );
  }

  return { rows, totalSize: first.totalSize, totalPage, truncated };
}
