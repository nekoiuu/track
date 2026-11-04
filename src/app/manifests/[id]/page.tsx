import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { fmtDateTime, fmtWeight } from "@/lib/format";
import { parcelWeight, totalWeight, type ParcelItem } from "@/lib/products";
import { hasCookie } from "@/lib/bigseller";
import { Trash2Icon } from "lucide-react";
import { deleteManifest, runManifestStatusSync, runManifestUncheckedFlash, runManifestWeight, runTrackingFetch } from "@/app/actions/manifests";
import { ConfirmButton, PrintButton, SyncButton } from "@/components/client-actions";
import { DataTable, Empty, HIDE_SM, Mono, Notice, Page, PageHeader, Panel, ParcelStatusPill, Pill, SectionTitle } from "@/components/kit";
import { ShippingFilter, TableSearch } from "@/components/shipping-filter";
import { CopyTrackingsButton } from "@/components/copy-trackings";
import { RowCheck, SelectionBar } from "@/components/row-select";
import { SendToSheetsButton } from "@/components/sheets-button";
import { sheetsConfigured, sheetsUrl } from "@/lib/sheets";
import { dailyTabName } from "@/lib/sheets-columns";
import { ParcelEditButton } from "@/components/parcel-edit";
import { BS_ROW, countByShipping, countByStatus, searchKey, shipKey, statusKey, bsTone } from "@/lib/shipping";
import { FLASH_PILL, flashLabel, flashTone, isFlashParcel } from "@/lib/flash-state";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "ใบนำจ่าย" };

export default async function ManifestPage({ params, searchParams }: PageProps<"/manifests/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ship = typeof sp.ship === "string" ? sp.ship : undefined;
  const bs = typeof sp.bs === "string" ? sp.bs : undefined;
  const cookieP = hasCookie(); // เริ่มพร้อมกัน ไม่ต้องรอคิว
  const m = await db.manifest.findUnique({
    where: { id },
    include: {
      // เฉพาะที่ตารางใช้ — ไม่ลาก orderLog (JSON) ของทุกชิ้น
      parcels: { orderBy: { trackingNo: "asc" }, select: {
          id: true,
          trackingNo: true,
          orderNo: true,
          status: true,
          statusNote: true,
          shippingMethod: true,
          bsState: true,
          bsStatusText: true,
          items: true,
          flashState: true,
          flashStateText: true,
          flashLastRoute: true,
          flashNotFound: true,
          flashFetchedAt: true,
        },
      },
      pickups: { include: { pickup: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!m) notFound();

  const [cookie, dupRows] = await Promise.all([
    cookieP,
    // เลขแทร็คกิ้งในใบนี้ที่อยู่ในใบอื่นด้วย
    db.manifestParcel.findMany({
      where: { manifestId: { not: m.id }, trackingNo: { in: m.parcels.map((p) => p.trackingNo) } },
      select: { trackingNo: true, manifest: { select: { id: true, manifestNo: true } } },
    }),
  ]);
  const dupOf = new Map(dupRows.map((d) => [d.trackingNo, d.manifest]));
  // แท็บรายวันใน Google Sheets — ตามวันที่รถคันล่าสุดที่จดใบนี้เข้ารับ (ยังไม่มีรถ = วันนี้)
  const sheetTab = dailyTabName(m.pickups.at(-1)?.pickup.arrivedAt ?? new Date());
  const incomplete = m.parcelCount != null && m.parcels.length < m.parcelCount;
  // น้ำหนักรวม = Σ จำนวน × น้ำหนักต่อชิ้น (productData) — มีเมื่อกด "ดูน้ำหนักรวม" แล้ว
  const weight = totalWeight(m.parcels);
  const hasWeight = weight.missing < m.parcels.length;
  // ใบแบ่งหลายคัน: แต่ละคันรับไปเท่าไหร่ (ไม่ได้ใส่ = ทั้งใบ)
  const splitSum = m.pickups.reduce((n, pm) => n + (pm.parcelCount ?? m.parcels.length), 0);

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/manifests", label: "ใบนำจ่าย" }]}
        eyebrow={m.source === "manual" ? "Manifest · สร้างเอง" : "Manifest · BigSeller"}
        title={<Mono className="text-[22px] sm:text-[32px]">{m.manifestNo}</Mono>}
        description={[
          m.printedAt && `พิมพ์ ${fmtDateTime(m.printedAt)}`,
          m.logisticsName,
          m.parcelCount != null ? `${m.parcels.length}/${m.parcelCount} ชิ้น` : `${m.parcels.length} ชิ้น`,
          m.trackingsFetchedAt && `ดึงเลขแทร็คกิ้ง ${fmtDateTime(m.trackingsFetchedAt)}`,
          hasWeight && `น้ำหนักรวม ${fmtWeight(weight.grams)}${weight.missing ? ` (ขาด ${weight.missing} ชิ้น)` : ""}`,
          m.statusesFetchedAt && `ดึงสถานะ ${fmtDateTime(m.statusesFetchedAt)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            {cookie && (
              <SyncButton
                action={runTrackingFetch.bind(null, m.id)}
                label={m.trackingsFetchedAt ? "ดึงเลขแทร็คกิ้งใหม่" : "ดึงเลขแทร็คกิ้ง"}
                variant="outline"
              />
            )}
            {/* ชิ้น Flash ที่ยังไม่เคยเช็ค — เช็คเฉพาะกลุ่มนี้ เร็วกว่าทั้งใบ */}
            {m.parcels.some((p) => !p.flashFetchedAt && isFlashParcel(p)) && (
              <SyncButton
                action={runManifestUncheckedFlash.bind(null, m.id)}
                label={`เช็คที่ยังไม่เช็ค (${m.parcels.filter((p) => !p.flashFetchedAt && isFlashParcel(p)).length})`}
              />
            )}
            {m.parcels.length > 0 && (
              <SyncButton
                action={runManifestStatusSync.bind(null, m.id)}
                label="เช็คสถานะ Flash ทั้งหมด"
                variant={m.parcels.some((p) => !p.flashFetchedAt && isFlashParcel(p)) ? "outline" : "default"}
              />
            )}
            {cookie && m.parcels.length > 0 && (
              <SyncButton action={runManifestWeight.bind(null, m.id)} label={hasWeight ? "ดูน้ำหนักรวมใหม่" : "ดูน้ำหนักรวม"} variant="outline" />
            )}
            <PrintButton />
            <ConfirmButton
              action={deleteManifest.bind(null, m.id, "/manifests")}
              label={<Trash2Icon />}
              size="icon"
              variant="ghost"
              title={`ลบใบ ${m.manifestNo}?`}
              description={
                m.pickups.length
                  ? `ใบนี้จดอยู่ในรอบรถ ${m.pickups.length} รอบ — จะถูกเอาออกจากรอบรถเหล่านั้นด้วย พร้อมเลขแทร็คกิ้ง ${m.parcels.length} เลข`
                  : `ลบใบนี้และเลขแทร็คกิ้ง ${m.parcels.length} เลข`
              }
              confirmLabel="ลบ"
            />
          </>
        }
      />

      {m.pickups.length > 1 && (
        <div className="mb-6">
          {/* ใบเดียวแบ่งขึ้นหลายคันได้ — เตือนเฉพาะเมื่อยอดรวมไม่ตรงกับจำนวนในใบ */}
          <Notice tone={splitSum === m.parcels.length || !m.parcels.length ? "blue" : "amber"}>
            ใบนี้แบ่งขึ้นรถ {m.pickups.length} คัน · รวม {splitSum}/{m.parcels.length} ชิ้น
            {splitSum !== m.parcels.length && m.parcels.length > 0 && " — ใส่จำนวนที่แต่ละคันรับในหน้ารอบรถ (ปุ่ม “แบ่งคัน”)"}
          </Notice>
        </div>
      )}
      {dupRows.length > 0 && (
        <div className="mb-6">
          <Notice tone="red">มี {dupRows.length} ชิ้นที่อยู่ในใบอื่นด้วย — ดูคอลัมน์ “ซ้ำกับ”</Notice>
        </div>
      )}

      <SectionTitle>รถที่รับใบนี้</SectionTitle>
      {m.pickups.length === 0 ? (
        <div className="mb-10">
          <Notice>ยังไม่มีรอบรถที่จดใบนี้ไว้</Notice>
        </div>
      ) : (
        <div className="mb-10 grid gap-3 sm:grid-cols-2">
          {m.pickups.map(({ pickup: p }) => (
            <Link key={p.id} href={`/pickups/${p.id}`}>
              <Panel className="p-4 transition-shadow hover:shadow-float">
                <p className="flex items-center justify-between font-medium">
                  {p.plate}
                  {m.pickups.length > 1 && (
                    <span className="tabular text-sm text-body">{m.pickups.find((x) => x.pickupId === p.id)?.parcelCount ?? m.parcels.length} ชิ้น</span>
                  )}
                </p>
                <p className="text-sm text-body">
                  {p.carrier ?? "—"} · เริ่ม {fmtDateTime(p.arrivedAt)}
                  {p.departedAt && ` · ปิดงาน ${fmtDateTime(p.departedAt)}`}
                </p>
              </Panel>
            </Link>
          ))}
        </div>
      )}

      <SectionTitle aside={incomplete && <Pill tone="amber">ยังไม่ครบตาม BigSeller</Pill>}>
        เลขแทร็คกิ้ง ({m.parcels.length}
        {m.parcelCount != null && `/${m.parcelCount}`})
      </SectionTitle>

      {m.parcels.length === 0 ? (
        <Empty>{m.trackingsFetchedAt ? "BigSeller ไม่มีพัสดุในใบนี้" : "ยังไม่ได้ดึงเลขแทร็คกิ้ง — ดึงให้อัตโนมัติเมื่อจดใบนี้กับรอบรถ"}</Empty>
      ) : (
        <>
        <div className="flex flex-wrap items-start gap-x-2">
          <div className="min-w-0 flex-1">
            <TableSearch scope="manifest-parcels" />
          </div>
          <CopyTrackingsButton scope="manifest-parcels" />
          <SendToSheetsButton scope="manifest-parcels" sheetUrl={sheetsUrl()} configured={sheetsConfigured()} />
        </div>
        <SelectionBar scope="manifest-parcels" sheets={sheetsConfigured()} />
        <ShippingFilter
          by="bs"
          title="สถานะ Flash"
          always
          groups={countByStatus(m.parcels)}
          total={m.parcels.length}
          scope="manifest-parcels"
          initial={bs}
        />
        <ShippingFilter groups={countByShipping(m.parcels)} total={m.parcels.length} scope="manifest-parcels" initial={ship} />
        <div id="manifest-parcels" className="min-w-0">
        <DataTable
          fixed
          head={[
            { label: "#", className: "hidden w-12 sm:table-cell" },
            { label: "เลขแทร็คกิ้ง", className: "sm:w-[10.5rem]" },
            { label: "ออเดอร์", className: "hidden w-[11rem] xl:table-cell" },
            { label: "ขนส่ง", className: "hidden w-36 2xl:table-cell" },
            { label: "Flash", className: HIDE_SM },
            { label: "น้ำหนัก", className: "hidden w-20 text-right lg:table-cell" },
            { label: "ซ้ำกับ", className: "hidden w-32 lg:table-cell" },
            { label: "สถานะ", className: "w-[11rem] sm:w-[9.5rem]" },
          ]}
        >
          {m.parcels.map((p, i) => {
            const dup = dupOf.get(p.trackingNo);
            return (
              <TableRow
                key={p.id}
                data-ship={shipKey(p.shippingMethod)}
                data-bs={statusKey(p)}
                data-tracking={p.trackingNo}
                data-pid={p.id}
                data-tab={sheetTab}
                data-q={searchKey(p.trackingNo, p.orderNo)}
                className={dup ? "bg-error-soft/40" : bsTone(p) ? BS_ROW[bsTone(p)!] : ""}
              >
                <TableCell className={`${HIDE_SM} tabular text-mute`}>{i + 1}</TableCell>
                {/* มือถือ: คอลัมน์นี้กินที่ที่เหลือ ข้อความยาวตัด … ไม่ดันตารางเกินจอ */}
                <TableCell className="overflow-hidden">
                  <div className="flex min-w-0 items-center">
                    <RowCheck id={p.id} trackingNo={p.trackingNo} />
                    <Link href={`/parcels/${p.id}`} className="block min-w-0 truncate font-mono text-[13px] hover:underline">
                      {p.trackingNo}
                    </Link>
                  </div>
                  {/* มือถือ: ขนส่ง + ใบที่ซ้ำ อยู่ใต้เลขแทร็คกิ้งแทนคอลัมน์ */}
                  <span title={p.flashLastRoute ?? undefined} className="block truncate text-xs text-mute sm:hidden">
                    {p.flashLastRoute ?? p.shippingMethod ?? "—"}
                  </span>
                  {dup && <span className="block text-xs text-error-deep sm:hidden">ซ้ำกับ {dup.manifestNo}</span>}
                </TableCell>
                <TableCell className="hidden truncate font-mono text-[13px] text-body xl:table-cell">{p.orderNo ?? "—"}</TableCell>
                <TableCell className="hidden overflow-hidden text-[13px] text-body 2xl:table-cell">
                  <span title={p.shippingMethod ?? undefined} className="block max-w-[9rem] truncate">{p.shippingMethod ?? "—"}</span>
                </TableCell>
                <TableCell className={`${HIDE_SM} overflow-hidden text-[13px] whitespace-normal`}>
                  <div className="min-w-0">
                  {flashLabel(p) ? (
                    <>
                      <span title={flashLabel(p) ?? undefined} className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 align-middle text-xs font-medium ${FLASH_PILL[flashTone(p.flashState)]}`}>{flashLabel(p)}</span>
                      {p.flashLastRoute && (
                        <span title={p.flashLastRoute} className="mt-0.5 line-clamp-2 text-xs leading-snug break-words text-mute">
                          {p.flashLastRoute}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-mute">{p.bsStatusText ? `BigSeller: ${p.bsStatusText}` : "—"}</span>
                  )}
                </div>
                </TableCell>
                <TableCell className="hidden tabular text-right text-[13px] lg:table-cell">
                  <ParcelWeightCell items={p.items as ParcelItem[] | null} />
                </TableCell>
                <TableCell className="hidden overflow-hidden lg:table-cell">
                  {dup ? (
                    <Link href={`/manifests/${dup.id}`} className="font-mono text-[13px] text-error-deep hover:underline">
                      {dup.manifestNo}
                    </Link>
                  ) : (
                    <span className="text-mute">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1 sm:justify-start">
                    {/* มือถือ: โชว์สถานะ Flash (สถานะร้านดูได้ในหน้าพัสดุ) */}
                    {flashLabel(p) ? (
                      <>
                        <span className={`block h-6 max-w-[7.5rem] truncate rounded-full px-2.5 text-xs leading-6 font-semibold sm:hidden ${FLASH_PILL[flashTone(p.flashState)]}`}>{flashLabel(p)}</span>
                        <span className="hidden sm:contents">
                          <ParcelStatusPill status={p.status} />
                        </span>
                      </>
                    ) : (
                      <ParcelStatusPill status={p.status} />
                    )}
                    <ParcelEditButton parcel={p} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </DataTable>
        </div>
        </>
      )}
    </Page>
  );
}

/** น้ำหนักของกล่อง · มี SKU ที่ไม่รู้น้ำหนัก → ขึ้นเหลืองพร้อมบอกว่าตัวไหน */
function ParcelWeightCell({ items }: { items: ParcelItem[] | null }) {
  const w = parcelWeight(items);
  if (!w) return <span className="text-mute">—</span>;
  return (
    <span className={w.unknown.length ? "text-warning-deep" : ""} title={w.unknown.length ? `ไม่รู้น้ำหนัก: ${w.unknown.join(", ")}` : undefined}>
      {fmtWeight(w.grams)}
      {w.unknown.length > 0 && " *"}
    </span>
  );
}
