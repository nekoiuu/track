"use server";

import { revalidatePath } from "next/cache";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { SHARE_MAX, newSlug, publicBase, readParcelToken, refreshShareParcels, shareWhere, type ShareFilter } from "@/lib/share";
import { TRACK_TABS } from "@/lib/tracking";

export type ShareResult = { ok: boolean; message: string; url?: string };

/**
 * สร้างลิงก์สาธารณะ — parcelIds = ชุดที่ติ๊กเลือก · filter = เคสในหน้าติดตามสถานะ (รายการล่าสุดเสมอ)
 */
export async function createShareLink(input: { parcelIds?: string[]; filter?: ShareFilter; title?: string }): Promise<ShareResult> {
  const user = await requireUser();
  const ids = [...new Set(input.parcelIds ?? [])].slice(0, SHARE_MAX);
  const filter = input.filter && TRACK_TABS.some((t) => t.key === input.filter!.tab) ? input.filter : null;
  if (!ids.length && !filter) return { ok: false, message: "ยังไม่ได้เลือกพัสดุ" };

  const caseLabel = filter ? TRACK_TABS.find((t) => t.key === filter.tab)!.label : null;
  const title = (input.title?.trim() || (caseLabel ? `ติดตาม: ${caseLabel}` : `ติดตามพัสดุ ${ids.length} ชิ้น`)).slice(0, 120);
  const link = await db.shareLink.create({
    data: {
      slug: newSlug(),
      title,
      kind: filter ? "case" : "parcels",
      parcelIds: filter ? [] : ids,
      filter: filter ?? undefined,
      createdBy: user.name,
    },
  });
  const url = `${await publicBase()}/share/${link.slug}`;
  audit(user, "share.create", "share", link.id, `${title} · ${url}`);
  revalidatePath("/links");
  return { ok: true, message: `สร้างลิงก์ “${title}” แล้ว — คัดลอกไว้ให้แล้ว`, url };
}

/** ปิดลิงก์ — คนที่มีลิงก์เปิดไม่ได้อีก */
export async function revokeShareLink(id: string) {
  const user = await requireUser();
  const link = await db.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
  audit(user, "share.revoke", "share", id, link.title);
  revalidatePath("/links");
}

/**
 * หน้าสาธารณะเรียกตอนเปิด (ไม่ต้อง login) — เช็ค Flash เฉพาะพัสดุในลิงก์นี้ที่ข้อมูลเก่า
 * ต้องเป็นลิงก์ที่มีอยู่และยังไม่ปิด · ถามซ้ำไม่ได้ภายใน 30 นาที (กันคนกดรัว)
 */
export async function refreshShare(slug: string): Promise<{ ok: boolean; count: number }> {
  const link = await db.shareLink.findUnique({ where: { slug: String(slug).slice(0, 40) } });
  if (!link || link.revokedAt) return { ok: false, count: 0 };
  const r = await refreshShareParcels(await shareWhere(link)).catch(() => ({ ok: false, count: 0 }));
  return { ok: r.ok, count: r.count };
}

/** พัสดุ 1 ชิ้น (ลิงก์ในแถวของ Sheets) */
export async function refreshSharedParcel(token: string): Promise<{ ok: boolean; count: number }> {
  const id = readParcelToken(String(token).slice(0, 80));
  if (!id) return { ok: false, count: 0 };
  const r = await refreshShareParcels({ id }).catch(() => ({ ok: false, count: 0 }));
  return { ok: r.ok, count: r.count };
}
