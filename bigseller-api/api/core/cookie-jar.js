/**
 * cookie jar — เก็บ cookie ใหม่ที่ BigSeller ส่งกลับมาทาง Set-Cookie เหมือนที่เบราว์เซอร์ทำ
 *
 * ทำไมต้องมี: BigSeller หมุน cookie (เช่น muc_token / JSESSIONID) ไปเรื่อย ๆ
 * เบราว์เซอร์รับค่าใหม่เองเลยไม่เคยหลุด แต่ก้อนที่ก๊อปมาใส่ .env หยุดอยู่ที่ค่าตอนก๊อป
 * พอเซิร์ฟเวอร์เลิกรับค่าเก่า สคริปต์ก็พังทั้งที่เบราว์เซอร์ยังล็อกอินอยู่
 *
 * ค่าอยู่ในหน่วยความจำ — ระบบที่ต่ออยู่ฟัง onCookieChange แล้วเก็บลงที่ของตัวเอง (DB / ไฟล์)
 * แล้วตอนเริ่มรันครั้งหน้าค่อย setCookie() ค่าล่าสุดกลับเข้ามา
 */

import { COOKIE } from './config.js';

let current = COOKIE;
const listeners = new Set();

/** ก้อน cookie ปัจจุบัน (ใช้เป็น Cookie header) */
export const getCookie = () => current;

/**
 * ตั้งก้อน cookie ใหม่ทั้งก้อน (เช่น คนแปะใหม่ หรือโหลดค่าล่าสุดจาก DB) — ไม่ยิง onCookieChange
 * @param {string} cookie
 */
export function setCookie(cookie) {
  current = String(cookie ?? '').trim();
}

/**
 * ฟังเมื่อ BigSeller หมุน cookie — คืนฟังก์ชันยกเลิก
 * @param {(cookie:string, changed:string[]) => void} fn
 */
export function onCookieChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** "a=1; b=2" → Map (คงลำดับเดิม) */
function parse(cookie) {
  const map = new Map();
  for (const part of cookie.split(';')) {
    const s = part.trim();
    const i = s.indexOf('=');
    if (i > 0) map.set(s.slice(0, i), s.slice(i + 1));
  }
  return map;
}

/** Set-Cookie 1 บรรทัด → { name, value, remove } */
function parseSetCookie(line) {
  const [pair, ...attrs] = line.split(';');
  const i = pair.indexOf('=');
  if (i <= 0) return null;
  const name = pair.slice(0, i).trim();
  const value = pair.slice(i + 1).trim();

  // ลบตามกติกาเบราว์เซอร์: Max-Age <= 0 หรือ Expires ในอดีต
  let remove = false;
  for (const a of attrs) {
    const [k, v = ''] = a.split('=').map(s => s.trim());
    if (/^max-age$/i.test(k) && Number(v) <= 0) remove = true;
    if (/^expires$/i.test(k) && Date.parse(v) < Date.now()) remove = true;
  }
  return { name, value, remove };
}

/**
 * รวม Set-Cookie จาก response เข้าก้อนปัจจุบัน — เรียกจาก http.js ทุก response
 * @param {string|string[]|undefined} setCookie header `set-cookie` (axios ให้มาเป็น array)
 * @returns {string[]} ชื่อ cookie ที่เปลี่ยน
 */
export function absorbSetCookie(setCookie) {
  if (!setCookie) return [];
  const jar = parse(current);
  const changed = [];

  for (const line of [].concat(setCookie)) {
    const c = parseSetCookie(line);
    if (!c) continue;
    if (c.remove) {
      if (jar.delete(c.name)) changed.push(c.name);
    } else if (jar.get(c.name) !== c.value) {
      jar.set(c.name, c.value);
      changed.push(c.name);
    }
  }

  if (!changed.length) return changed;
  current = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  for (const fn of listeners) {
    try { fn(current, changed); } catch (e) { console.warn('onCookieChange listener พัง:', e); }
  }
  return changed;
}
