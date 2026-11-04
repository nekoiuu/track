import Link from "next/link";
import { ViewTransition } from "react";
import { ChevronRightIcon } from "lucide-react";
import { LiveTimer, Stagger, StaggerItem } from "./motion";

export type DoingPickup = {
  id: string;
  plate: string;
  carrier: string | null;
  arrivedAt: Date;
  manifests: { id: string; code: string; manifestId: string | null }[];
  parcels: number;
};

/** ชื่อ view transition ของทะเบียน — การ์ดในรายการ "บิน" ไปเป็นหัวข้อหน้ารายละเอียด */
export const plateVT = (id: string) => `plate-${id}`;

/** งานที่กำลังทำ — แถวบาง ๆ แตะทั้งแถวเข้าไปจด manifest / ปิดงาน · นาฬิกาเดินอยู่ขวามือ */
export function DoingCards({ pickups }: { pickups: DoingPickup[] }) {
  return (
    <Stagger className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {pickups.map((p) => {
        const missing = p.manifests.filter((m) => !m.manifestId).length;
        return (
          <StaggerItem key={p.id}>
            <Link
              href={`/pickups/${p.id}`}
              className="group flex min-h-16 items-center gap-3 rounded-xl bg-card px-3.5 py-2.5 ring-1 ring-hairline transition-[box-shadow,background-color,transform] duration-100 hover:ring-brand/40 active:scale-[0.99] active:bg-muted"
            >
              <span className="live-dot size-2 shrink-0 rounded-full bg-brand" />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <ViewTransition name={plateVT(p.id)}>
                    <span className="truncate text-base font-semibold tracking-[-0.2px]">{p.plate}</span>
                  </ViewTransition>
                  <span className="truncate text-xs text-mute">{p.carrier ?? ""}</span>
                </span>
                <span className="block truncate text-xs text-body tabular">
                  {p.manifests.length ? `${p.manifests.length} ใบ · ${p.parcels} ชิ้น` : "ยังไม่ได้จด manifest"}
                  {missing > 0 && <span className="text-warning-deep"> · ยังไม่พบ {missing} ใบ</span>}
                </span>
              </span>
              <LiveTimer since={p.arrivedAt.toISOString()} className="shrink-0 font-mono text-sm font-semibold text-brand-deep tabular" />
              <ChevronRightIcon className="size-4 shrink-0 text-mute transition-transform group-hover:translate-x-0.5" />
            </Link>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}
