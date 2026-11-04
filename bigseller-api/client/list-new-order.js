/**
 * ลิสต์ออเดอร์จาก BigSeller — ใช้ได้สองแบบ
 *
 * 1) เรียกเป็นฟังก์ชัน
 *      import { listOrders } from './client/list-new-order.js';
 *      const { rows } = await listOrders({ status: ['new','unpaid'], platform: 'tiktok' });
 *      const all     = await listOrders({ status: 'new', all: true });   // ดึงจนครบ ไม่จำกัด
 *
 * 2) รันจาก command line
 *      node client/list-new-order.js
 *      node client/list-new-order.js 50 --status new,unpaid --platform tiktok --fast --items
 *      node client/list-new-order.js --all --status new --save
 *      node client/list-new-order.js --help
 *
 * ทุกอย่างในไฟล์นี้ยิงทดสอบกับ API จริงมาแล้ว
 */

import { post, getLogisticsServices, sleep, DELAY_MS } from '../api/index.js';
import { pathToFileURL } from 'node:url';

export const PATH = '/api/v1/order/new/pageList.json';

/** ขอเกินนี้ก็ได้แค่นี้ — ยิงทดสอบแล้ว ขอ 500 กับ 1000 คืนมา 300 เท่ากัน */
export const PAGE_SIZE_MAX = 300;

// ------------------------------------------------------------------ สถานะ

/**
 * สถานะที่ใช้เป็นตัวกรองได้ — ยิงยืนยันครบทุกตัวแล้วว่ายอดตรงกับ getStatusCount
 * key = ค่าที่ส่งไปใน body, value = viewStatus ที่ได้กลับมา (บางตัวไม่ตรงกัน)
 */
export const STATUSES = {
  'new':                'New',
  'unpaid':             'unpaid',
  'processing':         'To Ship',
  'platformProcessing': 'platformProcessing',
  'pickup':             'To Pickup',
  'shipped':            'Shipped',
  'completed':          'completed',
  'canceled':           'canceled',
  'Return refund':      'Return refund',
  'ignored':            'ignored',
};

// -------------------------------------------------------------- ความเร็วส่ง

/** ค่าจาก queryLogisticsServices.json ที่นับว่า "ส่งเร็ว" — ที่เหลือนับเป็น "ปกติ" */
export const FAST_SERVICES = new Set(['sameday', 'sameday8hours', 'instant', 'nextdaydelivery']);

const norm = s => String(s ?? '').replace('order.logisticsservices.', '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * เร็ว / ปกติ / ไม่ระบุ
 * Shopee กับ Lazada ไม่ส่ง field นี้มาเลย จึงได้ "ไม่ระบุ" — ไม่ใช่ bug
 * @param {object} order
 * @returns {'เร็ว'|'ปกติ'|'ไม่ระบุ'}
 */
export function speedOf(order) {
  const k = norm(order.logisticsServicesName);
  if (!k) return 'ไม่ระบุ';
  return FAST_SERVICES.has(k) ? 'เร็ว' : 'ปกติ';
}

/** ชื่อชั้นบริการแบบสั้น เช่น 'nextdaydelivery' หรือ '-' ถ้าไม่มี */
export const serviceOf = order => norm(order.logisticsServicesName) || '-';

// -------------------------------------------------------------------- SKU

/**
 * SKU ทุกตัวในออเดอร์ (1 ออเดอร์มีได้หลายรายการ)
 * ใช้ inventorySku เป็นหลัก — เป็นตัวที่ตรงกับคลังของเรา ส่วน varSku เป็นของฝั่งแพลตฟอร์ม
 * @param {object} order
 * @returns {string[]}
 */
export function skusOf(order) {
  return (order.orderItemList ?? [])
    .map(i => i.inventorySku || i.varSku || i.itemSku || '')
    .filter(Boolean);
}

/**
 * ออเดอร์นี้มี SKU ที่มองหาอยู่ไหม
 * @param {object} order
 * @param {string[]} wanted
 * @param {boolean} [exact=false] false = พิมพ์บางส่วนก็เจอ
 */
export function matchesSku(order, wanted, exact = false) {
  const have = skusOf(order).map(s => s.toLowerCase());
  return wanted.some(w => {
    const q = w.toLowerCase();
    return exact ? have.includes(q) : have.some(s => s.includes(q));
  });
}

// ------------------------------------------------------------- ยิง 1 หน้า

/** ประกอบ body + ยิง 1 หน้า คืน `data.page` */
async function fetchPage(opt, pageNo, pageSize, desc) {
  const { status, platform, service, historyOrder = 0, sku = [], skuPartial = false } = opt;

  // หลายสถานะต้องใช้ statusList (array)
  // ส่ง status:['a','b'] จะได้ error "missing params" / status:'a,b' จะได้ 0 รายการ
  const statusBody =
      status == null          ? {}
    : Array.isArray(status)   ? { statusList: status }
    :                           { status };

  const d = await post(PATH, {
    allOrder: false,          // false = ให้ตัวกรองมีผล (true จะละเว้นตัวกรองทุกอัน)
    ...statusBody,
    ...(platform ? { platform } : {}),
    ...(service  ? { logisticsServices: service } : {}),   // ต้องเป็น string ส่ง array แล้ว error
    historyOrder,

    // ค้นด้วย SKU ฝั่ง server — searchType ต้องเป็น 'commoditySku' เป๊ะ ๆ
    // (sku/itemSku/inventorySku/varSku ฯลฯ ถูกเมินเงียบ ๆ คืนมาทั้งหมดเหมือนไม่ได้กรอง)
    // ค้นแบบตรงทั้งชื่อเท่านั้น ใส่หลายตัวคั่นด้วย , ได้ — โหมด partial ไปคัดในเครื่องแทน
    ...(sku.length && !skuPartial
      ? { searchType: 'commoditySku', searchContent: sku.join(',') }
      : { searchType: 'orderNo', searchContent: '' }),

    inquireType: 2,
    desc,
    orderBy: 'orderTime',
    pageNo,
    pageSize: Math.min(pageSize, PAGE_SIZE_MAX),
  });

  return d.page;
}

/** คัดด้วยเงื่อนไขที่ API ไม่มีให้กรอง (sku แบบตรงเป๊ะกรองไปตั้งแต่ฝั่ง server แล้ว) */
function applyClientFilters(rows, { carrier, speed, sku, skuPartial }) {
  if (carrier) rows = rows.filter(o => (o.shipmentProvider ?? '').toLowerCase().includes(carrier.toLowerCase()));
  if (speed)   rows = rows.filter(o => speedOf(o) === (speed === 'fast' ? 'เร็ว' : 'ปกติ'));
  if (sku?.length && skuPartial) rows = rows.filter(o => matchesSku(o, sku, false));
  return rows;
}

// ------------------------------------------------------------------- ยิงจริง

/**
 * ดึงออเดอร์ตามเงื่อนไข
 *
 * กรองฝั่ง server (เร็ว ไม่เปลืองโควตา): status, platform, service, historyOrder
 * กรองในเครื่อง (API ไม่มีให้): carrier, speed — ดึงเผื่อแล้วคัดทีหลัง
 *
 * @param {object} [opt]
 * @param {string|string[]|null} [opt.status='new'] ดู STATUSES — `null` = ทุกสถานะ
 * @param {string} [opt.platform]  'shopee' | 'tiktok' | 'lazada'
 * @param {string} [opt.service]   ชั้นบริการตรง ๆ เช่น 'Standard', 'Nextday Delivery'
 * @param {string} [opt.carrier]   ชื่อขนส่ง พิมพ์บางส่วนได้ เช่น 'flash' (กรองในเครื่อง)
 * @param {'fast'|'normal'} [opt.speed] เฉพาะส่งเร็ว / ส่งปกติ (กรองในเครื่อง)
 * @param {string|string[]} [opt.sku] เอาเฉพาะออเดอร์ที่มี SKU นี้ — ค้นฝั่ง server ต้องตรงทั้งชื่อ
 * @param {boolean}[opt.skuPartial=false] true = พิมพ์บางส่วนก็เจอ แต่ต้องคัดในเครื่อง (ช้ากว่ามาก ควรใช้คู่ all:true)
 * @param {number} [opt.limit=20]  เอากี่รายการ — ใส่ `Infinity` = เท่ากับ all:true
 * @param {boolean}[opt.all=false] true = ไล่ทุกหน้าจนครบ ไม่จำกัดจำนวน
 * @param {number} [opt.pageSize=100] แถวต่อ 1 request (สูงสุด 300)
 * @param {number} [opt.delayMs=0] พักเพิ่มระหว่างหน้า (นอกเหนือจากคิว REQUEST_DELAY_MS)
 * @param {number} [opt.maxRows=Infinity] กันเผลอ — เก็บได้มากสุดเท่านี้
 * @param {number} [opt.maxPages=Infinity] กันเผลอ — ยิงได้มากสุดกี่หน้า
 * @param {(p:object)=>void} [opt.onPage] รายงานความคืบหน้าทุกหน้า
 * @param {number} [opt.pageNo=1]  เฉพาะโหมดหน้าเดียว
 * @param {0|1}    [opt.historyOrder=0] 1 = ค้นในประวัติ (ออเดอร์เกิน 90 วัน)
 * @param {number} [opt.fetchSize] เฉพาะโหมดหน้าเดียว — บังคับจำนวนที่ดึงก่อนกรองในเครื่อง
 * @returns {Promise<{rows:object[], totalSize:number, fetched:number, matched:number, pages:number, truncated:boolean, clientSide:boolean}>}
 */
export async function listOrders(opt = {}) {
  const {
    carrier, speed,
    limit = 20,
    all = false,
    pageSize = 100,
    delayMs = 0,
    maxRows = Infinity,
    maxPages = Infinity,
    onPage,
    pageNo = 1,
    fetchSize,
  } = opt;

  const sku        = opt.sku == null ? [] : [].concat(opt.sku).filter(Boolean).map(String);
  const skuPartial = Boolean(opt.skuPartial);
  const filters    = { carrier, speed, sku, skuPartial };
  const clientSide = Boolean(carrier || speed || (sku.length && skuPartial));
  const wantAll    = all || limit === Infinity;

  // sku ที่ normalize แล้วต้องส่งต่อให้ fetchPage ด้วย ไม่งั้นมันอ่านของดิบจาก opt
  opt = { ...opt, sku, skuPartial };

  // ---------------------------------------------------- โหมดหน้าเดียว (เดิม)
  if (!wantAll) {
    // กรองในเครื่องต้องดึงเผื่อ ไม่งั้นคัดเสร็จแล้วเหลือไม่ถึงจำนวนที่ขอ
    const size = fetchSize ?? (clientSide ? Math.min(Math.max(limit * 10, 100), PAGE_SIZE_MAX) : limit);
    const page = await fetchPage(opt, pageNo, size, 1);

    const fetched = page.rows.length;
    const kept    = applyClientFilters(page.rows, filters);

    return {
      rows: kept.slice(0, limit), totalSize: page.totalSize,
      fetched, matched: kept.length, pages: 1, truncated: false, clientSide,
    };
  }

  // ------------------------------------------------------- โหมดดึงจนครบ
  //
  // ทิศทางการไล่หน้าเลือกตามว่าจะเอาครบหรือเอาแค่บางส่วน:
  //
  //   ครบทั้งหมด (ไม่ใส่ maxRows) → ไล่เก่า→ใหม่ (desc:0)
  //     ออเดอร์ใหม่ไปต่อท้าย หน้าที่ดึงไปแล้วจึงไม่ขยับ
  //     ถ้าไล่ใหม่→เก่า ของที่เข้ามาระหว่างดึงจะดันทุกอย่างถอยลง 1 ช่อง
  //     → ได้ของซ้ำและตกหล่นพร้อมกัน ยิ่งดึงนานยิ่งเพี้ยน
  //
  //   จำกัดจำนวน (ใส่ maxRows)  → ไล่ใหม่→เก่า (desc:1)
  //     คนขอ "เอา N รายการ" ย่อมหมายถึง N รายการล่าสุด ไม่ใช่ N รายการแรกสุด
  //     รันสั้น ๆ การเลื่อนจึงน้อย และกันซ้ำด้วย id อยู่แล้ว
  //
  const newestFirst = maxRows !== Infinity;
  const size    = Math.min(pageSize, PAGE_SIZE_MAX);
  const seen    = new Set();          // กันซ้ำด้วย id เผื่อ order เลื่อนจริง ๆ
  const rows    = [];
  const started = Date.now();

  let fetched = 0, pages = 0, truncated = false, totalSize = 0, totalPage = 1;

  for (let p = 1; p <= totalPage; p++) {
    if (pages >= maxPages) { truncated = true; break; }

    const page = await fetchPage(opt, p, size, newestFirst ? 1 : 0);
    pages++;
    totalSize = page.totalSize;
    totalPage = page.totalPage;        // อ่านใหม่ทุกหน้า — ของอาจเพิ่มระหว่างดึง

    if (!page.rows.length) break;

    const fresh = page.rows.filter(o => !seen.has(o.id));
    for (const o of page.rows) seen.add(o.id);
    fetched += page.rows.length;

    rows.push(...applyClientFilters(fresh, filters));

    if (rows.length >= maxRows) { rows.length = maxRows; truncated = true; }

    onPage?.({
      pageNo: p, totalPage, pageRows: page.rows.length,
      collected: rows.length, fetched, totalSize,
      elapsedMs: Date.now() - started,
    });

    if (truncated) break;
    if (delayMs && p < totalPage) await sleep(delayMs);
  }

  // ตอนไล่เก่า→ใหม่ ต้องพลิกกลับให้เหมือนโหมดปกติ (ใหม่อยู่บน)
  if (!newestFirst) rows.reverse();

  return { rows, totalSize, fetched, matched: rows.length, pages, truncated, clientSide };
}

// ------------------------------------------------------------------ แสดงผล

/**
 * พิมพ์ผลจาก listOrders ออกหน้าจอ
 * @param {Awaited<ReturnType<typeof listOrders>>} result
 * @param {{items?:boolean, filters?:string, tableLimit?:number}} [opt]
 */
export function printOrders(result, opt = {}) {
  const { rows, totalSize, fetched, matched, clientSide, pages, truncated } = result;
  const { items = false, filters = '', tableLimit = 20 } = opt;

  console.log(`ออเดอร์ทั้งหมด ${totalSize} รายการ${filters ? `\nตัวกรอง: ${filters}` : ''}`);
  if (pages > 1)  console.log(`ยิงไป ${pages} หน้า · ดึงมา ${fetched} แถว${truncated ? ' (หยุดก่อนครบเพราะชนเพดาน)' : ''}`);
  if (clientSide) console.log(`(ดึงมา ${fetched} → ตรงเงื่อนไข ${matched} → แสดง ${rows.length})`);
  console.log();

  if (!rows.length) {
    console.log('ไม่มีรายการที่ตรงเงื่อนไข');
    // กรองในเครื่อง = คัดจากเท่าที่ดึงมาเท่านั้น ของที่หาอาจอยู่หน้าลึกกว่านั้น
    if (clientSide && pages === 1) console.log(`(คัดจาก ${fetched} แถวแรกเท่านั้น — ลองใส่ --all เพื่อไล่ให้ครบทุกหน้า)`);
    return;
  }

  const tally = fn => Object.entries(rows.reduce((m, o) => (m[fn(o)] = (m[fn(o)] ?? 0) + 1, m), {}))
                            .sort((a, b) => b[1] - a[1])
                            .map(([k, v]) => `${k} ${v}`).join('  ·  ');

  console.log(`สรุปทั้ง ${rows.length} รายการ:`);
  console.log('  สถานะ:   ', tally(o => o.viewStatus || '-'));
  console.log('  แพลตฟอร์ม:', tally(o => o.platform || '-'));
  console.log('  ความเร็ว:', tally(speedOf));
  console.log('  ขนส่ง:   ', tally(o => o.shipmentProvider || 'ไม่ระบุ'));
  console.log();

  const shown = rows.slice(0, tableLimit);
  console.table(shown.map(o => ({
    เลขออเดอร์: o.platformOrderId,
    ร้าน:       o.shopName,
    แพลตฟอร์ม:  o.platform,
    สถานะ:      o.viewStatus,
    ความเร็ว:   speedOf(o),
    บริการ:     serviceOf(o),
    ขนส่ง:      (o.shipmentProvider ?? '-').slice(0, 20),
    สั่งเมื่อ:    o.orderCreateTimeStr,
    ชิ้น:        o.orderItemList?.reduce((n, i) => n + (i.quantity ?? 0), 0) ?? 0,
    SKU:        skusOf(o).join(', ').slice(0, 30) || '-',
  })));
  if (rows.length > shown.length) console.log(`  ... อีก ${rows.length - shown.length} รายการ (ใช้ --save เพื่อเก็บครบ)`);

  if (!items) return;
  for (const o of shown) {
    console.log(`\n${o.platformOrderId}  (${o.shopName} · ${o.viewStatus} · ${speedOf(o)} · ${o.shipmentProvider ?? '-'})`);
    for (const i of o.orderItemList ?? []) {
      console.log(`   ${i.quantity} x ${i.itemName}`);
      if (i.inventorySku) console.log(`       SKU: ${i.inventorySku}`);
    }
  }
}

// ---------------------------------------------------------------------- CLI

const HELP = [
  '',
  'ใช้:  node client/list-new-order.js [จำนวน] [ตัวเลือก]',
  '',
  '  --status a,b     สถานะ (หลายตัวคั่นด้วย ,) ค่าเริ่มต้น: new',
  '                   ที่ใช้ได้: ' + Object.keys(STATUSES).join(' · '),
  '  --all-status     เอาทุกสถานะ',
  '  --platform X     shopee | tiktok | lazada',
  '  --carrier X      ชื่อขนส่ง พิมพ์บางส่วนได้ เช่น flash',
  '  --sku a,b        เอาเฉพาะออเดอร์ที่มี SKU นี้ (ต้องตรงทั้งชื่อ ใส่หลายตัวคั่น ,)',
  '                   ค้นฝั่ง server เร็ว ไม่ต้องใช้ --all',
  '  --sku-partial    ให้ --sku พิมพ์บางส่วนก็เจอ (ต้องคัดในเครื่อง ควรใส่ --all ด้วย)',
  '  --service X      ชั้นบริการ เช่น Standard หรือ "Nextday Delivery"',
  '  --fast           เฉพาะส่งเร็ว',
  '  --normal         เฉพาะส่งปกติ',
  '  --history        ค้นในประวัติ (ออเดอร์เกิน 90 วัน)',
  '  --items          โชว์รายการสินค้าในแต่ละออเดอร์',
  '',
  '  --all            ดึงจนครบ ไม่จำกัดจำนวน (ไล่ทีละหน้า พักให้เซิร์ฟเวอร์)',
  `  --page-size N    แถวต่อ 1 request ค่าเริ่มต้น 100 สูงสุด ${PAGE_SIZE_MAX}`,
  '  --delay MS       พักเพิ่มระหว่างหน้า เช่น 2000 (ปกติมีคิวเว้น ' + DELAY_MS + 'ms ให้อยู่แล้ว)',
  '  --max N          เก็บมากสุด N รายการแล้วหยุด',
  '  --save [ไฟล์]     เซฟผลเป็น JSON (ค่าเริ่มต้น out/orders.json)',
  '',
  'ตัวอย่าง:',
  '  node client/list-new-order.js 50 --status new,unpaid --platform tiktok --fast',
  '  node client/list-new-order.js --all --status new --save',
  '  node client/list-new-order.js --all --status completed --page-size 300 --delay 2000 --max 10000',
  '',
].join('\n');

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const argv = process.argv.slice(2);
  const has  = f => argv.includes(f);
  const val  = f => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
  const num  = (f, d) => { const v = val(f); return v == null || /^--/.test(v) ? d : Number(v); };

  if (has('--help') || has('-h')) { console.log(HELP); process.exit(0); }

  const statusArg = val('--status');
  const status = has('--all-status') ? null
               : statusArg           ? statusArg.split(',').map(s => s.trim()).filter(Boolean)
               :                       'new';

  const all = has('--all');

  const opt = {
    status,
    platform: val('--platform') ?? undefined,
    service:  val('--service')  ?? undefined,
    carrier:  val('--carrier')  ?? undefined,
    sku:        val('--sku') ? val('--sku').split(',').map(s => s.trim()).filter(Boolean) : undefined,
    skuPartial: has('--sku-partial'),
    speed:    has('--fast') ? 'fast' : has('--normal') ? 'normal' : undefined,
    limit:    Number(argv.find(a => /^\d+$/.test(a)) ?? 20),
    historyOrder: has('--history') ? 1 : 0,
    all,
    pageSize: num('--page-size', 100),
    delayMs:  num('--delay', 0),
    maxRows:  num('--max', Infinity),
  };

  // เตือนตั้งแต่ก่อนยิง ดีกว่าปล่อยให้ได้ 0 รายการแล้วงงว่าทำไม
  const bad = [].concat(status ?? []).filter(s => !(s in STATUSES));
  if (bad.length) {
    console.error(`\n❌ สถานะไม่รู้จัก: ${bad.join(', ')}`);
    console.error(`   ที่ใช้ได้: ${Object.keys(STATUSES).join(' · ')}\n`);
    process.exit(1);
  }

  if (all) {
    // รายงานความคืบหน้าทีละหน้า + เดาเวลาที่เหลือ จะได้รู้ว่าควรรอหรือกด Ctrl+C
    opt.onPage = p => {
      const perPage = p.elapsedMs / p.pageNo;
      const left    = Math.max(0, Math.min(p.totalPage, Math.ceil((opt.maxRows === Infinity ? p.totalPage : opt.maxRows / opt.pageSize))) - p.pageNo);
      process.stdout.write(
        `\rหน้า ${p.pageNo}/${p.totalPage} · เก็บแล้ว ${p.collected} · ` +
        `${(p.elapsedMs / 1000).toFixed(0)}s ผ่านไป · เหลืออีกราว ${((left * perPage) / 1000 / 60).toFixed(1)} นาที   `
      );
    };
  }

  const filters = [
    `สถานะ=${status == null ? 'ทั้งหมด' : [].concat(status).join(',')}`,
    opt.platform && `แพลตฟอร์ม=${opt.platform}`,
    opt.service  && `บริการ=${opt.service}`,
    opt.carrier  && `ขนส่ง~${opt.carrier}`,
    opt.sku      && `SKU${opt.skuPartial ? '~' : '='}${opt.sku.join(',')}`,
    opt.speed    && (opt.speed === 'fast' ? 'เฉพาะส่งเร็ว' : 'เฉพาะส่งปกติ'),
    opt.historyOrder && 'ในประวัติ',
    all && 'ดึงจนครบ',
  ].filter(Boolean).join('  ');

  try {
    const result = await listOrders(opt);
    if (all) process.stdout.write('\r' + ' '.repeat(90) + '\r');

    printOrders(result, { items: has('--items'), filters });

    if (has('--save')) {
      const fs   = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const out  = val('--save') && !/^--/.test(val('--save'))
        ? val('--save')
        : path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', 'orders.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(result.rows, null, 2));
      console.log(`\nเซฟ ${result.rows.length} รายการ → ${out}`);
    }
  } catch (e) {
    console.error(`\n❌ ${e.message}\n`);
    if (/missing params/.test(e.message)) {
      const svc = await getLogisticsServices().catch(() => []);
      console.error('ค่า --service ที่ใช้ได้:', svc.map(s => `"${s.value}"`).join(', '), '\n');
    }
    process.exit(1);
  }
}
