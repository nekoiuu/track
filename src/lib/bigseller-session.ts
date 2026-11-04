import { prisma } from "./prisma";
import { cookieDeadText, notify } from "./line";

/**
 * cookie BigSeller ที่ใช้อยู่ — ตัวจริงอยู่ใน DB (ตาราง BigSellerSession)
 *
 * - BigSeller หมุน cookie ผ่าน Set-Cookie → bigseller-api/api/core/cookie-jar.js รับไว้ → เราเก็บลง DB
 * - ก่อนยิงทุกครั้งโหลดค่าล่าสุดจาก DB (แอปอาจมีหลาย instance ของโมดูล เช่น instrumentation กับหน้าเว็บ)
 * - คนแปะ cookie ใหม่ได้ 2 ทาง: หน้า /sync หรือแก้ .env (ค่าใน .env เปลี่ยน = ถือว่าแปะใหม่)
 *
 * ไฟล์นี้ไม่มี "server-only" เพราะ instrumentation.ts ต้อง import ได้
 */

const ID = "default";
const envCookie = () => process.env.BIGSELLER_COOKIE?.trim() ?? "";

type Api = typeof import("../../bigseller-api/api/index.js");

let hooked = false;
let saving: Promise<unknown> = Promise.resolve();

// import แบบ dynamic — โหลดตอนใช้จริงเท่านั้น
async function importApi(): Promise<Api> {
  const api = await import("../../bigseller-api/api/index.js");
  if (!hooked) {
    hooked = true;
    api.onCookieChange((cookie: string, changed: string[]) => {
      // เขียนทีละครั้งตามลำดับ ไม่ให้ค่าเก่าทับค่าใหม่
      saving = saving
        .then(() =>
          prisma.bigSellerSession.update({
            where: { id: ID },
            data: { cookie, rotatedAt: new Date(), rotations: { increment: 1 } },
          }),
        )
        .then(() => console.log(`[bigseller] cookie หมุนใหม่: ${changed.join(", ")}`))
        .catch((e) => console.warn("[bigseller] เก็บ cookie ใหม่ไม่สำเร็จ:", e));
    });
  }
  return api;
}

/** แถว session — สร้างจาก .env ถ้ายังไม่มี / ใช้ค่า .env ถ้าคนเพิ่งแก้ .env */
export async function getSession() {
  await saving;
  const env = envCookie();
  const s = await prisma.bigSellerSession.findUnique({ where: { id: ID } });

  if (!s) {
    if (!env) return null;
    return prisma.bigSellerSession.create({ data: { id: ID, cookie: env, envSeed: env } });
  }
  if (env && env !== s.envSeed) {
    return prisma.bigSellerSession.update({ where: { id: ID }, data: { cookie: env, envSeed: env, deadCookie: null } });
  }
  return s;
}

/** โหลด bigseller-api พร้อม cookie ล่าสุดจาก DB */
export async function loadApi() {
  const api = await importApi();
  const s = await getSession();
  if (s && s.cookie !== api.getCookie()) api.setCookie(s.cookie);
  return api;
}

/** บันทึกผลการยิง — auth error = จำ cookie นี้ไว้ว่าตาย จะได้ไม่ keep-alive ซ้ำ */
export async function recordResult(api: Api, err?: Error & { kind?: string }) {
  await saving;
  const now = new Date();
  const dying = err && (err.kind === "auth" || err.kind === "no-cookie");
  // แจ้ง LINE เฉพาะตอนเพิ่งตาย (cookie นี้ยังไม่เคยถูกจดว่าตาย) — keep-alive / sync ซ้ำ ๆ จะไม่แจ้งซ้ำ
  const wasAlive = dying
    ? (await prisma.bigSellerSession.findUnique({ where: { id: ID }, select: { deadCookie: true } }))?.deadCookie !== api.getCookie()
    : false;
  await prisma.bigSellerSession.updateMany({
    where: { id: ID },
    data: err
      ? {
          lastErrorAt: now,
          lastErrorKind: err.kind ?? "unknown",
          lastError: err.message?.slice(0, 2000),
          ...(err.kind === "auth" || err.kind === "no-cookie" ? { deadCookie: api.getCookie() } : {}),
        }
      : { lastOkAt: now, deadCookie: null },
  });
  if (wasAlive) {
    // ไม่ await ต่อ — ส่ง LINE ช้า/พังต้องไม่ทำให้งาน BigSeller ช้าตาม
    void notify("cookie", cookieDeadText(err!.kind!)).catch((e) => console.warn("[line] แจ้ง cookie ไม่สำเร็จ:", e));
  }
}

/** แปะ cookie ใหม่จากหน้าเว็บ */
export async function saveCookie(cookie: string) {
  await saving;
  const data = { cookie, deadCookie: null, lastErrorKind: null, lastError: null };
  await prisma.bigSellerSession.upsert({ where: { id: ID }, update: data, create: { id: ID, ...data } });
  (await importApi()).setCookie(cookie);
}

export const KEEPALIVE_MINUTES = Number(process.env.BIGSELLER_KEEPALIVE_MINUTES ?? 15);

/**
 * ต่ออายุ session — ยิง request เบาที่สุด (ใบนำจ่าย 1 แถว) ให้ BigSeller หมุน cookie ให้
 *
 * ข้ามรอบเมื่อ: ไม่มี cookie / cookie นี้โดน auth error ไปแล้ว / เพิ่งยิงผ่านภายในรอบนี้
 * → วันละไม่เกิน 96 ครั้ง (ทุก 15 นาที) และไม่ยิงซ้ำด้วย cookie ที่ตายแล้ว
 */
export async function keepAlive({ force = false } = {}) {
  const api = await loadApi();
  const s = await getSession();
  if (!s?.cookie) return { ran: false, reason: "ยังไม่มี cookie" };
  if (!force && s.deadCookie === s.cookie) return { ran: false, reason: "cookie ใช้ไม่ได้แล้ว รอแปะใหม่" };

  const lastOk = Math.max(api.getLastOkAt(), s.lastOkAt?.getTime() ?? 0);
  if (!force && Date.now() - lastOk < KEEPALIVE_MINUTES * 60_000 * 0.9) {
    return { ran: false, reason: "เพิ่งยิงผ่านไป ไม่ต้องต่ออายุ" };
  }

  try {
    await api.listManifests({ pageSize: 1 });
    await recordResult(api);
    await prisma.bigSellerSession.update({ where: { id: ID }, data: { lastKeepAliveAt: new Date() } });
    return { ran: true, ok: true, reason: "cookie ยังใช้ได้" };
  } catch (e) {
    const err = e as Error & { kind?: string };
    await recordResult(api, err);
    return { ran: true, ok: false, reason: err.message, errorKind: err.kind };
  }
}
