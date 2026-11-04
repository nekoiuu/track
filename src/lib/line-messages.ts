import "server-only";
import { db } from "./db";
import { fmtDate, fmtDateTime, fmtDuration, fmtTime } from "./format";
import { appLink, notify } from "./line";
import { STATUS_CAT, statusCat, type StatusCat } from "./status-cat";
import { takenOf } from "./shipping";

/**
 * ข้อความแจ้งเตือน LINE ของแต่ละเหตุการณ์ — เรียกผ่าน after() เสมอ ไม่ให้ปุ่มบนเว็บช้าลง
 * ส่งไม่สำเร็จแค่ log ไว้ ไม่กระทบงานหลัก
 */

/** ประกอบข้อความ — "" = บรรทัดว่างคั่นหัวข้อ (เก็บไว้) · null/false = ไม่มีข้อมูล (ตัดทิ้ง) */
const compose = (lines: (string | null | undefined | false)[]) =>
  lines
    .filter((l): l is string => typeof l === "string")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * รายงานรอบรถ 1 คัน — ใช้ทั้งตอนปิดงาน (อัตโนมัติ) และปุ่ม "ส่งเข้า LINE" (ส่งได้ทั้งตอนกำลังทำ/ปิดแล้ว)
 * @returns ข้อความ หรือ null ถ้าไม่พบรอบรถ
 */
export async function pickupReportText(pickupId: string, { statusNote }: { statusNote?: string | null } = {}) {
  const p = await db.pickup.findUnique({
    where: { id: pickupId },
    select: {
      plate: true,
      carrier: true,
      driverName: true,
      recordedBy: true,
      status: true,
      arrivedAt: true,
      departedAt: true,
      parcelCount: true,
      note: true,
      manifests: {
        orderBy: { createdAt: "asc" },
        select: {
          code: true,
          note: true,
          manifestId: true,
          parcelCount: true,
          manifest: { select: { manifestNo: true, parcelCount: true, _count: { select: { parcels: true } } } },
        },
      },
    },
  });
  if (!p) return null;

  const manifestIds = p.manifests.map((pm) => pm.manifestId).filter((id): id is string => Boolean(id));
  // สถานะใน BigSeller ของทุกชิ้นบนรถคันนี้ (ดึงใหม่ก่อนเรียกฟังก์ชันนี้แล้ว — refreshPickupStatuses)
  const parcels = manifestIds.length
    ? await db.manifestParcel.findMany({
        where: { manifestId: { in: manifestIds } },
        orderBy: { trackingNo: "asc" },
        select: { trackingNo: true, orderNo: true, status: true, bsState: true, bsStatusText: true, flashState: true },
      })
    : [];
  const byCat = new Map<StatusCat, typeof parcels>();
  let unknown = 0;
  for (const x of parcels) {
    if (x.flashState == null && !x.bsState && !x.bsStatusText && x.status !== "CANCELLED_AFTER") {
      unknown++;
      continue;
    }
    const c = statusCat(x);
    byCat.set(c, [...(byCat.get(c) ?? []), x]);
  }
  const n = (c: StatusCat) => byCat.get(c)?.length ?? 0;
  // 3 สถานะหลักโชว์เสมอ (แม้เป็น 0) · ที่เหลือโชว์เมื่อมี
  const shown: StatusCat[] = ["shipped", "waiting", "cancel", ...(["done", "problem", "other"] as StatusCat[]).filter((c) => n(c) > 0)];
  const cancelledList = byCat.get("cancel") ?? [];
  const SHOW = 10;

  const done = p.status === "DONE";
  const total = p.manifests.reduce((n, pm) => n + takenOf(pm), 0);
  const mismatch = p.parcelCount != null && total > 0 && p.parcelCount !== total;
  const lines = p.manifests.map((pm) => {
    if (!pm.manifest) return `• ${pm.code} — ยังไม่พบใบ`;
    const got = pm.manifest._count.parcels;
    const want = pm.manifest.parcelCount;
    const count = want != null && want !== got ? `${got}/${want}` : `${got}`;
    // ใบแบ่งหลายคัน — บอกว่าคันนี้รับไปเท่าไหร่จากทั้งใบ
    const split = pm.parcelCount != null ? `คันนี้ ${pm.parcelCount}/${count}` : count;
    return `• ${pm.manifest.manifestNo} · ${split} ชิ้น${pm.note ? ` (${pm.note})` : ""}`;
  });

  return compose([
    done ? `🚚 ปิดงาน ${p.plate}${p.carrier ? ` · ${p.carrier}` : ""}` : `⏳ กำลังรับของ ${p.plate}${p.carrier ? ` · ${p.carrier}` : ""}`,
    done
      ? `${fmtDate(p.arrivedAt)} · เริ่ม ${fmtTime(p.arrivedAt)} – ปิด ${fmtTime(p.departedAt)} (${fmtDuration(p.arrivedAt, p.departedAt) ?? "—"})`
      : `${fmtDate(p.arrivedAt)} · เริ่ม ${fmtTime(p.arrivedAt)} · ผ่านไป ${fmtDuration(p.arrivedAt, new Date()) ?? "—"} (ยังไม่ปิดงาน)`,
    "",
    `ใบนำจ่าย ${p.manifests.length} ใบ · ${total} ชิ้นในระบบ`,
    ...lines,
    "",
    p.parcelCount != null ? `รถนับ ${p.parcelCount} ชิ้น${mismatch ? ` ⚠️ ไม่ตรงกับระบบ (${total})` : " ✅ ตรงกับระบบ"}` : done && "รถนับ: ไม่ได้ใส่",
    parcels.length > 0 && "",
    parcels.length > 0 && `สถานะพัสดุ — Flash (${fmtTime(new Date())})`,
    ...(parcels.length ? shown.map((c) => `${STATUS_CAT[c].emoji} ${STATUS_CAT[c].label} ${n(c)} ชิ้น`) : []),
    unknown > 0 && `⚪ ยังไม่มีสถานะ ${unknown} ชิ้น`,
    ...(cancelledList.length
      ? [
          `🔴 ยกเลิก — ต้องตามคืน:`,
          ...cancelledList.slice(0, SHOW).map((x) => `   ${x.trackingNo}${x.orderNo ? ` · ${x.orderNo}` : ""}`),
          ...(cancelledList.length > SHOW ? [`   …และอีก ${cancelledList.length - SHOW} ชิ้น`] : []),
        ]
      : []),
    statusNote,
    "",
    p.driverName && `คนขับ: ${p.driverName}`,
    p.recordedBy && `ผู้จด: ${p.recordedBy}`,
    p.note && `หมายเหตุ: ${p.note}`,
    appLink(`/pickups/${pickupId}`),
  ]);
}

/** สรุปรอบรถตอนปิดงาน (อัตโนมัติ) — หลักฐานส่งมอบให้ขนส่ง · เรียก refreshPickupStatuses ก่อนเพื่อได้สถานะล่าสุด */
export async function notifyPickupClosed(pickupId: string, statusNote?: string | null) {
  const text = await pickupReportText(pickupId, { statusNote });
  return text ? notify("close", text) : null;
}

/** รายงานประจำวัน — รถทุกคันที่เข้ารับในวันนั้น (ปุ่ม "ส่งสรุปวันนี้เข้า LINE") */
export async function dailyReportText(range: { gte: Date; lt: Date }) {
  const pickups = await db.pickup.findMany({
    where: { arrivedAt: range },
    orderBy: { arrivedAt: "asc" },
    select: {
      plate: true,
      carrier: true,
      status: true,
      arrivedAt: true,
      departedAt: true,
      parcelCount: true,
      manifests: { select: { manifestId: true, parcelCount: true, manifest: { select: { _count: { select: { parcels: true } } } } } },
    },
  });

  const manifestIds = [...new Set(pickups.flatMap((p) => p.manifests.map((pm) => pm.manifestId)).filter((id): id is string => Boolean(id)))];
  const cancelled = manifestIds.length
    ? await db.manifestParcel.count({ where: { manifestId: { in: manifestIds }, status: "CANCELLED_AFTER" } })
    : 0;

  let totalParcels = 0;
  let mismatches = 0;
  const lines = pickups.map((p) => {
    const parcels = p.manifests.reduce((n, pm) => n + takenOf(pm), 0);
    totalParcels += parcels;
    const off = p.parcelCount != null && parcels > 0 && p.parcelCount !== parcels;
    if (off) mismatches++;
    const time = p.status === "DONE" ? `${fmtTime(p.arrivedAt)}–${fmtTime(p.departedAt)}` : `${fmtTime(p.arrivedAt)}– ⏳`;
    return `• ${p.plate}${p.carrier ? ` (${p.carrier})` : ""} ${time} · ${p.manifests.length} ใบ · ${parcels} ชิ้น${off ? ` ⚠️ รถนับ ${p.parcelCount}` : ""}`;
  });
  const doing = pickups.filter((p) => p.status === "DOING").length;

  return compose([
    `📋 สรุปรถเข้ารับ ${fmtDate(range.gte)}`,
    pickups.length
      ? `${pickups.length} คัน · ปิดงาน ${pickups.length - doing}${doing ? ` · กำลังทำ ${doing}` : ""} · ${manifestIds.length} ใบ · ${totalParcels} ชิ้น`
      : "วันนี้ยังไม่มีรถเข้ารับ",
    "",
    ...lines,
    "",
    mismatches > 0 && `⚠️ จำนวนรถนับไม่ตรงกับระบบ ${mismatches} คัน`,
    cancelled > 0 && `⚠️ ยกเลิกหลังขึ้นรถ ${cancelled} ชิ้น — ต้องตามคืน`,
    `ส่งเมื่อ ${fmtDateTime(new Date())}`,
    appLink("/"),
  ]);
}

/** พัสดุที่เพิ่งพบว่ายกเลิกหลังขึ้นรถ — ของไปกับรถแล้ว ต้องตามคืนจากขนส่ง */
export async function notifyCancelledAfter(parcelIds: string[]) {
  if (!parcelIds.length) return null;
  const parcels = await db.manifestParcel.findMany({
    where: { id: { in: parcelIds } },
    orderBy: { trackingNo: "asc" },
    select: {
      trackingNo: true,
      orderNo: true,
      manifest: {
        select: {
          manifestNo: true,
          pickups: { orderBy: { createdAt: "desc" }, take: 1, select: { pickup: { select: { plate: true, departedAt: true } } } },
        },
      },
    },
  });
  if (!parcels.length) return null;

  const SHOW = 30;
  const lines = parcels.slice(0, SHOW).map((p) => {
    const truck = p.manifest.pickups[0]?.pickup;
    return `• ${p.trackingNo}${p.orderNo ? ` · ${p.orderNo}` : ""}\n   ${p.manifest.manifestNo}${truck ? ` · รถ ${truck.plate} (${fmtDateTime(truck.departedAt)})` : ""}`;
  });
  const more = parcels.length > SHOW ? [`…และอีก ${parcels.length - SHOW} ชิ้น`] : [];

  const text = [
    `⚠️ ยกเลิกหลังขึ้นรถ ${parcels.length} ชิ้น`,
    "ของไปกับรถแล้ว แต่ BigSeller ขึ้นยกเลิก — ต้องตามคืนจากขนส่ง",
    "",
    ...lines,
    ...more,
    "",
    appLink("/cancelled"),
  ]
    .join("\n")
    .trim();

  return notify("cancelled", text);
}
