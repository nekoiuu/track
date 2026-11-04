import Link from "next/link";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { searchKey } from "@/lib/shipping";
import { RETURN_KINDS, RETURN_KIND_LABEL, awaitingReturn, returnKind, type ReturnKind } from "@/lib/tracking";
import { STOCK_IN_NOTE } from "@/lib/bigseller";
import { DataTable, Empty, HIDE_SM, Page, PageHeader, ParcelStatusPill } from "@/components/kit";
import { ParcelEditButton } from "@/components/parcel-edit";
import { TableSearch } from "@/components/shipping-filter";
import { CopyTrackingsButton } from "@/components/copy-trackings";
import { SendToSheetsButton } from "@/components/sheets-button";
import { sheetsConfigured, sheetsUrl } from "@/lib/sheets";
import { dailyTabName } from "@/lib/sheets-columns";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Prisma } from "@/generated/prisma/client";
import { ReturnReceiver, type ReturnCandidate } from "./return-receiver";

/** ผ่านมากี่วันแล้ว (นับจากรถออก) */
const daysSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);

/** ดูประวัติรับคืนย้อนหลังกี่วัน (ตัวกรอง "รับคืนแล้ว") */
const RETURNED_DAYS = 30;
const returnedSince = () => new Date(Date.now() - RETURNED_DAYS * 86_400_000);

/**
 * รับคืนแล้ว = นับเป็นพัสดุ (ไม่ใช่จำนวนครั้งที่สแกน) — สถานะตอนนี้ยังเป็น "ได้ของคืนแล้ว" และมีบันทึกรับคืนในช่วงนี้
 * กดผิดชิ้นแล้วแก้สถานะกลับ → หายจากตัวกรองนี้ กลับไปอยู่ "ยังไม่ได้คืน" · รับซ้ำก็ยังนับชิ้นเดียว
 */
const returnedWhereSince = (since: Date): Prisma.ManifestParcelWhereInput => ({
  status: "RETURNED",
  returns: { some: { receivedAt: { gte: since } } },
});

/** ช่องที่ใช้แยกแบบ (ตีกลับ / ยกเลิกไม่ได้ไปกับรถ / ยกเลิกไปกับรถ) + รถที่รับไป */
const kindSelect = { status: true, flashState: true, flashNotFound: true, bsState: true, shippingMethod: true } as const;
const truckSelect = {
  manifest: {
    select: {
      id: true,
      manifestNo: true,
      pickups: { select: { pickup: { select: { id: true, plate: true, arrivedAt: true, departedAt: true } } } },
    },
  },
} as const;
type Truck = { id: string; plate: string; arrivedAt: Date; departedAt: Date | null };
const truckOf = (p: { manifest: { pickups: { pickup: Truck }[] } }): Truck | undefined =>
  p.manifest.pickups.map((pm) => pm.pickup).find((pk) => pk.departedAt) ?? p.manifest.pickups[0]?.pickup;

const pendingParcels = () =>
  db.manifestParcel.findMany({
    where: awaitingReturn,
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      trackingNo: true,
      orderNo: true,
      statusNote: true,
      updatedAt: true,
      ...kindSelect,
      ...truckSelect,
    },
  });
type PendingParcel = Awaited<ReturnType<typeof pendingParcels>>[number];

const returnedParcels = (where: Prisma.ManifestParcelWhereInput) =>
  db.manifestParcel.findMany({
    where,
    // เปลี่ยนเป็น "ได้ของคืนแล้ว" ล่าสุดอยู่บน (updatedAt ขยับตอนรับคืน)
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      trackingNo: true,
      orderNo: true,
      statusNote: true,
      ...kindSelect,
      ...truckSelect,
      // ครั้งล่าสุดที่รับ — ใครรับ เมื่อไหร่
      returns: { orderBy: { receivedAt: "desc" }, take: 1, select: { receivedAt: true, receivedBy: true, note: true } },
    },
  });
type ReturnedParcel = Awaited<ReturnType<typeof returnedParcels>>[number];

/** ป้ายแบบ — ตีกลับ (เหลือง) · ยกเลิกไม่ได้ไปกับรถ (เทา: ของอยู่ร้าน) · ยกเลิกไปกับรถ (แดง: ต้องตาม) */
const KIND_PILL: Record<ReturnKind, string> = {
  back: "bg-warning-soft text-warning-deep",
  stayed: "bg-canvas-soft-2 text-body ring-1 ring-inset ring-hairline",
  went: "bg-error-soft text-error-deep",
};
function KindPill({ kind }: { kind: ReturnKind | null }) {
  if (!kind) return null;
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${KIND_PILL[kind]}`}>{RETURN_KIND_LABEL[kind]}</span>;
}

const chip = "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors";
const on = "border-brand bg-brand font-medium text-white";
const off = "bg-card text-body hover:bg-muted";
const subChip = "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors";
const subOn = "bg-ink font-medium text-white";
const subOff = "bg-canvas-soft-2 text-body hover:bg-muted";

/** ชิปแยกแบบ (กรองบนหน้าเดิม คงตัวกรองยังไม่ได้คืน / รับคืนแล้ว) */
function KindChips({ show, kind, counts, total }: { show: "pending" | "returned"; kind?: ReturnKind; counts: Record<ReturnKind, number>; total: number }) {
  const href = (k?: ReturnKind) => {
    const q = new URLSearchParams();
    if (show === "returned") q.set("show", "returned");
    if (k) q.set("kind", k);
    const s = q.toString();
    return s ? `/cancelled?${s}` : "/cancelled";
  };
  return (
    <nav aria-label="แยกแบบ" className="mb-4 flex flex-wrap gap-1.5">
      <Link href={href()} aria-current={!kind ? "page" : undefined} className={`${subChip} ${!kind ? subOn : subOff}`}>
        ทุกแบบ <span className="tabular text-xs opacity-80">{total}</span>
      </Link>
      {RETURN_KINDS.map((k) => (
        <Link key={k.key} href={href(k.key)} aria-current={kind === k.key ? "page" : undefined} className={`${subChip} ${kind === k.key ? subOn : subOff}`}>
          {k.label} <span className="tabular text-xs opacity-80">{counts[k.key]}</span>
        </Link>
      ))}
    </nav>
  );
}

/** นับแต่ละแบบ + กรองตามแบบที่เลือก */
function byKind<T extends { status: string; flashState: number | null; flashNotFound: boolean; bsState: string | null; shippingMethod: string | null }>(rows: T[], kind?: ReturnKind) {
  const withKind = rows.map((p) => ({ p, kind: returnKind(p) }));
  const counts: Record<ReturnKind, number> = { back: 0, stayed: 0, went: 0 };
  for (const r of withKind) if (r.kind) counts[r.kind]++;
  return { counts, rows: kind ? withKind.filter((r) => r.kind === kind) : withKind };
}

/**
 * ยกเลิก / ตีกลับ — งานที่รถรับไปแล้วแต่ต้องได้ของคืน แยก 3 แบบ (ชิปกรอง)
 * - ตีกลับ: Flash ส่งไม่สำเร็จ ส่งของกลับ
 * - ยกเลิก · ไม่ได้ไปกับรถ: Flash ไม่ได้เอาของไป (ของอยู่ร้าน)
 * - ยกเลิก · ไปกับรถ: Flash เอาไปแล้ว ยกเลิกกลางทาง ยังไม่ได้คืน → ต้องตามกับขนส่ง
 * ได้ของคืนแล้ว → พิมพ์เลขแทร็ค 4 ตัวท้ายในกล่องรับคืน กดปุ่มเดียว รายการจะหายจากหน้านี้ (ไปอยู่ตัวกรอง "รับคืนแล้ว")
 */
export async function CancelledList({ show = "pending", kind }: { show?: "pending" | "returned"; kind?: ReturnKind }) {
  await connection();
  // ดึงเฉพาะรายการของตัวกรองที่เปิดอยู่ — อีกฝั่งแค่นับขึ้นชิป · ยิงพร้อมกันรอบเดียว
  const returnedWhere = returnedWhereSince(returnedSince());
  const [pendingRows, pendingCount, returned, returnedCount] = await Promise.all([
    show === "pending" ? pendingParcels() : null,
    show === "returned" ? db.manifestParcel.count({ where: awaitingReturn }) : null,
    show === "returned" ? returnedParcels(returnedWhere) : null,
    db.manifestParcel.count({ where: returnedWhere }),
  ]);
  const parcels = pendingRows ?? [];

  // กล่องรับคืนค้นได้ทุกแบบเสมอ (ไม่ขึ้นกับชิปที่เลือก) — ของมาถึงก็พิมพ์ได้เลย
  const candidates: ReturnCandidate[] = parcels.map((p) => {
    const truck = truckOf(p);
    const k = returnKind(p);
    return {
      id: p.id,
      trackingNo: p.trackingNo,
      orderNo: p.orderNo,
      status: p.status,
      shippingMethod: p.shippingMethod,
      plate: truck?.plate ?? null,
      days: truck?.departedAt ? daysSince(truck.departedAt) : null,
      kindLabel: k ? RETURN_KIND_LABEL[k] : null,
    };
  });

  const list = returned ?? parcels;
  const { counts, rows } = byKind<PendingParcel | ReturnedParcel>(list, kind);

  return (
    <Page>
      <PageHeader title="ยกเลิก / ตีกลับ" />

      {/* ตัวกรอง — ยังไม่ได้ของคืน (ต้องตาม) / รับคืนแล้ว (หลักฐานย้อนหลัง) */}
      <nav aria-label="ตัวกรอง" className="mb-2 flex flex-wrap gap-2">
        <Link href={kind ? `/cancelled?kind=${kind}` : "/cancelled"} aria-current={show === "pending" ? "page" : undefined} className={`${chip} ${show === "pending" ? on : off}`}>
          ยังไม่ได้คืน <span className="tabular text-xs opacity-80">{pendingCount ?? parcels.length}</span>
        </Link>
        <Link href={`/cancelled?show=returned${kind ? `&kind=${kind}` : ""}`} aria-current={show === "returned" ? "page" : undefined} className={`${chip} ${show === "returned" ? on : off}`}>
          รับคืนแล้ว <span className="tabular text-xs opacity-80">{returnedCount}</span>
        </Link>
      </nav>
      {list.length > 0 && <KindChips show={show} kind={kind} counts={counts} total={list.length} />}

      {show === "pending" && parcels.length > 0 && <ReturnReceiver parcels={candidates} />}

      {!list.length ? (
        <Empty>{show === "returned" ? `ยังไม่มีการรับคืนใน ${RETURNED_DAYS} วันที่ผ่านมา` : "ไม่มีงานยกเลิก / ตีกลับที่รอคืน"}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-x-2">
            <div className="min-w-0 flex-1">
              <TableSearch scope="cancelled-parcels" />
            </div>
            <CopyTrackingsButton scope="cancelled-parcels" />
            <SendToSheetsButton scope="cancelled-parcels" sheetUrl={sheetsUrl()} configured={sheetsConfigured()} />
          </div>
          <div id="cancelled-parcels" className="min-w-0">
            {!rows.length ? (
              <Empty>ไม่มีงานแบบ “{kind && RETURN_KIND_LABEL[kind]}” ในตัวกรองนี้</Empty>
            ) : returned ? (
              <ReturnedList rows={rows as { p: ReturnedParcel; kind: ReturnKind | null }[]} />
            ) : (
              <PendingList rows={rows as { p: PendingParcel; kind: ReturnKind | null }[]} />
            )}
          </div>
        </>
      )}
    </Page>
  );
}

/** แถวที่ส่ง Sheets / คัดลอก / ค้นหาได้ (data-pid · data-tab ตามวันที่รถเข้ารับ) */
const rowData = (p: { id: string; trackingNo: string; orderNo: string | null; manifest: { manifestNo: string } }, truck: Truck | undefined) => ({
  "data-tracking": p.trackingNo,
  "data-pid": p.id,
  "data-tab": dailyTabName(truck?.arrivedAt ?? new Date()),
  "data-q": searchKey(p.trackingNo, p.orderNo, p.manifest.manifestNo, truck?.plate),
});

function PendingList({ rows }: { rows: { p: PendingParcel; kind: ReturnKind | null }[] }) {
  return (
    <DataTable
      head={[
        "เลขแทร็คกิ้ง",
        { label: "ออเดอร์", className: HIDE_SM },
        { label: "ใบนำจ่าย", className: HIDE_SM },
        { label: "รถที่รับไป", className: HIDE_SM },
        { label: "หมายเหตุ", className: HIDE_SM },
        "สถานะ",
      ]}
    >
      {rows.map(({ p, kind }) => {
        const truck = truckOf(p);
        const days = truck?.departedAt ? daysSince(truck.departedAt) : null;
        return (
          <TableRow key={p.id} {...rowData(p, truck)}>
            <TableCell>
              <Link href={`/parcels/${p.id}`} className="font-mono text-[13px] hover:underline">
                {p.trackingNo}
              </Link>
              {/* มือถือ: ข้อมูลรองอยู่ใต้เลขแทร็คกิ้งแทนคอลัมน์ */}
              <span className="block max-w-[56vw] truncate text-xs text-mute sm:hidden">
                {truck ? `${truck.plate}${days != null ? ` · ${days} วัน` : ""}` : p.manifest.manifestNo}
                {p.statusNote && ` · ${p.statusNote}`}
              </span>
            </TableCell>
            <TableCell className={`${HIDE_SM} font-mono text-[13px] text-body`}>{p.orderNo ?? "—"}</TableCell>
            <TableCell className={HIDE_SM}>
              <Link href={`/manifests/${p.manifest.id}`} className="font-mono text-[13px] text-body hover:underline">
                {p.manifest.manifestNo}
              </Link>
            </TableCell>
            <TableCell className={`${HIDE_SM} text-[13px]`}>
              {truck ? (
                <>
                  <Link href={`/pickups/${truck.id}`} className="font-medium hover:underline">
                    {truck.plate}
                  </Link>
                  <span className="block text-xs text-mute">
                    {truck.departedAt ? `ออก ${fmtDateTime(truck.departedAt)}` : "ยังไม่ปิดงาน"}
                    {days != null && <span className={days >= 3 ? "text-warning-deep" : ""}> · {days} วัน</span>}
                  </span>
                </>
              ) : (
                <span className="text-mute">—</span>
              )}
            </TableCell>
            <TableCell className={`${HIDE_SM} max-w-xs truncate text-[13px] text-body`}>{p.statusNote ?? "—"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center justify-end gap-1 sm:justify-start">
                <KindPill kind={kind} />
                <ParcelStatusPill status={p.status} />
                <ParcelEditButton parcel={p} />
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}

/** รับคืนผ่านทางไหน — Stock-In ใน BigSeller (บันทึกให้เอง) หรือกดรับคืนในแอป */
const receivedLabel = (s: { receivedBy: string | null; note: string | null }) =>
  s.note === STOCK_IN_NOTE ? `Stock-In โดย ${s.receivedBy ?? "BigSeller"}` : `รับคืนในแอปโดย ${s.receivedBy ?? "—"}`;

/** ประวัติรับคืน — ใครรับ เมื่อไหร่ (หลักฐาน) · กดแก้ไขเปลี่ยนสถานะกลับได้ถ้ากดผิดชิ้น */
function ReturnedList({ rows }: { rows: { p: ReturnedParcel; kind: ReturnKind | null }[] }) {
  return (
    <DataTable head={["เลขแทร็คกิ้ง", { label: "ออเดอร์", className: HIDE_SM }, "รับคืนเมื่อ", { label: "ผู้รับ", className: HIDE_SM }, "สถานะ"]}>
      {rows.map(({ p, kind }) => {
        const scan = p.returns[0];
        return (
          <TableRow key={p.id} {...rowData(p, truckOf(p))}>
            <TableCell>
              <Link href={`/parcels/${p.id}`} className="font-mono text-[13px] hover:underline">
                {p.trackingNo}
              </Link>
              <span className="block text-xs text-mute sm:hidden">{scan ? receivedLabel(scan) : ""}</span>
            </TableCell>
            <TableCell className={`${HIDE_SM} font-mono text-[13px] text-body`}>{p.orderNo ?? "—"}</TableCell>
            <TableCell className="text-[13px] text-body">{scan ? fmtDateTime(scan.receivedAt) : "—"}</TableCell>
            <TableCell className={`${HIDE_SM} text-[13px]`}>{scan ? receivedLabel(scan) : "—"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center justify-end gap-1 sm:justify-start">
                <KindPill kind={kind} />
                <ParcelStatusPill status={p.status} />
                <ParcelEditButton parcel={p} />
              </div>
            </TableCell>
          </TableRow>
        );
      })}
    </DataTable>
  );
}
