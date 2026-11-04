import { lineConfig, replyText, verifyLineSignature } from "@/lib/line";

/**
 * Webhook ของ LINE (ตั้งใน LINE Developers → Messaging API → Webhook URL = https://<เว็บ>/api/line/webhook)
 *
 * มีไว้ช่วยหา LINE_TO อย่างเดียว: เชิญบอทเข้ากลุ่ม แล้วพิมพ์ "id" → บอทตอบ groupId ของกลุ่มนั้น
 * (แชท 1:1 กับบอท พิมพ์ "id" ได้ userId) — ไม่ได้เก็บข้อความใด ๆ ลงระบบ
 *
 * ไม่ต้อง login (LINE เรียกเข้ามาเอง) — ตรวจลายเซ็น x-line-signature ด้วย LINE_CHANNEL_SECRET แทน
 * ยกเว้นไว้ใน src/proxy.ts แล้ว
 */

type Source = { type: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
type LineWebhookEvent = {
  type: string;
  replyToken?: string;
  source?: Source;
  message?: { type: string; text?: string };
};

const ID_COMMAND = /^\s*(id|ไอดี|groupid|group id)\s*$/i;

function describe(source: Source | undefined) {
  if (!source) return null;
  const id = source.groupId ?? source.roomId ?? source.userId;
  if (!id) return null;
  const what = source.type === "group" ? "กลุ่มนี้" : source.type === "room" ? "ห้องนี้" : "แชทนี้ (ส่วนตัว)";
  const already = lineConfig().to.includes(id);
  return [
    `รหัสของ${what}:`,
    id,
    "",
    already
      ? "✅ อยู่ใน LINE_TO แล้ว — ระบบจะส่งแจ้งเตือนมาที่นี่"
      : "ใส่ค่านี้ใน LINE_TO ในไฟล์ .env (หลายที่คั่นด้วย ,) แล้วรีสตาร์ทเว็บ",
  ].join("\n");
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }

  let events: LineWebhookEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineWebhookEvent[] }).events ?? [];
  } catch {
    return Response.json({ error: "bad body" }, { status: 400 });
  }

  // ปุ่ม Verify ใน LINE Developers ส่ง events ว่าง — ตอบ 200 ก็พอ
  for (const e of events) {
    if (!e.replyToken) continue;
    if (e.type === "join") {
      await replyText(e.replyToken, "สวัสดีครับ บอทแจ้งเตือน TrackFlow 🚚\nพิมพ์ \"id\" เพื่อดูรหัสกลุ่มนี้ สำหรับตั้งค่าให้ระบบส่งแจ้งเตือนมาที่นี่");
    } else if (e.type === "follow") {
      await replyText(e.replyToken, "บอทแจ้งเตือน TrackFlow 🚚\nพิมพ์ \"id\" เพื่อดูรหัสแชทนี้");
    } else if (e.type === "message" && e.message?.type === "text" && ID_COMMAND.test(e.message.text ?? "")) {
      const text = describe(e.source);
      if (text) await replyText(e.replyToken, text);
    }
  }
  return Response.json({ ok: true });
}
