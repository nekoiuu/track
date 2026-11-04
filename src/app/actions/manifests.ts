"use server";

import { audit, requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { sheetsConfigured } from "@/lib/sheets";
import { updateSheetRowsFor } from "./sheets";

/**
 * สถานะเปลี่ยน → อัปเดตแถวที่เคยส่งไป Sheets ตามเอง (เบื้องหลัง หลังตอบหน้าเว็บแล้ว — ไม่ทำให้ปุ่มช้า)
 * รับผลของ refreshFlashStatuses (มี changedIds) หรือ id ตรง ๆ
 */
function syncSheets(r: unknown) {
  const ids = Array.isArray(r) ? (r as string[]) : r && typeof r === "object" && "changedIds" in r ? ((r as { changedIds?: string[] }).changedIds ?? []) : [];
  if (ids.length && sheetsConfigured()) after(() => updateSheetRowsFor(ids).catch((e) => console.warn("[sheets] อัปเดตตามสถานะไม่สำเร็จ:", e)));
}
import { db } from "@/lib/db";
import { fmtWeight, normalizeCode } from "@/lib/format";
import { totalWeight } from "@/lib/products";
import { createManualManifest, expandManifestCode, isFullManifestNo, linkPendingPickupManifests, orphanManifestWhere } from "@/lib/manifests";
import { fetchManifestTrackings, fetchParcelOrderLog, syncManifestStatuses, syncManifests } from "@/lib/bigseller";
import { refreshFlashStatuses } from "@/lib/flash";
import { flashOpenConfigured } from "@/lib/flash-open";
import { parcelTone, type FlashTone } from "@/lib/flash-state";
import { TRACK_COUNTS_TAG, TRACK_TABS, shippedSets, tabWhere, type TrackTab } from "@/lib/tracking";
import { requirePickupAccess, visiblePickupIds } from "@/lib/pickup-access";
import { ParcelStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type { FormState } from "./pickups";

export type SyncState = { ok: boolean; message: string; errorKind?: string } | undefined;

export async function createManifest(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const no = expandManifestCode(normalizeCode(String(form.get("manifestNo") ?? "")));
  if (!isFullManifestNo(no)) return { error: "ใส่ 4 หลักท้าย หรือเลขใบนำจ่ายเต็ม เช่น MFG963072007" };
  const m = await createManualManifest(no);
  audit(user, "manifest.create", "manifest", m.id, m.manifestNo);
  await linkPendingPickupManifests();
  revalidatePath("/", "layout");
  redirect(`/manifests/${m.id}`);
}

/**
 * ลบใบนำจ่าย + เลขแทร็คกิ้งในใบ + เลขที่จดใบนี้ไว้ในรอบรถ (ไม่งั้น sync ครั้งหน้าจะจับคู่กลับมาเอง)
 * ใบจาก BigSeller ถ้ายังอยู่ในรายการล่าสุด จะถูกดึงกลับมาเมื่อมีคนจดเลขนี้อีก
 * @param redirectTo ส่งเมื่อกดลบจากหน้ารายละเอียดใบ (หน้านั้นจะหายไป)
 */
export async function deleteManifest(id: string, redirectTo?: string) {
  const user = await requireUser();
  const [, m] = await db.$transaction([db.pickupManifest.deleteMany({ where: { manifestId: id } }), db.manifest.delete({ where: { id } })]);
  audit(user, "manifest.delete", "manifest", id, m.manifestNo);
  revalidatePath("/", "layout");
  if (redirectTo) redirect(redirectTo);
}

/** ฟอร์มในหน้าพัสดุ — ตรวจ login ใน editParcel */
export async function updateParcelStatus(id: string, form: FormData) {
  await editParcel(id, String(form.get("status")), String(form.get("statusNote") ?? ""));
}

/** แก้สถานะ + หมายเหตุ จาก popup ในตาราง (เช่น ยกเลิกกลางคันก่อนขึ้นรถ) — จำว่าใครแก้ */
export async function editParcel(id: string, rawStatus: string, rawNote: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const status = rawStatus as ParcelStatus;
  if (!Object.values(ParcelStatus).includes(status)) return { error: "สถานะไม่ถูกต้อง" };
  const note = rawNote.trim().slice(0, 500);
  const p = await db.manifestParcel.update({ where: { id }, data: { status, statusNote: note || null, statusBy: user.name } });
  audit(user, "parcel.status", "parcel", id, `${p.trackingNo} → ${status}${note ? ` · ${note}` : ""}`);
  syncSheets([id]);
  revalidatePath("/", "layout");
  return { ok: `บันทึก ${p.trackingNo} แล้ว` };
}

/** แก้สถานะหลายชิ้นพร้อมกัน (ติ๊กเลือกในตาราง) · note ว่าง = ไม่แตะหมายเหตุเดิม */
export async function editParcels(ids: string[], rawStatus: string, rawNote: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const status = rawStatus as ParcelStatus;
  if (!Object.values(ParcelStatus).includes(status)) return { error: "สถานะไม่ถูกต้อง" };
  const list = [...new Set(ids)].slice(0, 1000);
  if (!list.length) return { error: "ยังไม่ได้เลือกพัสดุ" };
  const note = rawNote.trim().slice(0, 500);
  const r = await db.manifestParcel.updateMany({
    where: { id: { in: list } },
    data: { status, statusBy: user.name, ...(note ? { statusNote: note } : {}) },
  });
  audit(user, "parcel.status", "parcel", null, `${r.count} ชิ้น → ${status}${note ? ` · ${note}` : ""}`);
  syncSheets(list);
  revalidatePath("/", "layout");
  return { ok: `เปลี่ยนสถานะ ${r.count} ชิ้นแล้ว` };
}

/** เช็ค Flash เฉพาะที่ติ๊กเลือก — หน้าเว็บแบ่งส่งทีละ 100 */
export async function runParcelsFlash(ids: string[]): Promise<SyncState> {
  const user = await requireUser();
  const r = await refreshFlashStatuses({ parcelIds: ids.slice(0, 100) }, { force: true });
  syncSheets(r);
  audit(user, "tracking.flash", "parcel", null, `เลือก ${ids.length} ชิ้น · ${r.message}`);
  revalidatePath("/", "layout");
  return { ok: r.ok, message: r.message };
}

export async function runManifestSync(): Promise<SyncState> {
  const user = await requireUser();
  const res = await syncManifests({ fresh: true });
  audit(user, "bigseller.sync", "manifest", null, res.message);
  revalidatePath("/", "layout");
  return { ok: res.ok, message: res.message, errorKind: res.ok ? undefined : res.errorKind };
}

/** ปุ่ม "ดึงเลขแทร็คกิ้งใหม่" ในหน้าใบนำจ่าย */
export async function runTrackingFetch(manifestId: string): Promise<SyncState> {
  const user = await requireUser();
  const t = await fetchManifestTrackings(manifestId, { force: true });
  audit(user, "manifest.fetch", "manifest", manifestId, t.ok ? `${t.count} ชิ้น` : "ไม่สำเร็จ");
  revalidatePath(`/manifests/${manifestId}`);
  const dup = t.duplicates.length ? ` · ซ้ำกับใบอื่น ${t.duplicates.length} ชิ้น` : "";
  return { ok: t.ok, message: t.ok ? `ได้ ${t.count}${t.expected != null ? `/${t.expected}` : ""} ชิ้น${dup}` : t.message };
}

/** ปุ่ม "รีโหลด" ในหน้าพัสดุ — สถานะ + ใครสแกน/พิมพ์ จาก BigSeller */
export async function runParcelOrderLog(parcelId: string): Promise<SyncState> {
  const user = await requireUser();
  const r = await fetchParcelOrderLog(parcelId, { force: true });
  audit(user, "parcel.reload", "parcel", parcelId, r.message);
  revalidatePath(`/parcels/${parcelId}`);
  return { ok: r.ok, message: r.message };
}

/** สถานะพัสดุ = ถามเว็บ Flash อย่างเดียว (ไม่ยิง BigSeller) */
async function refreshStatuses(manifestIds: string[], force = true, uncheckedOnly = false) {
  const flash = await refreshFlashStatuses({ manifestIds }, { force, uncheckedOnly });
  syncSheets(flash);
  // เฉพาะที่ยังไม่เช็ค แต่ไม่เหลือแล้ว → บอกให้ชัด
  if (uncheckedOnly && !flash.count) return { ok: true, message: "เช็คครบทุกชิ้นแล้ว — ไม่มีชิ้นที่ยังไม่เคยเช็ค" };
  return { ok: flash.ok, message: flash.message };
}

/** ปุ่ม "เช็คเฉพาะที่ยังไม่เช็ค" ในหน้าใบนำจ่าย — ไม่ถามชิ้นที่เคยเช็คแล้ว (เร็วกว่าเช็คทั้งใบ) */
export async function runManifestUncheckedFlash(manifestId: string): Promise<SyncState> {
  const user = await requireUser();
  const r = await refreshStatuses([manifestId], false, true);
  audit(user, "manifest.statuses", "manifest", manifestId, `เฉพาะที่ยังไม่เช็ค · ${r.message}`);
  revalidatePath("/", "layout");
  return r;
}

/** ปุ่มเดียวกันในหน้ารอบรถ */
export async function runPickupUncheckedFlash(pickupId: string): Promise<SyncState> {
  const user = await requirePickupAccess(pickupId);
  const pms = await db.pickupManifest.findMany({ where: { pickupId, manifestId: { not: null } }, select: { manifestId: true } });
  const r = await refreshStatuses([...new Set(pms.map((pm) => pm.manifestId!))], false, true);
  audit(user, "manifest.statuses", "pickup", pickupId, `เฉพาะที่ยังไม่เช็ค · ${r.message}`);
  revalidatePath("/", "layout");
  return r;
}

/** ปุ่ม "เช็คสถานะ Flash" ในหน้าใบนำจ่าย — ทุกชิ้นในใบพร้อมกัน */
export async function runManifestStatusSync(manifestId: string): Promise<SyncState> {
  const user = await requireUser();
  const r = await refreshStatuses([manifestId]);
  audit(user, "manifest.statuses", "manifest", manifestId, r.message);
  revalidatePath("/", "layout");
  return r;
}

/** ปุ่มเดียวกันในหน้ารอบรถ — ทุกใบที่รถคันนี้รับไป */
export async function runPickupStatusSync(pickupId: string): Promise<SyncState> {
  const user = await requirePickupAccess(pickupId);
  const pms = await db.pickupManifest.findMany({ where: { pickupId, manifestId: { not: null } }, select: { manifestId: true } });
  const r = await refreshStatuses([...new Set(pms.map((pm) => pm.manifestId!))]);
  audit(user, "manifest.statuses", "pickup", pickupId, r.message);
  revalidatePath("/", "layout");
  return r;
}

/** ปุ่ม "เช็ค Flash หน้านี้" ในหน้าติดตามสถานะ — เฉพาะชิ้นที่แสดงอยู่ (ไม่เกิน 1 หน้า) */
export async function runTrackingFlash(parcelIds: string[], uncheckedOnly = false): Promise<SyncState> {
  const user = await requireUser();
  // SyncButton ส่ง state ก่อนหน้าเป็นอาร์กิวเมนต์ที่ 2 → ต้องเป็น true จริง ๆ เท่านั้น
  const only = uncheckedOnly === true;
  const r = await refreshFlashStatuses({ parcelIds: parcelIds.slice(0, 100) }, only ? { uncheckedOnly: true } : { force: true });
  syncSheets(r);
  if (only && !r.count) return { ok: true, message: "หน้านี้เช็คครบทุกชิ้นแล้ว" };
  audit(user, "tracking.flash", "parcel", null, r.message);
  revalidatePath("/tracking");
  revalidateTag(TRACK_COUNTS_TAG, "max");
  return { ok: r.ok, message: r.message };
}

/**
 * เปิดหน้าติดตามสถานะ → เช็ค Flash เบื้องหลังเฉพาะชิ้นในหน้าที่ข้อมูลเก่า (ไม่ force · ข้ามชิ้นที่จบแล้ว/เพิ่งเช็ค)
 * ไม่ revalidate — หน้าเว็บเรียก router.refresh() เอง · ไม่บันทึกประวัติ (ทำเองทุกครั้งที่เปิดหน้า)
 */
export async function autoRefreshTrackingFlash(parcelIds: string[]): Promise<SyncState> {
  await requireUser();
  const r = await refreshFlashStatuses({ parcelIds: parcelIds.slice(0, 60) }, { staleMinutes: 30 });
  syncSheets(r);
  return { ok: r.ok, message: r.message };
}

/** ปุ่ม "เช็ค Flash" ในหน้าพัสดุ 1 ชิ้น */
export async function runParcelFlash(parcelId: string): Promise<SyncState> {
  const user = await requireUser();
  // หน้าพัสดุทีละชิ้น — คนสั่งเอง ถามได้แม้จบแล้ว
  const r = await refreshFlashStatuses({ parcelIds: [parcelId] }, { force: true, includeFinished: true });
  syncSheets(r);
  audit(user, "parcel.flash", "parcel", parcelId, r.message);
  revalidatePath(`/parcels/${parcelId}`);
  return { ok: r.ok, message: r.message };
}

/**
 * ปุ่ม "ดูน้ำหนักรวม" — ดึงรายการสินค้าในทุกกล่องจาก BigSeller (พร้อมสถานะ ใน request เดียวกัน)
 * แล้วรวม จำนวน × น้ำหนักต่อชิ้น จาก productData/products.json
 */
async function weightMessage(manifestIds: string[]) {
  const parcels = await db.manifestParcel.findMany({ where: { manifestId: { in: manifestIds } }, select: { items: true } });
  const w = totalWeight(parcels);
  return [
    `น้ำหนักรวม ${fmtWeight(w.grams)}`,
    w.missing && `ไม่มีรายการสินค้า ${w.missing} ชิ้น`,
    w.unknown.length && `ไม่รู้น้ำหนัก ${w.unknown.length} SKU`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function runManifestWeight(manifestId: string): Promise<SyncState> {
  const user = await requireUser();
  const r = await syncManifestStatuses([manifestId]);
  const message = r.ok ? await weightMessage([manifestId]) : r.message;
  audit(user, "manifest.weight", "manifest", manifestId, message);
  revalidatePath("/", "layout");
  return { ok: r.ok, message };
}

export async function runPickupWeight(pickupId: string): Promise<SyncState> {
  const user = await requirePickupAccess(pickupId);
  const pms = await db.pickupManifest.findMany({ where: { pickupId, manifestId: { not: null } }, select: { manifestId: true } });
  const ids = [...new Set(pms.map((pm) => pm.manifestId!))];
  const r = await syncManifestStatuses(ids);
  const message = r.ok ? await weightMessage(ids) : r.message;
  audit(user, "manifest.weight", "pickup", pickupId, message);
  revalidatePath("/", "layout");
  return { ok: r.ok, message };
}

export async function runLinkPending(): Promise<SyncState> {
  const user = await requireUser();
  const r = await linkPendingPickupManifests();
  audit(user, "manifest.link", "manifest", null, `${r.linked}/${r.pending}`);
  revalidatePath("/", "layout");
  return { ok: true, message: `จับคู่ได้ ${r.linked} จากที่ค้าง ${r.pending}` };
}

/** ปุ่ม "ลบใบที่ไม่มีรถรับ" ในหน้าใบนำจ่าย — เก็บกวาดใบค้างจากการลบรอบรถก่อนหน้า */
export async function runDeleteOrphanManifests() {
  const user = await requireUser();
  const r = await db.manifest.deleteMany({ where: orphanManifestWhere });
  audit(user, "manifest.cleanup", "manifest", null, `ลบใบที่ไม่มีรถรับ ${r.count} ใบ`);
  revalidatePath("/", "layout");
  return { ok: `ลบ ${r.count} ใบแล้ว` };
}

/** ต่อรอบไม่เกินเท่านี้ — หน้าเว็บ Flash ให้ถามได้ ~500 เลขต่อนาที (เกินแล้วตอบ "ดำเนินการบ่อยเกินไป") */
const FLASH_ROUND = 400;

export type FlashRoundState = { ok: boolean; message: string; checked: number; remaining: number; waitMs: number };

/**
 * ปุ่ม "ดึงสถานะ Flash" ในหน้ารอบรถ (ทั้งวัน) — ทีละรอบ ไม่เกิน FLASH_ROUND ชิ้น
 * หน้าเว็บเรียกซ้ำจน remaining = 0 โดยพักตาม waitMs ระหว่างรอบ (กันโดน Flash บล็อก)
 * @param before ดึงชิ้นที่ยังไม่เคยเช็ค หรือเช็คก่อนเวลานี้ (ms) · 0 = เฉพาะที่ยังไม่เคยเช็ค
 * ข้ามชิ้นที่จบแล้ว (เซ็นรับ/ตีกลับแล้ว/ยกเลิก) · Flash ครบแล้วต่อด้วย SPX / ขนส่งอื่นผ่าน BigSeller
 */
export async function refreshPickupsFlash(pickupIds: string[], before: number, tones: FlashTone[] | null = null): Promise<FlashRoundState> {
  const user = await requireUser();
  const visible = await visiblePickupIds(user, pickupIds.slice(0, 100));
  const pms = await db.pickupManifest.findMany({ where: { pickupId: { in: visible }, manifestId: { not: null } }, select: { manifestId: true } });
  const where = {
    manifestId: { in: [...new Set(pms.map((pm) => pm.manifestId!))] },
    status: { notIn: ["CANCELLED_AFTER", "RETURNED", "DELIVERED"] as ParcelStatus[] },
    OR: [{ shippingMethod: null }, { shippingMethod: { contains: "flash", mode: "insensitive" as const } }],
    AND: [
      { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] },
      before > 0 ? { OR: [{ flashFetchedAt: null }, { flashFetchedAt: { lt: new Date(before) } }] } : { flashFetchedAt: null },
    ],
  };
  // เลือกเฉพาะกลุ่มสถานะ (ชิปในหน้ารอบรถ) — กรองในเครื่องด้วยกติกาเดียวกับชิป (parcelTone)
  const want = tones?.length ? new Set(tones) : null;
  const candidates = async () =>
    want
      ? (
          await db.manifestParcel.findMany({
            where,
            orderBy: { flashFetchedAt: { sort: "asc", nulls: "first" } },
            select: { id: true, status: true, flashState: true, shippingMethod: true, bsStatusText: true },
          })
        ).filter((p) => want.has(parcelTone(p)))
      : null;

  const picked = await candidates();
  const batch = picked
    ? picked.slice(0, FLASH_ROUND)
    : await db.manifestParcel.findMany({ where, orderBy: { flashFetchedAt: { sort: "asc", nulls: "first" } }, take: FLASH_ROUND, select: { id: true } });
  if (!batch.length) {
    // เลือกแต่กลุ่มที่จบแล้ว (เซ็นรับ / ยกเลิก) → ไม่มีอะไรต้องถาม Flash
    if (want) return { ok: true, message: "สถานะที่เลือกเช็คล่าสุดแล้ว / จบแล้ว ไม่ต้องถามซ้ำ", checked: 0, remaining: 0, waitMs: 0 };
    // Flash ครบแล้ว → SPX / ขนส่งอื่น ถาม BigSeller ต่อ
    return bigSellerRound({ manifestId: where.manifestId }, before);
  }

  const r = await refreshFlashStatuses({ parcelIds: batch.map((p) => p.id) }, { force: true });

  syncSheets(r);
  const remaining = want ? (await candidates())!.length : await db.manifestParcel.count({ where });
  return { ok: r.ok, message: r.message, checked: r.count, remaining, waitMs: roundWaitMs(r.errors) };
}

/** ใบนำจ่ายต่อรอบที่ถาม BigSeller (ใบละ ~1 request · 50 ออเดอร์) */
const BS_ROUND = 10;

/**
 * SPX / ขนส่งอื่นที่ไม่ใช่ Flash — ถาม Flash ไม่ได้ ใช้สถานะจาก BigSeller แทน (ดึงทั้งใบนำจ่าย)
 * ทำหลังถาม Flash ครบแล้ว (ปุ่มเช็คเดียวกัน) · ทีละ BS_ROUND ใบ ที่เหลือหน้าเว็บเรียกต่อรอบถัดไป
 * @param before ใบที่ดึงสถานะก่อนเวลานี้ (ms) · 0 = เฉพาะใบที่ยังไม่เคยดึง
 */
async function bigSellerRound(scope: Prisma.ManifestParcelWhereInput, before: number): Promise<FlashRoundState> {
  const where: Prisma.ManifestParcelWhereInput = {
    AND: [
      scope,
      // ไม่ใช่ Flash (ตรงข้ามกับ isFlashParcel — ไม่รู้ขนส่งนับเป็น Flash)
      { shippingMethod: { not: null } },
      { shippingMethod: { not: "" } },
      { NOT: { shippingMethod: { contains: "flash", mode: "insensitive" } } },
      { status: { notIn: ["DELIVERED", "RETURNED"] } },
      { manifest: before > 0 ? { OR: [{ statusesFetchedAt: null }, { statusesFetchedAt: { lt: new Date(before) } }] } : { statusesFetchedAt: null } },
    ],
  };
  const pending = async () => (await db.manifestParcel.findMany({ where, distinct: ["manifestId"], select: { manifestId: true } })).map((p) => p.manifestId);
  const ids = (await pending()).slice(0, BS_ROUND);
  if (!ids.length) return { ok: true, message: "เช็คครบแล้ว", checked: 0, remaining: 0, waitMs: 0 };
  const r = await syncManifestStatuses(ids, { notify: true });
  if (!r.ok) return { ok: false, message: `BigSeller (SPX): ${r.message}`, checked: 0, remaining: 0, waitMs: 0 };
  revalidateTag(TRACK_COUNTS_TAG, "max");
  return { ok: true, message: `BigSeller (SPX) ${ids.length} ใบ: ${r.message.split("\n")[0]}`, checked: r.count, remaining: (await pending()).length, waitMs: 0 };
}

/** Open API ไม่ต้องพัก · หน้าเว็บ: พัก 1 นาทีต่อรอบ (โดนเตือนแล้วพักนานขึ้น) */
const roundWaitMs = (errors: string[]) => (flashOpenConfigured() ? 0 : errors.some((e) => /บ่อยเกินไป|ลองใหม่ในอีก/.test(e)) ? 90_000 : 60_000);

/**
 * ปุ่ม "เช็คหน้านี้ / เช็คทุกหน้า" ในหน้าติดตามสถานะ — ทีละรอบเหมือน refreshPickupsFlash
 * @param ids ชิ้นในหน้านี้ · null = ทุกชิ้นของแท็บ + ตัวกรองนั้น (ทุกหน้า)
 * @param before เวลาที่กดปุ่ม — ถามเฉพาะชิ้นที่เช็คล่าสุดก่อนเวลานี้ ถามแล้วหลุดคิวเอง (remaining ลดจนเป็น 0)
 * ข้ามชิ้นที่จบแล้ว · Flash ครบแล้วต่อด้วย SPX / ขนส่งอื่นผ่าน BigSeller (bigSellerRound)
 */
export async function refreshTrackingFlash(
  filter: { tab: TrackTab; rangeDays: number; staleDays: number },
  ids: string[] | null,
  before: number,
): Promise<FlashRoundState> {
  await requireUser();
  const tab = TRACK_TABS.some((t) => t.key === filter.tab) ? filter.tab : "all";
  const scope = ids ? { id: { in: ids.slice(0, 500) } } : tabWhere(tab, filter, await shippedSets(filter.rangeDays, filter.staleDays));
  const where: Prisma.ManifestParcelWhereInput = {
    AND: [
      scope,
      // isFlashParcel — ไม่รู้ขนส่ง (null / ว่าง) นับเป็น Flash
      { OR: [{ shippingMethod: null }, { shippingMethod: "" }, { shippingMethod: { contains: "flash", mode: "insensitive" } }] },
      { OR: [{ flashState: null }, { flashState: { notIn: [5, 7, 9] } }] },
      { status: { notIn: ["DELIVERED", "RETURNED"] } },
      { OR: [{ flashFetchedAt: null }, { flashFetchedAt: { lt: new Date(before) } }] },
    ],
  };
  const batch = await db.manifestParcel.findMany({ where, orderBy: { flashFetchedAt: { sort: "asc", nulls: "first" } }, take: FLASH_ROUND, select: { id: true } });
  // Flash ครบแล้ว → SPX / ขนส่งอื่น ถาม BigSeller ต่อ (ปุ่มเดียวกัน)
  if (!batch.length) return bigSellerRound(scope, before);

  const r = await refreshFlashStatuses({ parcelIds: batch.map((p) => p.id) }, { force: true });
  syncSheets(r);
  // ตัวเลขบนแท็บ (แคช 2 นาที) นับใหม่รอบถัดไป
  if (r.count) revalidateTag(TRACK_COUNTS_TAG, "max");
  const remaining = await db.manifestParcel.count({ where });
  return { ok: r.ok, message: r.message, checked: r.count, remaining, waitMs: roundWaitMs(r.errors) };
}
