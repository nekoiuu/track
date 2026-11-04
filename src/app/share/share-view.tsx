import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { FLASH_PILL, flashLabel, flashTone } from "@/lib/flash-state";
import { productBySku, type ParcelItem } from "@/lib/products";
import { parcelToken, type ShareParcel } from "@/lib/share";
import { Panel, ParcelStatusPill } from "@/components/kit";
import { CopyTrackingsButton } from "@/components/copy-trackings";

/** สินค้าในกล่อง: ชื่อ ×จำนวน (ชื่อจากออเดอร์ → ชื่อในคลัง → SKU) */
export function itemLines(items: unknown) {
  return ((items as ParcelItem[] | null) ?? []).map((i) => {
    const name = i.name?.trim() || productBySku(i.sku)?.name || i.sku;
    return `${name}${i.qty > 1 ? ` ×${i.qty}` : ""}`;
  });
}

const TONE_LABEL: Record<string, string> = { done: "เซ็นรับแล้ว", move: "กำลังส่ง", back: "ตีกลับ", issue: "มีปัญหา", cancel: "ยกเลิก", none: "ยังไม่มีสถานะ" };

/** หัวหน้าสาธารณะ — ชื่อร้าน/ระบบ ไม่มีเมนู */
export function ShareHeader({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <header className="mb-5">
      <p className="text-sm text-mute">Shipped · ติดตามพัสดุ</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {sub && <div className="mt-1 text-sm text-mute">{sub}</div>}
    </header>
  );
}

/** รายการพัสดุ (หน้าลิงก์ชุด) — แตะเลขเพื่อดูเส้นทางของชิ้นนั้น */
export function ShareList({ parcels }: { parcels: ShareParcel[] }) {
  const tally = new Map<string, number>();
  for (const p of parcels) tally.set(flashTone(p.flashState), (tally.get(flashTone(p.flashState)) ?? 0) + 1);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[...tally].map(([tone, n]) => (
          <span key={tone} className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${FLASH_PILL[tone as keyof typeof FLASH_PILL]}`}>
            {TONE_LABEL[tone] ?? tone} {n}
          </span>
        ))}
        <span className="ml-auto">
          <CopyTrackingsButton scope="share-list" />
        </span>
      </div>
      <Panel id="share-list" className="divide-y overflow-hidden">
        {parcels.map((p) => {
          const label = flashLabel(p);
          const items = itemLines(p.items);
          return (
            <div key={p.id} data-tracking={p.trackingNo} className="grid gap-1.5 px-4 py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5">
              <div className="min-w-0">
                <Link href={`/share/p/${parcelToken(p.id)}`} className="block truncate font-mono text-[15px] font-medium hover:underline">
                  {p.trackingNo}
                </Link>
                {p.orderNo && <p className="truncate font-mono text-xs text-mute">ออเดอร์ {p.orderNo}</p>}
              </div>
              <div className="min-w-0 text-sm">
                {items.length > 0 && <p className="truncate text-ink">{items.join(" · ")}</p>}
                <p className="truncate text-body">{p.flashLastRoute ?? (p.flashNotFound ? "Flash ยังไม่มีข้อมูลเลขนี้" : "—")}</p>
                {p.flashRoutedAt && <p className="text-xs text-mute">{fmtDateTime(p.flashRoutedAt)}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${FLASH_PILL[flashTone(p.flashState)]}`}>{label ?? "ยังไม่ได้เช็ค"}</span>
                <ParcelStatusPill status={p.status} />
              </div>
            </div>
          );
        })}
      </Panel>
    </>
  );
}
