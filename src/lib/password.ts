import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * แฮชรหัสผ่านด้วย scrypt (มากับ Node ไม่ต้องลง package)
 * รูปแบบที่เก็บ: scrypt$N$r$p$salt(base64)$hash(base64) — scripts/create-user.mjs ใช้รูปแบบเดียวกัน
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

const scrypt = (pw: string, salt: Buffer, keylen: number, opt: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, keylen, opt, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algo, n, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
