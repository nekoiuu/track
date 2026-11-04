/**
 * body ที่ endpoint ตระกูล Wave (WMS → การจัดการพัสดุ) ใช้ร่วมกัน
 *
 * wave-packages กับ wave-package-count ส่ง body ชุดเดียวกัน
 * (หน้าเว็บยิงสองตัวนี้พร้อมกันเสมอ ต่างกันแค่ count ไม่มี pageNo/pageSize)
 * ✅ ทุก field ทดสอบกับ API จริงแล้ว (24 ก.ย. 2026) — ตารางแมปอยู่ใน ../wave-packages/README.md
 *
 * โฟลเดอร์ _shared ไม่ใช่ endpoint
 */

/** ยิงทดสอบแล้ว 1000 ก็ยังคืนครบ (หน้าเว็บให้เลือกแค่ 50/100/300) */
export const MAX_PAGE_SIZE = 1000;

/** เมนูซ้าย → packageState ที่หน้าเว็บส่ง */
export const VIEWS = {
  all:      4,  // "รอจัดส่ง" (allPackages)
  abnormal: 7,  // "พัสดุผิดปกติ" — timeType ต้องเป็น null
  shipped:  5,  // "จัดส่งแล้ว"
};

/** เลือกเวลา → timeType */
export const TIME_TYPES = {
  order:   1,  // เวลาสั่งซื้อ (ค่าเริ่มต้น)
  expire:  7,  // เวลาหมดอายุ
  confirm: 8,  // เวลายืนยัน
  print:   3,  // เวลาพิมพ์
};

/** ช่องค้นหา → searchType (สะกด tackingNo ตามของ BigSeller เป๊ะ ๆ) */
export const SEARCH_TYPES = {
  packageNo:    'packageNo',     // หมายเลขพัสดุ        แม่นยำเท่านั้น
  waveNo:       'waveNo',        // หมายเลข Wave        แม่นยำเท่านั้น
  orderNo:      'orderNo',       // หมายเลขคำสั่งซื้อ    แม่นยำเท่านั้น
  trackingNo:   'tackingNo',     // หมายเลขแทร็คกิ้ง     แม่นยำเท่านั้น
  sku:          'commoditySku',  // SKU Merchant        แม่นยำ / คลุมเครือ
  picker:       'picker',        // ผู้หยิบของ           คลุมเครือเท่านั้น
  packer:       'packer',        // ผู้แพ็กสินค้า         คลุมเครือเท่านั้น
};

/** เครื่องหมายคำสั่งซื้อ → hasLable */
const MARKS = { none: 0, any: 1, all: 2 };

const DAYS = { today: 0, yesterday: 1 };

export const list = v => (v == null || v === '' ? [] : [].concat(v));
const fmtDate = d => {
  if (!(d instanceof Date)) return String(d);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * ประกอบ body แบบเดียวกับที่หน้าเว็บส่ง (ค่าว่าง/null ถูกตัดทิ้งเหมือน getParams ของหน้าเว็บ)
 *
 * @param {object} [opt]
 * @param {number} [opt.pageNo=1]
 * @param {number} [opt.pageSize=50]               สูงสุด MAX_PAGE_SIZE
 * @param {'all'|'abnormal'|'shipped'} [opt.view='all']
 * @param {number} [opt.packageState]              ส่งตรง ๆ ทับ view (1 รอหยิบ, 8 รอคัดแยก, 2 รอบรรจุ, 3 กำลังบรรจุ ...)
 * @param {number|number[]} [opt.warehouseIds]     ไม่ส่ง = ทุกคลัง (ดึงจาก listWaveWarehouses ให้)
 * @param {string|string[]} [opt.platforms]        'shopee' | 'lazada' | 'tiktok'
 * @param {number|number[]} [opt.shopIds]
 * @param {number|number[]} [opt.shipProviderIds]  id ขนส่ง (providerOpenIds) — ดูจาก getWavePackageCounts().shipProviderList
 * @param {'none'|'any'|'all'} [opt.mark]          none = ไม่มีเครื่องหมาย, any = มีอย่างใดอย่างหนึ่งใน markIds, all = มีครบทุกอัน
 * @param {number|number[]} [opt.markIds]          id เครื่องหมาย — **จำเป็น** สำหรับ any/all (ไม่ส่งจะได้ "ไม่พบแท็ก")
 * @param {'order'|'expire'|'confirm'|'print'} [opt.timeType='order']
 * @param {'today'|'yesterday'|0|1|3|7|30} [opt.days]
 * @param {string|Date} [opt.from]                 กำหนดเอง 'YYYY-MM-DD HH:mm:ss' หรือ Date
 * @param {string|Date} [opt.to]
 * @param {keyof SEARCH_TYPES|string} [opt.searchType='packageNo']
 * @param {string|string[]} [opt.search]           หลายค่าคั่น , ได้
 * @param {boolean} [opt.fuzzy=false]              true = ค้นแบบคลุมเครือ (inquireType 0) ต้อง ≥ 2 ตัวอักษร
 */
export function buildWavePackageBody(opt = {}) {
  const {
    pageNo = 1, pageSize = 50,
    view = 'all', packageState,
    warehouseIds, platforms, shopIds, shipProviderIds,
    mark, markIds,
    timeType = 'order', days, from, to,
    searchType = 'packageNo', search, fuzzy = false,
    ...rest
  } = opt;

  const state = packageState ?? VIEWS[view];
  if (state == null) throw new Error(`view ไม่รู้จัก: ${view} (ใช้ ${Object.keys(VIEWS).join('/')})`);

  const body = {
    pageNo,
    pageSize: Math.min(pageSize, MAX_PAGE_SIZE),
    warehouseIdList: list(warehouseIds).map(Number),
    tabStatus: 'printLabelMark',
    packageState: state,
    timeType: state === 7 ? null : (TIME_TYPES[timeType] ?? timeType),
    isNew: 1,
  };

  if (list(platforms).length)       body.platformList    = list(platforms).map(String);
  if (list(shopIds).length)         body.shopIdList      = list(shopIds).map(Number);
  if (list(shipProviderIds).length) body.providerOpenIds = list(shipProviderIds).join(',');

  if (mark != null) {
    const has = MARKS[mark];
    if (has == null) throw new Error(`mark ไม่รู้จัก: ${mark} (ใช้ none/any/all)`);
    if (has !== 0 && !list(markIds).length) throw new Error(`mark '${mark}' ต้องส่ง markIds ด้วย (ดู id จาก row.labelList)`);
    body.hasLable = has;
    if (has !== 0) body.lableIds = list(markIds).map(Number);
  }

  if (from || to) {
    body.beginDate = from ? fmtDate(from) : null;
    body.endDate   = to   ? fmtDate(to)   : null;
  } else if (days != null && days !== '') {
    body.days = DAYS[days] ?? Number(days);
  }

  if (search != null && String(search).trim()) {
    body.searchType    = SEARCH_TYPES[searchType] ?? searchType;
    body.searchContent = list(search).join(',');
    body.inquireType   = fuzzy ? 0 : 2;
  }

  // ตัดค่าว่างทิ้งเหมือนหน้าเว็บ
  const out = { ...body, ...rest };
  for (const k of Object.keys(out)) if (out[k] === '' || out[k] === null) delete out[k];
  return out;
}

/** ตัด pageNo/pageSize ออก — ใช้กับ endpoint นับจำนวน */
export function buildWaveCountBody(opt = {}) {
  const { pageNo, pageSize, ...rest } = buildWavePackageBody(opt);
  return rest;
}
