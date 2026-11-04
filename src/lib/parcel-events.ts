import "server-only";
import { db } from "./db";
import { PARCEL_STATUS_LABEL } from "./bigseller";
import { FLASH_STATE } from "./flash-state";
import type { ParcelStatus } from "@/generated/prisma/enums";

/** เก็บ ParcelEvent ย้อนหลังกี่ ms */
const EVENT_KEEP_MS = 2 * 86_400_000;

/**
 * บันทึกการเปลี่ยนสถานะ (ParcelEvent) — ถ่ายสถานะก่อน/หลังเช็ค แล้วเขียนเฉพาะที่เปลี่ยน
 * ใช้โดยรอบเบื้องหลัง (src/lib/track-tick.ts) · หน้าเว็บดู /api/track/changes แล้ว refresh เองเมื่อมี event ใหม่
 */

type Snap = { trackingNo: string; flashState: number | null; flashStateText: string | null; bsStatusText: string | null; status: ParcelStatus };

export async function snapshot(ids: string[]) {
  const rows = await db.manifestParcel.findMany({
    where: { id: { in: ids } },
    select: { id: true, trackingNo: true, flashState: true, flashStateText: true, bsStatusText: true, status: true, flashFetchedAt: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

const flashText = (s: number | null, t: string | null) => t ?? (s != null ? (FLASH_STATE[s]?.label ?? String(s)) : null);

/** เทียบก่อน/หลัง → เขียน ParcelEvent · @returns id ที่เพิ่งกลายเป็นยกเลิกหลังขึ้นรถ */
export async function recordChanges(before: Map<string, Snap>, after: Map<string, Snap>, source: "flash" | "bigseller") {
  const events: { parcelId: string; trackingNo: string; source: string; field: string; fromValue: string | null; toValue: string | null; text: string }[] = [];
  const cancelled: string[] = [];
  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    if (source === "flash" && a.flashState !== b.flashState && a.flashState != null) {
      events.push({
        parcelId: id,
        trackingNo: a.trackingNo,
        source,
        field: "flashState",
        fromValue: b.flashState?.toString() ?? null,
        toValue: a.flashState.toString(),
        text: `Flash: ${flashText(b.flashState, b.flashStateText) ?? "—"} → ${flashText(a.flashState, a.flashStateText)}`,
      });
    }
    if (source === "bigseller" && a.bsStatusText !== b.bsStatusText && a.bsStatusText) {
      events.push({
        parcelId: id,
        trackingNo: a.trackingNo,
        source,
        field: "bsStatus",
        fromValue: b.bsStatusText,
        toValue: a.bsStatusText,
        text: `BigSeller: ${b.bsStatusText ?? "—"} → ${a.bsStatusText}`,
      });
    }
    if (a.status !== b.status) {
      events.push({
        parcelId: id,
        trackingNo: a.trackingNo,
        source,
        field: "status",
        fromValue: b.status,
        toValue: a.status,
        text: `สถานะร้าน: ${PARCEL_STATUS_LABEL[b.status]} → ${PARCEL_STATUS_LABEL[a.status]}`,
      });
      if (a.status === "CANCELLED_AFTER") cancelled.push(id);
    }
  }
  if (events.length) await db.parcelEvent.createMany({ data: events });
  // ใช้แค่บอกหน้าติดตามว่า "มีอะไรเปลี่ยนในไม่กี่นาทีนี้" (/api/track/changes) ไม่มีหน้าไหนโชว์ประวัติ → เก็บ 2 วันพอ
  // (เคยสะสม 70k แถว 23 MB) · ลบบ้างเป็นครั้งคราว ไม่ต้องลบทุกรอบ
  if (Math.random() < 0.1) await db.parcelEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - EVENT_KEEP_MS) } } }).catch(() => null);
  return { events: events.length, cancelled };
}
