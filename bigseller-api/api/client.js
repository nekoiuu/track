/**
 * เดิมโค้ดทั้งหมดอยู่ไฟล์นี้ ตอนนี้แยกไป core/ กับ endpoints/ แล้ว
 * เก็บไว้เพื่อให้ import เดิมไม่พัง — ของใหม่ให้ import จาก api/index.js
 *
 * @deprecated ใช้ `from '../api/index.js'` แทน
 */

export * from './index.js';
export { default } from './index.js';
