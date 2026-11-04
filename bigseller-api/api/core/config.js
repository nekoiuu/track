/**
 * อ่าน .env + ตรวจ cookie (ตรวจก่อนยิงทุกครั้ง ผ่าน validateCookie)
 *
 * ตรวจตรงนี้ที่เดียว ทุก endpoint จะได้ไม่ต้องเช็คเอง
 * และถ้าตั้งค่าผิดจะรู้ทันทีโดยไม่เสีย request ยิงออกไปให้โดนนับ rate limit
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { BigSellerError, KINDS } from './errors.js';

// โหลด .env จากรากโปรเจกต์เสมอ ไม่ผูกกับ cwd
// ('dotenv/config' หาไฟล์จากโฟลเดอร์ที่พิมพ์คำสั่ง — รันจากที่อื่นแล้วจะหาไม่เจอเงียบ ๆ)
export const ROOT     = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// .env อยู่ที่รากของแอป c (โฟลเดอร์แม่) ไม่ใช่ในโฟลเดอร์นี้ — ใช้ไฟล์เดียวกับเว็บ
// cookie หมดอายุแก้ที่เดียวแล้วทั้งเว็บและสคริปต์ในนี้ได้ค่าใหม่พร้อมกัน
export const ENV_PATH = path.join(ROOT, '..', '.env');

const envResult = dotenv.config({ path: ENV_PATH });

export const BASE_URL   = process.env.BIGSELLER_BASE_URL || 'https://www.bigseller.com';
export const COOKIE     = process.env.BIGSELLER_COOKIE   || '';
export const DELAY_MS   = Number(process.env.REQUEST_DELAY_MS || 1500);
export const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 50);
export const RETRIES    = Number(process.env.MAX_RETRIES || 3);

// UA ควรตรงกับเบราว์เซอร์ที่ก๊อป cookie มา (เอาจาก Console: navigator.userAgent)
export const UA = process.env.BIGSELLER_UA ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const REFERER = process.env.BIGSELLER_REFERER || `${BASE_URL}/`;


// ---------------------------------------------------------------- ตรวจ cookie
//
// ตรวจตอนจะยิง (ก่อนส่ง request จริงทุกครั้ง) ไม่ใช่ตอน import
// เพราะ cookie เปลี่ยนได้ระหว่างรัน — BigSeller หมุน cookie ใหม่ผ่าน Set-Cookie (ดู cookie-jar.js)
// และระบบที่ต่ออยู่ตั้งค่าใหม่ได้ผ่าน setCookie() โดยไม่ต้องมีใน .env
// ตั้งผิดก็ยังรู้ทันทีโดยไม่เสีย request เหมือนเดิม

/** ชื่อ cookie ทุกตัวในก้อน */
export const parseCookieNames = (cookie = '') => cookie.split(';')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => (s.includes('=') ? s.slice(0, s.indexOf('=')) : ''))
  .filter(Boolean);

/** ชื่อ cookie ใน .env — ใช้ตรวจว่าวางมาถูกรูปแบบจริงไหม */
export const cookieNames = parseCookieNames(COOKIE);

// cookie ที่ขาดไม่ได้ — เตือนอย่างเดียว เผื่อ BigSeller เปลี่ยนชื่อในอนาคต
const REQUIRED_COOKIES = ['JSESSIONID', 'muc_token'];
const warned = new Set();

/**
 * ตรวจก้อน cookie ก่อนยิง — โยน BigSellerError(no-cookie) ถ้าใช้ไม่ได้แน่ ๆ
 * @param {string} cookie
 */
export function validateCookie(cookie) {
  if (!cookie) {
    // แยกให้ออกว่า "ไม่มีไฟล์" / "ไม่มีบรรทัด" / "โดน env var ของ shell ทับ"
    // ทั้งสามอย่างหน้าตาเหมือนกันหมดคือ COOKIE ว่าง แต่วิธีแก้คนละเรื่อง
    const reason = envResult.error
      ? `หาไฟล์ .env ไม่เจอที่ ${ENV_PATH}`
      : Object.hasOwn(envResult.parsed ?? {}, 'BIGSELLER_COOKIE')
        ? '.env มี BIGSELLER_COOKIE อยู่ แต่ค่าว่าง หรือโดน env var ของ shell ทับเป็นค่าว่าง\n' +
          '   → ปิด terminal เปิดใหม่ หรือสั่ง  Remove-Item Env:BIGSELLER_COOKIE'
        : `ไฟล์ ${ENV_PATH} ไม่มีบรรทัด BIGSELLER_COOKIE (วิธีดึง: cookie/HOWTO.md)`;

    throw new BigSellerError(
      `ยังไม่ได้ตั้ง BIGSELLER_COOKIE\n→ ${reason}\n   (รันจาก: ${process.cwd()})`,
      KINDS.NO_COOKIE
    );
  }

  const names = parseCookieNames(cookie);

  // วาง token เดี่ยว ๆ แทนที่จะวาง Cookie header ทั้งก้อน = พลาดกันบ่อยสุด
  if (names.length === 0) {
    throw new BigSellerError(
      'BIGSELLER_COOKIE ไม่ใช่ Cookie header — หาคู่ name=value ไม่เจอสักคู่\n' +
      'ที่วางมาน่าจะเป็นค่า token ตัวเดียว ไม่ใช่ทั้งก้อน\n' +
      '→ DevTools → Network → pageList.json → Request Headers → Cookie → Copy value\n' +
      '   หน้าตาที่ถูก: "_ga=xxx; JSESSIONID=xxx; muc_token=xxx; ..."',
      KINDS.NO_COOKIE
    );
  }

  const missing = REQUIRED_COOKIES.filter(n => !names.includes(n));
  const key = missing.join(',');
  if (missing.length && !warned.has(key)) {
    warned.add(key);
    console.warn(
      `⚠ ก้อน cookie ไม่มี: ${missing.join(', ')} (มีทั้งหมด ${names.length} ตัว)\n` +
      '  น่าจะก๊อปไม่ครบ หรือก๊อปมาจาก request ที่ยังไม่ได้ล็อกอิน'
    );
  }
}
