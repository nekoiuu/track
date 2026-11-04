import "server-only";
import { db } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { canCallBigSeller, syncManifestStatuses } from "./bigseller";
import { flashWebCooldown, refreshFlashStatuses } from "./flash";
import { isFlashParcel } from "./flash-state";
import { recordChanges, snapshot } from "./parcel-events";
import { reportConfig } from "./status-report";

/**
 * อัปเดตสถานะเบื้องหลังเป็นรอบ ๆ (แทนการยิงตอนเปิดหน้า) — เรียกจาก /api/track/tick
 * ตั้งเวลาด้วย TRACK_TICK_MINUTES (src/lib/track-config.ts)
 *
 * ต่อ 1 รอบ (ค่าเริ่มต้นทุก 15 นาที):
 *   1) Flash — ชิ้นที่ยังไม่จบ เรียงจากที่เช็คนานที่สุดก่อน ไม่เกิน TRACK_TICK_FLASH_LIMIT ชิ้น
 *      (Open API ก่อน · ที่เหลือค่อยถามหน้าเว็บ · หน้าเว็บโดนจำกัด → พักเอง ดู flashWebCooldown)
 *   2) BigSeller — ใบที่ดึงสถานะนานกว่า TRACK_BS_STALE_MINUTES ไม่เกิน TRACK_TICK_BS_MANIFESTS ใบ (SPX / ขนส่งอื่น ใช้สถานะจากตรงนี้)
 *
 * เฉพาะชิ้นที่ขึ้นรถที่ปิดงานแล้วภายใน STATUS_TRACK_DAYS วัน และยังไม่จบ (เหมือนรายงานประจำวัน)
 */

const DAY = 86_400_000;
const num = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);

export const tickConfig = () => ({
  flashLimit: num("TRACK_TICK_FLASH_LIMIT", 400),
  flashStaleMinutes: num("TRACK_FLASH_STALE_MINUTES", 120),
  bsStaleMinutes: num("TRACK_BS_STALE_MINUTES", 60),
  bsManifests: num("TRACK_TICK_BS_MANIFESTS", 20),
});

/** ขึ้นรถที่ปิดงานแล้วภายใน trackDays วัน */
export const departedWithin = (trackDays: number): Prisma.ManifestWhereInput => ({
  pickups: { some: { pickup: { status: "DONE", departedAt: { gte: new Date(Date.now() - trackDays * DAY) } } } },
});

export const tracked = (trackDays: number): Prisma.ManifestParcelWhereInput => ({
  trackingDoneAt: null,
  status: { notIn: ["DELIVERED", "RETURNED", "CANCELLED_AFTER"] },
  manifest: departedWithin(trackDays),
});

/**
 * ใบนำจ่ายที่ถึงเวลาดึงสถานะจาก BigSeller ใหม่ (ดึงล่าสุดก่อน staleMinutes) — เก่าสุดก่อน
 */
export async function staleManifests(staleMinutes: number, take: number) {
  const { trackDays } = reportConfig();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const rows = await db.manifest.findMany({
    where: {
      ...departedWithin(trackDays),
      parcels: { some: { trackingDoneAt: null } },
      OR: [{ statusesFetchedAt: null }, { statusesFetchedAt: { lt: cutoff } }],
    },
    orderBy: { statusesFetchedAt: { sort: "asc", nulls: "first" } },
    take,
    select: { id: true },
  });
  return rows.map((m) => m.id);
}

const g = globalThis as unknown as { __trackTickRunning?: boolean };

export type TickResult = { ran: boolean; ok: boolean; message: string };

export async function runTrackingTick(): Promise<TickResult> {
  if (g.__trackTickRunning) return { ran: false, ok: true, message: "รอบก่อนยังทำไม่เสร็จ" };
  g.__trackTickRunning = true;
  // ตั้ง flag แล้วทุกอย่างต้องอยู่ใน try — ถ้าพังก่อนถึง finally flag จะค้าง แล้วรอบหลังจากนี้ไม่ทำงานเลยจนรีสตาร์ท
  let runId: string | null = null;
  try {
    runId = (await db.syncRun.create({ data: { kind: "track-tick" } })).id;
    const notes: string[] = [];
    let ok = true;
    let count = 0;
    const cfg = tickConfig();
    const { trackDays } = reportConfig();

    // 1) Flash — เก่าสุดก่อน
    const flashCutoff = new Date(Date.now() - cfg.flashStaleMinutes * 60_000);
    const flashRows = await db.manifestParcel.findMany({
      where: {
        AND: [
          tracked(trackDays),
          { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] },
          { OR: [{ flashFetchedAt: null }, { flashFetchedAt: { lt: flashCutoff } }] },
        ],
      },
      orderBy: { flashFetchedAt: { sort: "asc", nulls: "first" } },
      take: cfg.flashLimit * 2,
      select: { id: true, shippingMethod: true },
    });
    const flashIds = flashRows.filter(isFlashParcel).slice(0, cfg.flashLimit).map((p) => p.id);
    if (flashIds.length) {
      const r = await refreshFlashStatuses({ parcelIds: flashIds }, { staleMinutes: cfg.flashStaleMinutes }).catch((e) => ({
        ok: false,
        count: 0,
        message: e instanceof Error ? e.message : String(e),
      }));
      count += r.count;
      notes.push(`Flash: ${r.message}`);
      if (!r.ok) ok = false;
    }
    const cool = flashWebCooldown();
    if (cool) notes.push(`พักยิงหน้าเว็บ Flash ถึง ${cool.until.toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" })} (${cool.reason})`);

    // 2) BigSeller — ใบที่ดึงสถานะนานแล้ว (SPX / จับยกเลิก)
    if (await canCallBigSeller()) {
      const manifestIds = await staleManifests(cfg.bsStaleMinutes, cfg.bsManifests);
      if (manifestIds.length) {
        // ถ่ายก่อน/หลัง → ParcelEvent (หน้าติดตามรู้ว่ามีอะไรเปลี่ยนแล้ว refresh เอง — SPX / ขนส่งอื่น มีแต่ทางนี้)
        const ids = (
          await db.manifestParcel.findMany({ where: { manifestId: { in: manifestIds }, trackingDoneAt: null }, select: { id: true } })
        ).map((p) => p.id);
        const before = await snapshot(ids);
        const r = await syncManifestStatuses(manifestIds, { notify: true, untrackedOnly: true }).catch((e) => ({
          ok: false as const,
          count: 0,
          message: e instanceof Error ? e.message : String(e),
        }));
        // แจ้ง LINE ยกเลิกหลังขึ้นรถ syncManifestStatuses ทำเองแล้ว (notify) — ตรงนี้แค่บันทึก event
        await recordChanges(before, await snapshot(ids), "bigseller").catch((e) => notes.push(`บันทึก event ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`));
        count += r.count;
        notes.push(`BigSeller ${manifestIds.length} ใบ: ${r.message.split("\n")[0]}`);
        if (!r.ok) ok = false;
      }
    } else notes.push("BigSeller: ยังเชื่อมไม่ได้ — ข้าม");

    const message = notes.join("\n") || "ไม่มีชิ้นที่ต้องเช็ค";
    await db.syncRun.update({ where: { id: runId }, data: { ok, finishedAt: new Date(), count, message: message.slice(0, 2000) } });
    return { ran: true, ok, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (runId) {
      await db.syncRun.update({ where: { id: runId }, data: { ok: false, finishedAt: new Date(), message: message.slice(0, 2000) } }).catch(() => null);
    }
    return { ran: true, ok: false, message };
  } finally {
    g.__trackTickRunning = false;
  }
}
