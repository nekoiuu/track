/**
 * ชั้น HTTP — ทุก endpoint ยิงผ่านตรงนี้หมด
 *
 * รับผิดชอบ 4 อย่าง แล้วไฟล์ endpoint จะเหลือแค่ path + body:
 *   1. ใส่ header ให้เหมือนเบราว์เซอร์
 *   2. แปลง response ที่พังทุกแบบให้เป็น BigSellerError ที่อ่านรู้เรื่อง
 *   3. คุมจังหวะยิงทั้งโปรเจกต์ให้ห่างกัน DELAY_MS (คิวเดียว ทุก endpoint ใช้ร่วมกัน)
 *   4. retry เองเมื่อโดน rate limit
 *   5. เก็บ cookie ใหม่ที่ BigSeller หมุนให้ (Set-Cookie) → ./cookie-jar.js
 */

import axios from 'axios';
import { BASE_URL, DELAY_MS, RETRIES, UA, REFERER, validateCookie } from './config.js';
import { getCookie, absorbSetCookie } from './cookie-jar.js';
import { BigSellerError, KINDS } from './errors.js';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  maxRedirects: 0,              // เด้งไปหน้า login = cookie หมดอายุ อย่าตามไป
  validateStatus: () => true,   // จัดการ status เองทั้งหมด
  headers: {
    'Content-Type': 'application/json',
    'clientType': '1',          // ← ขาดไม่ได้ ไม่ใส่แล้ว API ไม่รับ
    'Accept': 'application/json, text/plain, */*',

    // ต่อจากนี้คือ header ที่เบราว์เซอร์ใส่ให้เองทุก request แต่ axios ใน Node ไม่ใส่
    // ไม่ใส่ = ประกาศตัวว่าเป็น 'axios/1.x' → ตัวตรวจ bot (มาคู่กับ cookie
    // fingerPrint / MYJ_* / __lt__cid) เด้งทิ้ง แล้วคืนหน้า login กลับมาแทน JSON
    'User-Agent': UA,
    'Accept-Language': 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': BASE_URL,
    'Referer': REFERER,
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
  },
});

const AUTH_EXPIRED_MSG =
  'cookie หมดอายุหรือใช้ไม่ได้แล้ว\n' +
  '→ ดึงใหม่ตาม cookie/HOWTO.md แล้วอัปเดต BIGSELLER_COOKIE ใน .env';

// ------------------------------------------------------------------- คิวยิง

// คิวเส้นเดียวของทั้งโปรเจกต์ — ต่อให้เรียกหลาย endpoint พร้อมกัน
// ก็จะถูกจัดคิวให้ห่างกัน DELAY_MS อัตโนมัติ ไม่ต้อง sleep เองในแต่ละ endpoint
let chain  = Promise.resolve();
let lastAt = 0;
let lastOkAt = 0;

/** เวลา (ms) ที่ยิงผ่านครั้งล่าสุด — ใช้ตัดสินว่าต้อง keep-alive ไหม */
export const getLastOkAt = () => lastOkAt;

function schedule(fn) {
  const run = chain.then(async () => {
    const wait = DELAY_MS - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    try { return await fn(); }
    finally { lastAt = Date.now(); }
  });
  chain = run.catch(() => {});   // error ตัวหนึ่งต้องไม่ทำให้คิวที่เหลือตาย
  return run;
}

// ---------------------------------------------------------- ยิง 1 ครั้ง + ตรวจ

/** ยิงจริง 1 ครั้ง แล้วตรวจ response ทุกชั้น — โยน BigSellerError ถ้าไม่ผ่าน */
function send(method, path, { body, params, form = false } = {}) {
  return schedule(async () => {
    const cookie = getCookie();
    validateCookie(cookie);   // ตั้งผิด = พังตรงนี้ ไม่เสีย request

    // บาง endpoint หน้าเว็บส่งเป็น form (axios.postForm) ไม่ใช่ JSON — ส่งผิดชนิดแล้ว BigSeller ไม่รับ
    const headers = { Cookie: cookie };
    let payload = body;
    if (form && body) {
      payload = new URLSearchParams(Object.entries(body).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    let res;
    try {
      res = await http.request({ method, url: path, data: payload, params, headers });
    } catch (e) {
      throw new BigSellerError(`ต่อ ${BASE_URL} ไม่ได้: ${e.message}`, KINDS.NETWORK, { path });
    }

    // เก็บ cookie ที่หมุนใหม่ก่อนตรวจอย่างอื่น — redirect / error ก็อาจแนบ Set-Cookie มา
    absorbSetCookie(res.headers?.['set-cookie']);

    // --- ชั้นที่ 1: HTTP status ---
    if (res.status === 401 || res.status === 403) {
      throw new BigSellerError(
        `${AUTH_EXPIRED_MSG}\n(HTTP ${res.status})`,
        KINDS.AUTH, { path, status: res.status }
      );
    }
    if (res.status >= 300 && res.status < 400) {
      // redirect มีสองความหมาย ปลายทางเป็นตัวแยก — แยกผิดแล้วไปนั่งดึง cookie ใหม่ฟรี ๆ
      const to = res.headers?.location ?? '';

      // noPermissionPage = cookie ยังดี แต่บัญชีไม่มีสิทธิ์เมนูนั้น (เจอกับ /api/v1/inventory/*)
      if (/noPermission/i.test(to)) {
        throw new BigSellerError(
          `บัญชีนี้ไม่มีสิทธิ์เรียก ${path}\n` +
          `(โดนเด้งไป ${to} — cookie ยังใช้ได้ปกติ ไม่ต้องดึงใหม่)\n` +
          '→ ให้ admin เปิดสิทธิ์เมนูนั้นให้บัญชีนี้ หรือเช็คว่าแพ็กเกจรวมเมนูนั้นไหม\n' +
          '   เช็คเร็ว ๆ: เปิดเมนูนั้นบน bigseller.com ด้วยบัญชีเดียวกัน เข้าไม่ได้ = สิทธิ์ไม่พอจริง',
          KINDS.PERMISSION, { path, status: res.status, location: to }
        );
      }

      throw new BigSellerError(
        `${AUTH_EXPIRED_MSG}\n(โดน redirect ${res.status} → ${to || 'ไม่ระบุปลายทาง'})`,
        KINDS.AUTH, { path, status: res.status }
      );
    }
    if (res.status !== 200) {
      throw new BigSellerError(`${path} → HTTP ${res.status}`, KINDS.API, { path, status: res.status });
    }

    // ได้ HTML กลับมาแทน JSON = โดนเด้งไปหน้า login หรือโดนหน้าตรวจ bot คั่น
    // โชว์เนื้อจริงด้วย จะได้แยกออกว่าเป็นสองอย่างนี้อันไหน
    if (typeof res.data === 'string') {
      const snippet = res.data.replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new BigSellerError(
        `${AUTH_EXPIRED_MSG}\n` +
        `(ได้ HTML กลับมาแทน JSON — ${res.data.length} ไบต์)\n` +
        `--- ที่ได้จริง ---\n${snippet}`,
        KINDS.AUTH, { path, status: res.status }
      );
    }

    // --- ชั้นที่ 2: code ใน body (BigSeller คืน HTTP 200 แม้ตอน error) ---
    const { code, msg, data } = res.data;
    if (code !== 0) {
      const detail = { path, status: res.status, code, msg };
      if (/too frequent/i.test(msg || '')) {
        throw new BigSellerError(`โดน rate limit: ${msg}`, KINDS.RATE_LIMIT, detail);
      }
      if (/login|auth|登录/i.test(msg || '')) {
        throw new BigSellerError(`${AUTH_EXPIRED_MSG}\n(API ตอบ: code=${code} msg=${msg})`, KINDS.AUTH, detail);
      }
      // session ตาย BigSeller ตอบเป็นภาษาไทย + เลขรหัสต่อท้าย ไม่มีคำว่า login/auth ให้จับ
      //   มี cookie แต่หมดอายุ → code 2001 + msg "…401006"
      //   ไม่ส่ง cookie เลย     → code 2001 + msg ว่าง
      // ไม่แยกตรงนี้จะกลายเป็น kind 'api' แล้ว watcher จะ retry ทั้งที่ยิงไปก็ไม่มีวันผ่าน
      if (code === 2001 && (/\b401\d{3}\b/.test(msg || '') || !msg)) {
        throw new BigSellerError(
          `${AUTH_EXPIRED_MSG}\n(API ตอบ: code=${code} msg=${msg || '(ว่าง)'})`,
          KINDS.AUTH, detail
        );
      }
      throw new BigSellerError(`${path} → code=${code} msg=${msg}`, KINDS.API, detail);
    }

    lastOkAt = Date.now();
    return data;
  });
}

// --------------------------------------------------------------- ทางเข้าใช้งาน

/**
 * ยิง + retry อัตโนมัติเมื่อโดน rate limit
 * (auth / no-cookie ไม่ retry — ลองไปก็เท่านั้น เปลืองโควตาเปล่า)
 *
 * @param {'get'|'post'} method
 * @param {string} path
 * @param {{body?:object, params?:object, retries?:number}} [opts]
 */
export async function request(method, path, opts = {}) {
  const { retries = RETRIES, ...rest } = opts;

  for (let i = 0; i <= retries; i++) {
    try {
      return await send(method, path, rest);
    } catch (e) {
      if (e.kind !== KINDS.RATE_LIMIT || i === retries) throw e;
      const wait = DELAY_MS * (i + 2);
      console.warn(`  โดน rate limit — รอ ${wait}ms แล้วลองใหม่ (${i + 1}/${retries})`);
      await sleep(wait);
    }
  }
}

/** @param {string} path @param {object} [params] */
export const get = (path, params, opts = {}) => request('get', path, { params, ...opts });

/** @param {string} path @param {object} [body] */
export const post = (path, body, opts = {}) => request('post', path, { body, ...opts });

/** POST แบบ form-urlencoded (ที่หน้าเว็บเรียกด้วย axios.postForm) @param {string} path @param {object} [body] */
export const postForm = (path, body, opts = {}) => request('post', path, { body, form: true, ...opts });
