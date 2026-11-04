"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncStockIns, type StockInSync } from "@/lib/bigseller";
import { sheetsConfigured } from "@/lib/sheets";
import { TRACK_COUNTS_TAG, awaitingReturn } from "@/lib/tracking";
import { updateSheetRowsFor } from "./sheets";

/**
 * ปุ่ม "ได้ของคืนแล้ว" ในหน้ายกเลิก / ตีกลับ — เจ้าหน้าที่พิมพ์เลขแทร็ค 4 ตัวท้ายแล้วกดรับ
 * บันทึกหลักฐาน (ReturnScan: ใคร · เมื่อไหร่) + สถานะร้าน → ได้ของคืนแล้ว (หายจากรายการยกเลิก / แท็บ "ยกเลิก ยังไม่คืน")
 */
export async function receiveReturn(parcelId: string): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser();
  const p = await db.manifestParcel.findUnique({ where: { id: parcelId }, select: { id: true, trackingNo: true, status: true } });
  if (!p) return { error: "ไม่พบพัสดุนี้" };
  if (p.status === "RETURNED") return { ok: `${p.trackingNo} รับคืนไปแล้ว` };

  // เปลี่ยนสถานะแบบมีเงื่อนไขก่อน — 2 คนกดชิ้นเดียวกันพร้อมกัน ได้แถวเดียว (อีกคน count = 0 ไม่สร้าง ReturnScan ซ้ำ)
  // และรับได้เฉพาะชิ้นที่ยังอยู่ในรายการรอคืน (รายการในหน้าเก่า คนอื่นเปลี่ยนสถานะไปแล้ว → ไม่ทับ)
  const saved = await db.$transaction(async (tx) => {
    const r = await tx.manifestParcel.updateMany({
      where: { AND: [{ id: p.id, status: { not: "RETURNED" } }, awaitingReturn] },
      data: { status: "RETURNED", statusBy: user.name },
    });
    if (r.count) await tx.returnScan.create({ data: { trackingNo: p.trackingNo, parcelId: p.id, receivedBy: user.name } });
    return r.count > 0;
  });
  if (!saved) {
    const now = await db.manifestParcel.findUnique({ where: { id: p.id }, select: { status: true } });
    return now?.status === "RETURNED" ? { ok: `${p.trackingNo} รับคืนไปแล้ว` } : { error: `${p.trackingNo} ไม่อยู่ในรายการรอคืน (ยกเลิก / ตีกลับ) แล้ว — รีเฟรชหน้า` };
  }

  audit(user, "parcel.return", "parcel", p.id, `${p.trackingNo} · รับคืน (เดิม ${p.status})`);
  if (sheetsConfigured()) after(() => updateSheetRowsFor([p.id]).catch((e) => console.warn("[sheets] อัปเดตตามสถานะไม่สำเร็จ:", e)));
  revalidatePath("/", "layout");
  revalidateTag(TRACK_COUNTS_TAG, "max");
  return { ok: `รับคืน ${p.trackingNo} แล้ว` };
}

/**
 * เปิดหน้ายกเลิกหลังขึ้นรถ → ถาม BigSeller ว่าชิ้นไหน Stock-In แล้ว (อ่านอย่างเดียว · 50 ชิ้นต่อ request)
 * Stock-In ครบ → บันทึกรับคืนให้เอง (คนกด + เวลาจาก BigSeller) · ไม่ revalidate — หน้าเว็บ router.refresh() เองเมื่อมีชิ้นเปลี่ยน
 */
export async function checkStockIns(): Promise<StockInSync> {
  const user = await requireUser();
  const r = await syncStockIns();
  if (r.marked.length) {
    audit(user, "parcel.return", "parcel", null, `Stock-In ใน BigSeller ${r.marked.length} ชิ้น: ${r.marked.join(", ")}`);
    // แถวที่เคยส่งไป Sheets → อัปเดตสถานะ + ช่อง Stock-In (ใคร · เมื่อไหร่) เบื้องหลัง
    if (sheetsConfigured())
      after(async () => {
        const ids = await db.manifestParcel.findMany({ where: { trackingNo: { in: r.marked }, status: "RETURNED" }, select: { id: true } });
        await updateSheetRowsFor(ids.map((p) => p.id)).catch((e) => console.warn("[sheets] อัปเดต Stock-In ไม่สำเร็จ:", e));
      });
    revalidateTag(TRACK_COUNTS_TAG, "max");
  }
  return r;
}
