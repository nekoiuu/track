import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * cookie login แบบเซ็นด้วย HMAC — ตรวจได้โดยไม่ต้องถาม DB (DB อยู่ไกล ~200ms ต่อครั้ง)
 * ไม่มี "server-only" เพราะ src/proxy.ts ต้อง import ด้วย
 */
export const SESSION_COOKIE = "shipped_session";
/** อยู่ในระบบได้นานเท่านี้ก่อนต้อง login ใหม่ */
export const SESSION_DAYS = 14;

export type SessionUser = { id: string; username: string; name: string };
type Payload = SessionUser & { exp: number };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("ตั้ง AUTH_SECRET ใน .env (สุ่มยาว ≥ 32 ตัว) ก่อนใช้งานระบบ login");
  return s;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function createSessionToken(user: SessionUser) {
  const payload: Payload = { ...user, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const data = b64(JSON.stringify(payload));
  return `${data}.${sign(data)}`;
}

/** token ถูกต้องและยังไม่หมดอายุ → ข้อมูลผู้ใช้ · ไม่งั้น null */
export function readSessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString()) as Payload;
    if (!p.id || !p.name || typeof p.exp !== "number" || p.exp < Date.now()) return null;
    return { id: p.id, username: p.username, name: p.name };
  } catch {
    return null;
  }
}
