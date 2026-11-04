import Link from "next/link";
import { ViewTransition } from "react";
import { PlayIcon, Trash2Icon } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { pickupScope } from "@/lib/pickup-access";
import { takenOf } from "@/lib/shipping";
import { deletePickup } from "@/app/actions/pickups";
import { ConfirmButton } from "@/components/client-actions";
import { dayRange, fmtDate, fmtDuration, fmtTime, todayKey } from "@/lib/format";
import { DataTable, Empty, LinkButton, Mono, Page, PageHeader, Pill, PickupStatusPill, Section } from "@/components/kit";
import { LiveTimer } from "@/components/motion";
import { DoingCards, plateVT } from "@/components/pickup-cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { CARRIER_FAMILIES, FLASH_PILL, TONE_LABEL, TONE_ORDER, carrierFamily, parcelTone, type CarrierFamily, type FlashTone } from "@/lib/flash-state";
import { sheetsConfigured } from "@/lib/sheets";
import { exportPickupsToSheets } from "@/app/actions/sheets";
import { PickupsStatusPanel } from "@/components/pickups-status-panel";
import { refreshPickupsFlash } from "@/app/actions/manifests";

export const metadata = { title: "รอบรถ" };

const withParcels = {
  manifests: {
    orderBy: { createdAt: "asc" },
    include: { manifest: { select: { _count: { select: { parcels: true } } } } },
  },
} as const;

export default async function PickupsPage({ searchParams }: PageProps<"/pickups">) {
  const sp = await searchParams;
  const date = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayKey();
  const plate = typeof sp.plate === "string" ? sp.plate.trim() : "";
  // กรองขนส่ง ?ship=flash|spx|other|all · ค่าเริ่มต้น = Flash
  const ship: CarrierFamily | "all" = sp.ship === "all" || CARRIER_FAMILIES.some((f) => f.key === sp.ship) ? (sp.ship as CarrierFamily | "all") : "flash";

  // staff เห็นเฉพาะงานของตัวเอง · แอดมินเห็นทุกงาน
  const mine = await pickupScope(await requireUser());
  const [doing, pickups] = await Promise.all([
    db.pickup.findMany({ where: { ...mine, status: "DOING" }, orderBy: { arrivedAt: "asc" }, include: withParcels }),
    db.pickup.findMany({
      // ค้นทะเบียน = ค้นทุกวัน, ไม่ค้น = ดูทีละวัน
      where: { ...mine, ...(plate ? { plate: { contains: plate, mode: "insensitive" } } : { arrivedAt: dayRange(date) }) },
      orderBy: { arrivedAt: "desc" },
      take: 200,
      include: withParcels,
    }),
  ]);

  const parcelsOf = (p: (typeof pickups)[number]) => p.manifests.reduce((n, pm) => n + takenOf(pm), 0);

  // สถานะพัสดุของทุกคันในรายการ — นับใน DB ทีเดียว (ใบ × สถานะร้าน × สถานะ Flash) ไม่ต้องกดเข้าไปดูทีละคัน
  const manifestIds = [...new Set(pickups.flatMap((p) => p.manifests.map((pm) => pm.manifestId)).filter((x): x is string => Boolean(x)))];
  const groups = manifestIds.length
    ? await db.manifestParcel.groupBy({ by: ["manifestId", "status", "flashState", "shippingMethod", "bsStatusText"], where: { manifestId: { in: manifestIds } }, _count: { _all: true } })
    : [];
  const toneByManifest = new Map<string, Map<FlashTone, number>>();
  /** จำนวนชิ้นของแต่ละขนส่ง (โชว์บนปุ่มกรอง) */
  const shipCounts: Record<CarrierFamily, number> = { flash: 0, spx: 0, other: 0 };
  for (const g of groups) {
    const fam = carrierFamily(g);
    shipCounts[fam] += g._count._all;
    if (ship !== "all" && fam !== ship) continue;
    const m = toneByManifest.get(g.manifestId) ?? new Map<FlashTone, number>();
    const tone = parcelTone(g);
    m.set(tone, (m.get(tone) ?? 0) + g._count._all);
    toneByManifest.set(g.manifestId, m);
  }
  const tonesOf = (manifestIdsOfPickup: (string | null)[]) => {
    const sum = new Map<FlashTone, number>();
    for (const id of manifestIdsOfPickup) for (const [t, n] of (id && toneByManifest.get(id)) || []) sum.set(t, (sum.get(t) ?? 0) + n);
    return sum;
  };
  const dayTones = tonesOf(manifestIds);

  return (
    <Page>
      <PageHeader
        title="รอบรถเข้ารับ"
        actions={
          <LinkButton href="/pickups/new">
            <PlayIcon />
            เริ่มงานรถเข้า
          </LinkButton>
        }
      />

      {doing.length > 0 && (
        <Section title={`กำลังทำ (${doing.length})`}>
          <DoingCards pickups={doing.map((p) => ({ ...p, parcels: parcelsOf(p) }))} />
        </Section>
      )}

      <Section title={plate ? `ทะเบียนที่มี “${plate}”` : fmtDate(dayRange(date).gte)}>
        {/* สรุปสถานะพัสดุของทุกคันในรายการ + ส่งอัปเดตไป Sheets */}
        {groups.length > 0 && (
          <PickupsStatusPanel
            ship={ship}
            shipCounts={shipCounts}
            shipHrefs={Object.fromEntries(
              (["all", ...CARRIER_FAMILIES.map((f) => f.key)] as const).map((k) => [
                k,
                `/pickups?${new URLSearchParams({ ...(sp.date ? { date } : {}), ...(plate ? { plate } : {}), ...(k === "flash" ? {} : { ship: k }) })}`,
              ]),
            )}
            tones={TONE_ORDER.filter((t) => dayTones.get(t)).map((t) => [t, dayTones.get(t)!])}
            sheets={sheetsConfigured()}
            refresh={refreshPickupsFlash.bind(null, pickups.map((p) => p.id))}
            exportRows={exportPickupsToSheets.bind(null, pickups.map((p) => p.id), ship)}
          />
        )}

        <form className="mb-4 flex flex-wrap gap-2">
          {/* เปลี่ยนวัน/ค้นทะเบียน แล้วยังกรองขนส่งเหมือนเดิม */}
          {ship !== "flash" && <input type="hidden" name="ship" value={ship} />}
          <Input type="date" name="date" defaultValue={date} className="w-auto bg-card" />
          <Input name="plate" defaultValue={plate} placeholder="ค้นทะเบียน (ทุกวัน)" className="w-52 bg-card" />
          <Button type="submit" variant="outline">
            ดู
          </Button>
        </form>

        {pickups.length === 0 ? (
          <Empty>ไม่มีรอบรถ</Empty>
        ) : (
          <DataTable head={["วันที่", "ทะเบียน", "เริ่ม", "ปิดงาน", "ใช้เวลา", "Manifest", "ชิ้น ระบบ/นับ", "สถานะพัสดุ", "สถานะ", ""]}>
            {pickups.map((p) => {
              const sys = parcelsOf(p);
              const mismatch = p.parcelCount != null && sys > 0 && sys !== p.parcelCount;
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-body">{fmtDate(p.arrivedAt)}</TableCell>
                  <TableCell>
                    <Link href={`/pickups/${p.id}`} className="font-medium hover:underline">
                      <ViewTransition name={plateVT(p.id)}>
                        <span>{p.plate}</span>
                      </ViewTransition>
                    </Link>
                    <span className="block text-xs text-mute">{p.carrier ?? "—"}</span>
                  </TableCell>
                  <TableCell className="tabular">{fmtTime(p.arrivedAt)}</TableCell>
                  <TableCell className="tabular">{p.departedAt ? fmtTime(p.departedAt) : "—"}</TableCell>
                  <TableCell className="text-body">
                    {p.departedAt ? fmtDuration(p.arrivedAt, p.departedAt) : <LiveTimer since={p.arrivedAt.toISOString()} className="tabular font-mono" />}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {p.manifests.map((pm) => (
                        <Mono key={pm.id} className={pm.manifestId ? "" : "text-warning-deep"}>
                          {pm.code}
                        </Mono>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="tabular">
                    {sys} / {p.parcelCount ?? "—"} {mismatch && <Pill tone="red">ไม่ตรง</Pill>}
                  </TableCell>
                  <TableCell className="min-w-48">
                    <Link href={`/pickups/${p.id}`} className="block">
                      <ToneChips tones={tonesOf(p.manifests.map((pm) => pm.manifestId))} small />
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PickupStatusPill status={p.status} />
                  </TableCell>
                  <TableCell className="no-print w-10 text-right">
                    <ConfirmButton
                      action={deletePickup.bind(null, p.id)}
                      label={<Trash2Icon />}
                      variant="ghost"
                      size="icon-sm"
                      title={`ลบรอบรถ ${p.plate}?`}
                      description="ลบแล้วกู้คืนไม่ได้ — manifest ที่จดในงานนี้ และเลขแทร็คกิ้งของใบที่ไม่มีรถคันอื่นรับ จะหายด้วย"
                      confirmLabel="ลบ"
                      done={`ลบรอบรถ ${p.plate} แล้ว`}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </DataTable>
        )}
      </Section>
    </Page>
  );
}

/** ชิปนับจำนวนตามกลุ่มสถานะ — เรื่องที่ต้องตาม (ยกเลิก / มีปัญหา / ตีกลับ) ขึ้นก่อน */
function ToneChips({ tones, small = false }: { tones: Map<FlashTone, number>; small?: boolean }) {
  const list = TONE_ORDER.filter((t) => tones.get(t));
  if (!list.length) return <span className="text-xs text-mute">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((t) => (
        <span key={t} className={`inline-flex items-center rounded-full font-medium tabular ${small ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"} ${FLASH_PILL[t]}`}>
          {TONE_LABEL[t]} {tones.get(t)}
        </span>
      ))}
    </span>
  );
}
