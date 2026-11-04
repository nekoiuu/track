import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { flashRoutesFor, type FlashRoute } from "@/lib/flash";
import { FLASH_PILL, flashLabel, flashTone, isFlashParcel } from "@/lib/flash-state";
import { readParcelToken, shareSelect } from "@/lib/share";
import { Page, Panel, ParcelStatusPill } from "@/components/kit";
import { ShareHeader, itemLines } from "../../share-view";
import { ShareRefresh } from "../../share-refresh";

export const metadata: Metadata = { title: "ติดตามพัสดุ", robots: { index: false, follow: false } };

/**
 * ลิงก์สาธารณะพัสดุ 1 ชิ้น (แปะในแถวของ Google Sheets) — token เซ็นด้วย AUTH_SECRET เดาไม่ได้
 * แสดงสถานะ + เส้นทางจาก Flash · เปิดแล้วเช็คใหม่ให้ถ้าข้อมูลเก่ากว่า 30 นาที
 */
export default async function SharedParcelPage({ params }: PageProps<"/share/p/[token]">) {
  await connection();
  const { token } = await params;
  const id = readParcelToken(decodeURIComponent(token));
  if (!id) notFound();
  const p = await db.manifestParcel.findUnique({ where: { id }, select: shareSelect });
  if (!p) notFound();

  // เส้นทางถาม Flash สด (ไม่เก็บใน DB) · ถามไม่ได้ / ไม่ใช่ Flash → ความเคลื่อนไหวล่าสุดที่เก็บไว้
  const live = isFlashParcel(p) ? await flashRoutesFor(p).catch(() => null) : null;
  const routes: Pick<FlashRoute, "at" | "text" | "message">[] =
    live ?? (p.flashLastRoute ? [{ at: p.flashRoutedAt?.toISOString() ?? null, text: null, message: p.flashLastRoute }] : []);
  const items = itemLines(p.items);
  const truck = p.manifest.pickups[0]?.pickup;

  return (
    <Page>
      <ShareHeader
        title={p.trackingNo}
        sub={
          <>
            {p.orderNo && <>ออเดอร์ <span className="font-mono">{p.orderNo}</span> · </>}
            {truck?.departedAt ? `ส่งออกจากร้าน ${fmtDateTime(truck.departedAt)}` : "ยังไม่ออกจากร้าน"}
            {p.flashFetchedAt && ` · เช็ค Flash ล่าสุด ${fmtDateTime(p.flashFetchedAt)}`}
            <ShareRefresh token={token} />
          </>
        }
      />

      <Panel className="mb-6 grid gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* SPX / ขนส่งอื่น ถาม Flash ไม่ได้ → สถานะจาก BigSeller */}
          {isFlashParcel(p) ? (
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${FLASH_PILL[flashTone(p.flashState)]}`}>{flashLabel(p) ?? "ยังไม่ได้เช็ค"}</span>
          ) : (
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${FLASH_PILL.none}`}>
              {p.shippingMethod ?? "ขนส่ง"}: {p.bsStatusText ?? "ยังไม่มีสถานะ"}
            </span>
          )}
          <ParcelStatusPill status={p.status} />
        </div>
        {items.length > 0 && (
          <div>
            <p className="text-xs text-mute">สินค้า</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {items.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      {isFlashParcel(p) && <h2 className="mb-3 font-semibold">เส้นทางพัสดุ (Flash)</h2>}
      {isFlashParcel(p) && <Panel className="p-5">
        {routes.length === 0 ? (
          <p className="text-sm text-mute">{p.flashNotFound ? "Flash ยังไม่มีข้อมูลเลขนี้ (ยังไม่สแกนรับเข้าระบบ)" : "ยังไม่มีความเคลื่อนไหว"}</p>
        ) : (
          <ol className="relative space-y-5 border-l border-hairline pl-5">
            {routes.map((r, i) => (
              <li key={i}>
                <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${i === 0 ? "bg-link" : "bg-hairline-strong"}`} />
                <p className="font-mono text-xs text-mute">{r.at ? fmtDateTime(new Date(r.at)) : "—"}</p>
                <p className={i === 0 ? "font-medium" : ""}>{r.text ?? r.message}</p>
                {r.text && r.message && <p className="text-sm text-body">{r.message}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>}
    </Page>
  );
}
