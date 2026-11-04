import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * แจ้งเตือนผ่าน LINE Messaging API (LINE Official Account) — ไม่ต้องลง package ยิง REST ตรง
 * (LINE Notify ปิดบริการไปแล้วตั้งแต่ 31 มี.ค. 2025 ต้องใช้ Messaging API แทน)
 *
 * ตั้งค่าใน .env (ดู .env.example):
 *   LINE_CHANNEL_ACCESS_TOKEN   Long-lived channel access token (LINE Developers → Messaging API)
 *   LINE_CHANNEL_SECRET         Channel secret (Basic settings) — ใช้ตรวจ webhook
 *   LINE_TO                     groupId / userId ที่จะส่งไป (หลายที่คั่นด้วย ,) — พิมพ์ "id" ในกลุ่ม บอทจะตอบให้
 *   LINE_NOTIFY                 เหตุการณ์ที่จะส่ง (คั่นด้วย ,) ค่าเริ่มต้น close,cancelled,cookie
 *   APP_URL                     (ไม่บังคับ) ลิงก์กลับเข้าเว็บในข้อความ เช่น https://shipped.example.com
 *   LINE_DRY_RUN=1              ไม่ส่งจริง พิมพ์ข้อความลง log ของ server แทน (ดูหน้าตาข้อความก่อนตั้งค่าจริง)
 *
 * ไม่มี "server-only" — bigseller-session.ts (ที่ instrumentation ใช้) เรียกแจ้งเตือน cookie หมดอายุ
 * อ่านค่าใหม่ทุกครั้ง แก้ .env แล้วใช้ได้เลย (dev)
 */

const API = "https://api.line.me/v2/bot";

export const LINE_EVENTS = {
  close: "ปิดงานรถเข้ารับ — สรุปรอบรถ",
  cancelled: "พบพัสดุยกเลิกหลังขึ้นรถ",
  cookie: "cookie BigSeller ใช้ไม่ได้",
} as const;
export type LineEvent = keyof typeof LINE_EVENTS;

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");

export function lineConfig() {
  const events = clean(process.env.LINE_NOTIFY || "close,cancelled,cookie")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is LineEvent => s in LINE_EVENTS);
  return {
    token: clean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    secret: clean(process.env.LINE_CHANNEL_SECRET),
    to: clean(process.env.LINE_TO)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    events,
    appUrl: clean(process.env.APP_URL).replace(/\/+$/, ""),
    dryRun: clean(process.env.LINE_DRY_RUN) === "1",
  };
}

/** ส่งได้ไหม (มี token + ปลายทาง) — ไม่ครบ = ไม่ส่งเงียบ ๆ ระบบอื่นทำงานตามปกติ */
export const lineConfigured = () => {
  const c = lineConfig();
  return c.dryRun || Boolean(c.token && c.to.length);
};

/** ลิงก์กลับเข้าเว็บ — ไม่ได้ตั้ง APP_URL ก็ไม่ใส่ */
export const appLink = (path: string) => {
  const { appUrl } = lineConfig();
  return appUrl ? `${appUrl}${path}` : "";
};

// ข้อความ LINE ยาวได้ 5,000 ตัวอักษร — ตัดไว้ก่อนกันโดนปฏิเสธทั้งข้อความ
const MAX_TEXT = 4900;
const fit = (text: string) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(ตัดข้อความ)` : text);

export type LineResult = { ok: boolean; sent: number; error?: string };

async function call(path: string, body: object, token: string) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { message?: string; details?: { message?: string }[] };
  return `${res.status} ${json.message ?? ""}${json.details?.length ? ` (${json.details.map((d) => d.message).join(", ")})` : ""}`.trim();
}

/** ข้อความที่คนอ่านเข้าใจ จากรหัส error ของ LINE */
export function lineHint(error: string) {
  if (/^401/.test(error)) return "token ไม่ถูกต้องหรือหมดอายุ — เช็ค LINE_CHANNEL_ACCESS_TOKEN";
  if (/^400/.test(error) && /to|invalid/i.test(error)) return "ปลายทางไม่ถูกต้อง — เช็ค LINE_TO (ต้องเป็น groupId / userId และบอทต้องอยู่ในกลุ่มนั้น)";
  if (/^429/.test(error)) return "ส่งเกินโควตาข้อความของเดือนนี้ หรือยิงถี่เกิน";
  return `ส่ง LINE ไม่สำเร็จ: ${error}`;
}

/** ส่งข้อความไปทุกปลายทางใน LINE_TO — ไม่ throw (แจ้งเตือนพังต้องไม่ทำให้งานหลักพัง) */
export function pushText(text: string): Promise<LineResult> {
  return pushMessages([{ type: "text", text: fit(text) }], text);
}

/**
 * ข้อความแบบการ์ด (Flex) — มีสี/ตาราง · altText = ข้อความที่ขึ้นในแจ้งเตือนมือถือ / รายการแชท
 * @see https://developers.line.biz/en/docs/messaging-api/using-flex-messages/
 */
export function pushFlex(altText: string, contents: object, preview?: string): Promise<LineResult> {
  return pushMessages([{ type: "flex", altText: altText.slice(0, 400), contents }], preview ?? altText);
}

async function pushMessages(messages: object[], preview: string): Promise<LineResult> {
  const { token, to, dryRun } = lineConfig();
  if (dryRun) {
    const size = JSON.stringify(messages).length;
    console.log(`[line] (dry run → ${to.join(", ") || "ไม่มี LINE_TO"} · ${size} bytes)\n${fit(preview)}\n[line] ─────`);
    return { ok: true, sent: 0 };
  }
  if (!token || !to.length) return { ok: false, sent: 0, error: "ยังไม่ได้ตั้งค่า LINE ใน .env" };
  let sent = 0;
  const errors: string[] = [];
  for (const target of to) {
    try {
      const err = await call("/message/push", { to: target, messages }, token);
      if (err) errors.push(err);
      else sent++;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) console.warn("[line] ส่งไม่สำเร็จ:", errors.join(" | "));
  return errors.length ? { ok: sent > 0, sent, error: errors[0] } : { ok: true, sent };
}

/** แจ้งเตือนตามเหตุการณ์ — เหตุการณ์ที่ไม่ได้เปิดใน LINE_NOTIFY / ยังไม่ตั้งค่า = ข้ามเงียบ ๆ */
export async function notify(event: LineEvent, text: string): Promise<LineResult | null> {
  if (!lineConfigured() || !lineConfig().events.includes(event)) return null;
  return pushText(text);
}

/** ตอบกลับใน webhook (ไม่นับโควตาข้อความ) */
export async function replyText(replyToken: string, text: string) {
  const { token, dryRun } = lineConfig();
  if (dryRun) return void console.log(`[line] (dry run reply)\n${fit(text)}\n[line] ─────`);
  if (!token) return;
  const err = await call("/message/reply", { replyToken, messages: [{ type: "text", text: fit(text) }] }, token).catch((e) => String(e));
  if (err) console.warn("[line] ตอบกลับไม่สำเร็จ:", err);
}

/** ตรวจว่า webhook มาจาก LINE จริง (HMAC-SHA256 ของ body ด้วย channel secret) */
export function verifyLineSignature(rawBody: string, signature: string | null) {
  const { secret } = lineConfig();
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const got = Buffer.from(signature, "base64");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** cookie BigSeller ใช้ไม่ได้ — ส่งครั้งเดียวต่อ cookie (เรียกจาก bigseller-session ตอนเพิ่งตาย) */
export function cookieDeadText(kind: string) {
  return [
    "🔑 เชื่อม BigSeller ไม่ได้",
    kind === "no-cookie" ? "ยังไม่ได้ตั้ง cookie" : "cookie หมดอายุหรือถูกออกจากระบบ",
    "ดึงใบนำจ่าย / เลขแทร็คกิ้ง / สถานะ จะหยุดจนกว่าจะแปะ cookie ใหม่",
    appLink("/sync") || "แปะใหม่ที่หน้า BigSeller (/sync) ในเว็บ",
  ].join("\n");
}
