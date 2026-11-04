import { applyFlashWebhook } from "@/lib/flash";
import { verifyFlashWebhook } from "@/lib/flash-open";

/**
 * Webhook จาก Flash Express Open API — ความเคลื่อนไหวพัสดุ (webhookApiCode 4)
 * ตั้งปลายทางที่หน้า /sync → "ตั้ง webhook" · URL ต้องเป็น https ที่ Flash เข้าถึงได้
 *
 * ไม่ต้อง login (ยกเว้นไว้ใน src/proxy.ts) — ตรวจลายเซ็นด้วย FLASH_OPEN_KEY แทน
 * ต้องตอบ {"errorCode":"1","state":"success"} ไม่งั้น Flash ส่งซ้ำเรื่อย ๆ
 */

export const dynamic = "force-dynamic";

const ok = () => Response.json({ errorCode: "1", state: "success" });
const fail = (status = 200) => Response.json({ errorCode: "0" }, { status });

/** รับได้ทั้ง JSON และ form-urlencoded · data อาจมาเป็น object หรือ JSON string */
async function readPayload(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (!text) return null;
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(text);
  } catch {
    p = Object.fromEntries(new URLSearchParams(text));
  }
  if (typeof p.data === "string") {
    try {
      p.data = JSON.parse(p.data);
    } catch {
      /* ปล่อยเป็นข้อความ */
    }
  }
  return p;
}

export async function POST(req: Request) {
  const payload = await readPayload(req);
  if (!payload) return fail(400);
  if (!verifyFlashWebhook(payload)) {
    console.warn("[flash webhook] ลายเซ็นไม่ถูกต้อง");
    return fail(401);
  }
  try {
    const data = payload.data;
    // อาจมาทีละชิ้น หรือเป็น array
    const list = (Array.isArray(data) ? data : [data]).filter((d): d is Record<string, unknown> => Boolean(d) && typeof d === "object");
    for (const d of list) await applyFlashWebhook(d);
    return ok();
  } catch (e) {
    console.error("[flash webhook] บันทึกไม่สำเร็จ:", e);
    // ตอบไม่สำเร็จ → Flash ส่งซ้ำให้ทีหลัง
    return fail(500);
  }
}
