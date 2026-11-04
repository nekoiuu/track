import Link from "next/link";
import { notFound } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";
import { ChevronRightIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { db } from "@/lib/db";
import { requirePickupPage } from "@/lib/pickup-access";
import { fmtDateTime, fmtDuration, fmtTime, fmtWeight } from "@/lib/format";
import { totalWeight } from "@/lib/products";
import { currentManifestPrefix } from "@/lib/manifests";
import { deletePickup, refetchPickupManifests } from "@/app/actions/pickups";
import { runPickupStatusSync, runPickupUncheckedFlash, runPickupWeight } from "@/app/actions/manifests";
import { hasCookie } from "@/lib/bigseller";
import { ConfirmButton, PrintButton, SyncButton } from "@/components/client-actions";
import {
  DataTable,
  KeyValues,
  LinkButton,
  Notice,
  Page,
  PageHeader,
  Panel,
  ParcelStatusPill,
  PickupStatusPill,
  Section,
  HIDE_SM,
} from "@/components/kit";
import { ShippingFilter, TableSearch } from "@/components/shipping-filter";
import { CopyTrackingsButton } from "@/components/copy-trackings";
import { RowCheck, SelectionBar } from "@/components/row-select";
import { SendToSheetsButton } from "@/components/sheets-button";
import { sheetsConfigured, sheetsUrl } from "@/lib/sheets";
import { lineConfigured } from "@/lib/line";
import { sendPickupReport } from "@/app/actions/line";
import { dailyTabName } from "@/lib/sheets-columns";
import { CollapseAllButton } from "@/components/fold";
import { ParcelEditButton } from "@/components/parcel-edit";
import { BS_ROW, countByShipping, countByStatus, searchKey, shipKey, statusKey, bsTone, takenOf } from "@/lib/shipping";
import { FLASH_PILL, flashLabel, flashTone, isFlashParcel } from "@/lib/flash-state";
import { plateVT } from "@/components/pickup-cards";
import { DoingBar, ManifestScanner, PickupDetailsForm, ReopenButton } from "@/components/pickup-live";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "รอบรถ" };

export default async function PickupPage({ params, searchParams }: PageProps<"/pickups/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const cookieP = hasCookie(); // เริ่มพร้อมกัน ไม่ต้องรอคิว
  // งานของคนอื่น (staff) → ไม่พบหน้า · แอดมินเห็นทุกงาน — เช็คพร้อมกับดึงข้อมูล ไม่ต้องรอทีละรอบ
  const [, pickup, carriers] = await Promise.all([
    requirePickupPage(id),
    db.pickup.findUnique({
      where: { id },
      include: {
        vehicle: true,
        // กรงที่รถคันนี้อยู่ด้วย + คันอื่นที่แบ่งกรงเดียวกัน
        cages: {
          orderBy: { createdAt: "asc" },
          select: {
            share: true,
            count: true,
            cage: {
              select: {
                id: true,
                label: true,
                closedAt: true,
                originPickupId: true,
                shares: { where: { pickupId: { not: id } }, select: { share: true, count: true, pickup: { select: { plate: true, status: true } } } },
              },
            },
          },
        },
        manifests: {
          orderBy: { createdAt: "asc" },
          include: {
            manifest: {
              include: {
                // เอาเฉพาะที่ตารางใช้ — ไม่ลาก orderLog (JSON) ของทุกชิ้นข้ามไป DB ไกล ๆ
                parcels: {
                  orderBy: { trackingNo: "asc" },
                  select: {
                    id: true,
                    trackingNo: true,
                    orderNo: true,
                    status: true,
                    statusNote: true,
                    shippingMethod: true,
                    bsState: true,
                    bsStatusText: true,
                    flashState: true,
                    flashStateText: true,
                    flashLastRoute: true,
                    flashNotFound: true,
                    flashFetchedAt: true,
                  },
                },
                // ใบเดียวกันขึ้นรถคันอื่นด้วย (แบ่งคัน) — โชว์ว่าคันอื่นรับไปเท่าไหร่
                pickups: { where: { pickupId: { not: id } }, select: { parcelCount: true, pickup: { select: { id: true, plate: true, status: true } } } },
              },
            },
          },
        },
      },
    }),
    db.vehicle.findMany({ where: { carrier: { not: null } }, distinct: ["carrier"], select: { carrier: true } }),
  ]);
  if (!pickup) notFound();

  const doing = pickup.status === "DOING";
  // ใบที่แบ่งหลายคัน นับเฉพาะส่วนของคันนี้
  const total = pickup.manifests.reduce((n, pm) => n + takenOf(pm), 0);
  const mismatch = pickup.parcelCount != null && total > 0 && total !== pickup.parcelCount;
  // กรองตามขนส่ง — กรองในเครื่อง (ShippingFilter) ไม่ต้องโหลดหน้าใหม่
  const ship = typeof sp.ship === "string" ? sp.ship : undefined;
  // แท็บรายวันใน Google Sheets ที่แถวของงานนี้จะไปลง (ตามวันที่รถเข้ารับ)
  const sheetTab = dailyTabName(pickup.arrivedAt);
  const allParcels = pickup.manifests.flatMap((pm) => pm.manifest?.parcels ?? []);
  // น้ำหนักรวมทั้งคัน — มีเมื่อกด "ดูน้ำหนักรวม" แล้ว
  // items (JSON ~330 byte/ชิ้น) ใช้แค่คิดน้ำหนัก → ไม่ดึงตอนกำลังสแกน (หน้าโหลดใหม่ทุกใบที่สแกน ทั้งคันหลายพันชิ้น = egress ก้อนใหญ่สุด)
  const itemsById = new Map<string, unknown>(
    doing || !allParcels.length
      ? []
      : (
          await db.manifestParcel.findMany({
            where: { manifestId: { in: pickup.manifests.flatMap((pm) => (pm.manifestId ? [pm.manifestId] : [])) } },
            select: { id: true, items: true },
          })
        ).map((p) => [p.id, p.items]),
  );
  const weightOf = (ps: { id: string }[]) => totalWeight(ps.map((p) => ({ items: itemsById.get(p.id) ?? null })));
  const weight = weightOf(allParcels);
  const hasWeight = weight.missing < allParcels.length;
  const shipGroups = countByShipping(allParcels);
  const bs = typeof sp.bs === "string" ? sp.bs : undefined;
  const cookie = await cookieP;
  // เช็ค Flash ล่าสุดเมื่อไหร่ (ชิ้นที่เช็คล่าสุด)
  const flashAt = allParcels.reduce<Date | null>((d, p) => (p.flashFetchedAt && (!d || p.flashFetchedAt > d) ? p.flashFetchedAt : d), null);
  // ชิ้น Flash ที่ยังไม่เคยเช็คเลย — ปุ่มเช็คเฉพาะกลุ่มนี้ เร็วกว่าเช็คทั้งคัน
  const unchecked = allParcels.filter((p) => !p.flashFetchedAt && isFlashParcel(p)).length;

  const info: [string, ReactNode][] = [
    ["ขนส่ง", pickup.carrier ?? "—"],
    ["คนขับ", pickup.driverName ?? pickup.vehicle?.driverName ?? "—"],
    ["เริ่มงาน", fmtDateTime(pickup.arrivedAt)],
    ["ปิดงาน", pickup.departedAt ? fmtDateTime(pickup.departedAt) : "—"],
    ["ใช้เวลา", fmtDuration(pickup.arrivedAt, pickup.departedAt) ?? "—"],
    ["จำนวนที่รถนับ", pickup.parcelCount ?? "—"],
    ["พัสดุตาม manifest", total],
    ["ผู้จด", pickup.recordedBy ?? "—"],
  ];

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/pickups", label: "รอบรถ" }]}
        current={pickup.plate}
        eyebrow={
          <span className="flex items-center gap-2">
            {pickup.carrier ?? "รอบรถ"} <PickupStatusPill status={pickup.status} />
          </span>
        }
        title={
          <ViewTransition name={plateVT(pickup.id)}>
            <span className="inline-block">{pickup.plate}</span>
          </ViewTransition>
        }
        actions={
          <>
            {!doing && <ReopenButton pickupId={pickup.id} />}
            <LinkButton href={`/pickups/${pickup.id}/edit`} variant="outline">
              <PencilIcon />
              แก้เวลา
            </LinkButton>
            {/* มือถือ: ซ่อนปุ่มที่ใช้ไม่บ่อย ให้หัวหน้าโล่ง */}
            <span className="hidden gap-2 sm:contents">
              {lineConfigured() && <SyncButton action={sendPickupReport.bind(null, pickup.id)} label="ส่งเข้า LINE" variant="outline" />}
              <PrintButton />
            </span>
            <ConfirmButton
              action={deletePickup.bind(null, pickup.id, "/pickups")}
              label={<Trash2Icon />}
              size="icon"
              variant="ghost"
              title={`ลบรอบรถ ${pickup.plate}?`}
              description="ลบแล้วกู้คืนไม่ได้ — manifest ที่จดในงานนี้ และเลขแทร็คกิ้งของใบที่ไม่มีรถคันอื่นรับ จะหายด้วย"
              confirmLabel="ลบ"
            />
          </>
        }
      />

      {sp.already && doing && (
        <div className="mb-6">
          <Notice tone="blue">รถคันนี้มีงานที่ยังไม่ปิดอยู่แล้ว — พามาที่งานเดิม</Notice>
        </div>
      )}

      {doing && (
        <DoingBar
          pickupId={pickup.id}
          plate={pickup.plate}
          since={pickup.arrivedAt.toISOString()}
          manifests={pickup.manifests.length}
          parcels={total}
          parcelCount={pickup.parcelCount}
        />
      )}

      {mismatch && (
        <div className="mb-6">
          <Notice tone="red">
            จำนวนที่รถนับ ({pickup.parcelCount}) ไม่ตรงกับพัสดุใน manifest ({total}) — ตรวจสอบกับขนส่ง
          </Notice>
        </div>
      )}

      <div className={doing ? "grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_300px]" : "min-w-0"}>
        <div className="min-w-0">
          <Section title={`Manifest (${pickup.manifests.length})`}>
            <ManifestScanner
              pickupId={pickup.id}
              editable={doing}
              prefix={await currentManifestPrefix()}
              items={pickup.manifests.map((pm) => ({
                id: pm.id,
                code: pm.code,
                manifestId: pm.manifestId,
                manifestNo: pm.manifest?.manifestNo ?? null,
                parcels: pm.manifest?.parcels.length ?? 0,
                expected: pm.manifest?.parcelCount ?? null,
                taken: pm.parcelCount,
                alsoOn: pm.manifest?.pickups.map((o) => o.pickup.plate) ?? [],
                others: pm.manifest?.pickups.map((o) => ({ plate: o.pickup.plate, count: o.parcelCount, doing: o.pickup.status === "DOING" })) ?? [],
                addedAt: fmtTime(pm.createdAt),
                addedBy: pm.addedBy,
                note: pm.note,
                cageId: pm.cageId,
              }))}
              cages={pickup.cages.map((c) => ({
                id: c.cage.id,
                label: c.cage.label,
                open: c.cage.closedAt == null && c.cage.originPickupId === pickup.id,
                mine: c.cage.originPickupId === pickup.id,
                share: c.share,
                count: c.count,
                others: c.cage.shares.map((o) => ({ plate: o.pickup.plate, share: o.share, count: o.count, doing: o.pickup.status === "DOING" })),
              }))}
            />
          </Section>

          {!doing && (
            <Panel className="mb-10 p-6">
              <KeyValues items={info} />
              {pickup.note && <p className="mt-4 text-sm text-body">หมายเหตุ: {pickup.note}</p>}
            </Panel>
          )}

          {pickup.manifests.some((pm) => pm.manifest?.parcels.length) && (
            <Section
              title={`พัสดุ (${total})${hasWeight ? ` · ${fmtWeight(weight.grams)}` : ""}`}
              aside={
                <div className="flex flex-wrap justify-end gap-2">
                  {unchecked > 0 && <SyncButton action={runPickupUncheckedFlash.bind(null, pickup.id)} label={`เช็คที่ยังไม่เช็ค (${unchecked})`} />}
                  <SyncButton action={runPickupStatusSync.bind(null, pickup.id)} label="เช็คสถานะ Flash ทั้งหมด" variant={unchecked > 0 ? "outline" : "default"} />
                  {cookie && <SyncButton action={refetchPickupManifests.bind(null, pickup.id)} label="ดึงเลขแทร็คใหม่" variant="outline" />}
                  {cookie && <SyncButton action={runPickupWeight.bind(null, pickup.id)} label={hasWeight ? "ดูน้ำหนักรวมใหม่" : "ดูน้ำหนักรวม"} variant="outline" />}
                </div>
              }
            >
              <div className="flex flex-wrap items-start gap-x-2">
                <div className="min-w-0 flex-1">
                  <TableSearch scope="pickup-parcels" />
                </div>
                <CopyTrackingsButton scope="pickup-parcels" />
                <SendToSheetsButton scope="pickup-parcels" sheetUrl={sheetsUrl()} configured={sheetsConfigured()} pickupId={pickup.id} />
              </div>
              <SelectionBar scope="pickup-parcels" sheets={sheetsConfigured()} pickupId={pickup.id} />
              <p className="mb-2 text-xs text-mute">{flashAt ? `สถานะจากเว็บ Flash · เช็คล่าสุด ${fmtDateTime(flashAt)}` : "ยังไม่เคยเช็คสถานะกับ Flash — กด “เช็คสถานะ Flash”"}</p>
              <ShippingFilter
                by="bs"
                title="สถานะ Flash"
                always
                groups={countByStatus(allParcels)}
                total={allParcels.length}
                scope="pickup-parcels"
                initial={bs}
              />
              <ShippingFilter groups={shipGroups} total={shipGroups.reduce((n, [, c]) => n + c, 0)} scope="pickup-parcels" initial={ship} />
              {pickup.manifests.length > 1 && <CollapseAllButton scope="pickup-parcels" />}
              <div id="pickup-parcels" className="grid min-w-0 gap-3 [&>*]:min-w-0">
                {pickup.manifests.map(
                  (pm) =>
                    pm.manifest &&
                    pm.manifest.parcels.length > 0 && (
                      // พับได้ทีละใบ — หลายใบเริ่มแบบพับไว้ เห็นแค่หัวใบ ไม่ต้องเลื่อนยาว
                      <details key={pm.id} id={`pm-${pm.id}`} data-ship-group data-fold open={pickup.manifests.length === 1} className="group/fold">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 select-none hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
                          <p className="flex min-w-0 items-center gap-1.5 text-sm">
                            <ChevronRightIcon className="size-4 shrink-0 text-mute transition-transform group-open/fold:rotate-90" />
                            <Link href={`/manifests/${pm.manifest.id}`} className="font-mono font-medium hover:underline">
                              {pm.manifest.manifestNo}
                            </Link>{" "}
                            <span className="truncate text-mute">
                              · {pm.manifest.parcels.length} ชิ้น
                              {hasWeight && ` · ${fmtWeight(weightOf(pm.manifest.parcels).grams)}`}
                              {pm.parcelCount != null && ` · คันนี้รับ ${pm.parcelCount} (แสดงทั้งใบ)`}
                              {pm.manifest.printedAt && ` · พิมพ์ ${fmtDateTime(pm.manifest.printedAt)}`}
                            </span>
                          </p>
                          {/* คัดลอกเฉพาะใบนี้ (ตามตัวกรองที่เลือกอยู่) */}
                          <CopyTrackingsButton scope={`pm-${pm.id}`} compact />
                          <SendToSheetsButton scope={`pm-${pm.id}`} sheetUrl={sheetsUrl()} configured={sheetsConfigured()} pickupId={pickup.id} compact />
                        </summary>
                        <div className="pt-2 pb-4">
                          {/* ความกว้างคอลัมน์คงที่ — คอลัมน์ Flash กินที่ที่เหลือ ข้อความยาวขึ้นบรรทัดใหม่ในช่อง ไม่ดันตารางล้น */}
                          <DataTable
                            fixed
                            head={[
                              { label: "เลขแทร็คกิ้ง", className: "sm:w-[10.5rem]" },
                              { label: "ออเดอร์", className: "hidden w-[11rem] xl:table-cell" },
                              { label: "ขนส่ง", className: "hidden w-36 2xl:table-cell" },
                              { label: "Flash", className: HIDE_SM },
                              { label: "สถานะ", className: "w-[11rem] sm:w-[9.5rem]" },
                            ]}
                          >
                            {pm.manifest.parcels.map((p) => (
                              <TableRow
                                key={p.id}
                                data-ship={shipKey(p.shippingMethod)}
                                data-bs={statusKey(p)}
                                data-tracking={p.trackingNo}
                                data-pid={p.id}
                                data-tab={sheetTab}
                                data-q={searchKey(p.trackingNo, p.orderNo)}
                                className={bsTone(p) ? BS_ROW[bsTone(p)!] : ""}
                              >
                                {/* มือถือ: คอลัมน์นี้กินที่ที่เหลือ ข้อความยาวตัด … ไม่ดันตารางเกินจอ */}
                                <TableCell className="overflow-hidden">
                                  <div className="flex min-w-0 items-center">
                                    <RowCheck id={p.id} trackingNo={p.trackingNo} />
                                    <Link href={`/parcels/${p.id}`} className="block min-w-0 truncate font-mono text-[13px] hover:underline">
                                      {p.trackingNo}
                                    </Link>
                                  </div>
                                  {/* มือถือ: สถานะ Flash + ความเคลื่อนไหวล่าสุด อยู่ใต้เลขแทร็คกิ้งแทนคอลัมน์ */}
                                  <span title={p.flashLastRoute ?? undefined} className="block truncate text-xs text-mute sm:hidden">
                                    {p.flashLastRoute ?? p.shippingMethod ?? "—"}
                                  </span>
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
                            ))}
                          </DataTable>
                        </div>
                      </details>
                    ),
                )}
              </div>
            </Section>
          )}
        </div>

        {doing && (
          <aside className="no-print">
            <Panel className="p-6 xl:sticky xl:top-24">
              <h2 className="mb-4 font-semibold">รายละเอียด</h2>
              <PickupDetailsForm
                pickupId={pickup.id}
                carriers={carriers.map((c) => c.carrier!)}
                details={{
                  parcelCount: pickup.parcelCount,
                  carrier: pickup.carrier,
                  driverName: pickup.driverName,
                  note: pickup.note,
                }}
              />
            </Panel>
          </aside>
        )}
      </div>

      <p className="mt-6 font-mono text-xs text-mute">
        บันทึกเมื่อ {fmtDateTime(pickup.createdAt)} · แก้ไขล่าสุด {fmtDateTime(pickup.updatedAt)}
      </p>
      {/* มือถือ: เว้นที่ให้ปุ่ม "ปิดงาน" ที่ลอยอยู่ล่างจอ */}
      {doing && <div aria-hidden className="h-20 sm:hidden" />}
    </Page>
  );
}
