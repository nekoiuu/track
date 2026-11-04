import Link from "next/link";
import { connection } from "next/server";
import { ViewTransition } from "react";
import { ChevronRightIcon, SearchIcon, TruckIcon } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { pickupScope } from "@/lib/pickup-access";
import { dayRange, fmtDateTime, fmtDuration, fmtTime, todayKey } from "@/lib/format";
import { hasCookie } from "@/lib/bigseller";
import { lineConfigured } from "@/lib/line";
import { tabCounts, type TrackTab } from "@/lib/tracking";
import { runStatusReportNow, sendDailyReport } from "@/app/actions/line";
import { SyncButton } from "@/components/client-actions";
import { DataTable, Empty, HIDE_SM, Mono, Notice, Page, Panel, PickupStatusPill, Section } from "@/components/kit";
import { AnimatedNumber } from "@/components/motion";
import { DoingCards, plateVT } from "@/components/pickup-cards";
import { takenOf } from "@/lib/shipping";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "cn";

// manifest ที่จด + จำนวนกล่องของแต่ละใบ
const withParcels = {
  manifests: {
    orderBy: { createdAt: "asc" },
    include: { manifest: { select: { _count: { select: { parcels: true } } } } },
  },
} as const;

/** ค่าเริ่มต้นเดียวกับหน้าติดตาม — ตัวเลขบนหน้าแรกตรงกับที่เห็นเมื่อกดเข้าไป */
const RANGE_DAYS = 30;
const staleDays = () => Number(process.env.STATUS_STUCK_DAYS) || 2;

/** รายการ "ต้องตาม" — กดแล้วไปแท็บนั้นในหน้าติดตาม */
const FOLLOW: { tab: TrackTab; label: string; hint?: (stale: number) => string; tone: "red" | "amber" | "neutral" }[] = [
  { tab: "cancel", label: "ยกเลิกแล้ว ยังไม่ได้ของคืน", tone: "red" },
  { tab: "stale", label: "สถานะไม่ขยับ", hint: (d) => `Flash ไม่มีความเคลื่อนไหวเกิน ${d} วัน`, tone: "amber" },
  { tab: "problem", label: "ตีกลับ / มีปัญหา", tone: "amber" },
  { tab: "notfound", label: "ยังไม่เข้า Flash", tone: "neutral" },
];

const BADGE = {
  red: "bg-error-soft text-error-deep",
  amber: "bg-warning-soft text-warning-deep",
  neutral: "bg-canvas-soft-2 text-body",
};

export default async function Dashboard() {
  await connection();
  const today = dayRange(todayKey());
  const stale = staleDays();
  const opts = { rangeDays: RANGE_DAYS, staleDays: stale };
  // รอบรถ: staff เห็นเฉพาะงานของตัวเอง · ต้องตาม (พัสดุ) เห็นทั้งร้าน
  const mine = await pickupScope(await requireUser());

  const [cookie, doing, doneToday, unlinked, returnsToday, lastSync, follow] = await Promise.all([
    hasCookie(),
    db.pickup.findMany({
      where: { ...mine, status: "DOING" },
      orderBy: { arrivedAt: "asc" },
      include: withParcels,
    }),
    db.pickup.findMany({
      where: { ...mine, status: "DONE", arrivedAt: today },
      orderBy: { departedAt: "desc" },
      include: withParcels,
    }),
    db.pickupManifest.count({ where: { manifestId: null, pickup: mine } }),
    db.returnScan.count({ where: { receivedAt: today } }),
    db.syncRun.findFirst({ where: { kind: "manifests" }, orderBy: { startedAt: "desc" } }),
    // ตัวเลขเดียวกับแท็บในหน้าติดตาม — แคช 2 นาทีใช้ร่วมกัน (นับสดทุกครั้งช้าหลายวินาที)
    tabCounts(opts.rangeDays, opts.staleDays)
      .then((c) => FOLLOW.map((f) => c[f.tab]))
      .catch(() => FOLLOW.map(() => 0)),
  ]);

  // ใบที่แบ่งหลายคัน นับเฉพาะส่วนของคันนั้น (ไม่นับซ้ำ)
  const parcelsOf = (p: { manifests: { parcelCount: number | null; manifest: { _count: { parcels: number } } | null }[] }) =>
    p.manifests.reduce((n, pm) => n + takenOf(pm), 0);
  const parcelsToday = [...doing, ...doneToday].reduce((n, p) => n + parcelsOf(p), 0);

  const trackHref = (tab: TrackTab) => `/tracking?${new URLSearchParams({ ...(tab !== "cancel" && { tab }), stale: String(stale) })}`;
  const followRows = FOLLOW.map((f, i) => ({ ...f, count: follow[i] })).filter((f) => f.count > 0);

  const stats: [string, number, string?][] = [
    ["ปิดงานวันนี้", doneToday.length, "คัน"],
    ["ส่งออกวันนี้", parcelsToday, "ชิ้น"],
    ["รับคืนวันนี้", returnsToday, "ชิ้น"],
  ];

  return (
    <Page>
      {/* หัวหน้าเรียบ ๆ — วันที่ + ชื่อหน้า งานจริงอยู่ข้างล่างทันที */}
      <div className="mb-4 sm:mb-6">
        <p className="text-sm text-mute">
          {new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Bangkok" }).format(new Date())}
        </p>
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.5px] sm:text-[28px] sm:leading-9">วันนี้</h1>
      </div>

      {!cookie ? (
        <div className="mb-5">
          <Notice tone="blue">
            ยังไม่ได้เชื่อม BigSeller — จดรอบรถได้ตามปกติ แต่ระบบจะยังไม่รู้ว่า manifest มีพัสดุอะไร{" "}
            <Link href="/sync" className="font-medium underline">
              ตั้งค่า
            </Link>
          </Notice>
        </div>
      ) : (
        lastSync?.ok === false && (
          <div className="mb-5">
            <Notice tone="red">
              ดึงใบนำจ่ายจาก BigSeller ไม่สำเร็จ ({fmtDateTime(lastSync.startedAt)})
              {lastSync.message ? ` — ${lastSync.message}` : ""}{" "}
              <Link href="/sync" className="font-medium underline">
                ดูรายละเอียด
              </Link>
            </Notice>
          </div>
        )
      )}

      {/* ค้นหา (จอใหญ่มีช่องค้นหาในแถบบนแล้ว) */}
      <form action="/search" className="relative mb-5 lg:hidden">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-mute" />
        <Input name="q" placeholder="เลขพัสดุ · ออเดอร์ · manifest · ทะเบียน" className="h-11 bg-card pl-10 text-base" />
      </form>

      <Section title={`กำลังรับของ${doing.length ? ` · ${doing.length} คัน` : ""}`}>
        {doing.length === 0 ? (
          <Empty icon={<TruckIcon />}>
            ไม่มีรถที่กำลังรับของ{" "}
            <Link href="/pickups/new" className="font-medium text-link hover:underline">
              รับรถคันใหม่
            </Link>
          </Empty>
        ) : (
          <DoingCards pickups={doing.map((p) => ({ ...p, parcels: parcelsOf(p) }))} />
        )}
      </Section>

      <Section
        title="ต้องตาม"
        aside={
          <Link href={trackHref("all")} className="flex min-h-11 items-center text-sm text-link hover:underline">
            ดูทั้งหมด
          </Link>
        }
      >
        {followRows.length === 0 && unlinked === 0 ? (
          <Empty>ไม่มีพัสดุที่ต้องตามในช่วง {RANGE_DAYS} วัน</Empty>
        ) : (
          <Panel className="divide-y overflow-hidden">
            {followRows.map((f) => (
              <Link key={f.tab} href={trackHref(f.tab)} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted/50 active:bg-muted">
                <span className={cn("grid h-6 min-w-8 place-items-center rounded-full px-2 text-sm font-semibold tabular", BADGE[f.tone])}>
                  {f.count.toLocaleString()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{f.label}</span>
                  {f.hint && <span className="block text-xs text-mute">{f.hint(stale)}</span>}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-mute" />
              </Link>
            ))}
            {unlinked > 0 && (
              <div className="flex min-h-14 items-center gap-3 px-4 py-2">
                <span className={cn("grid h-6 min-w-8 place-items-center rounded-full px-2 text-sm font-semibold tabular", BADGE.neutral)}>{unlinked}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">manifest ยังไม่พบใน BigSeller</span>
                  <span className="block text-xs text-mute">เลขสีเหลืองในรอบรถ — แตะ “แก้เลข” ในหน้างานรถ</span>
                </span>
              </div>
            )}
          </Panel>
        )}
      </Section>

      <Section title="สรุปวันนี้">
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {stats.map(([label, value, unit]) => (
            <Panel key={label} className="px-3 py-2.5 sm:px-4 sm:py-3">
              <p className="text-xs text-mute">{label}</p>
              <p className="tabular text-xl leading-7 font-semibold tracking-[-0.4px] sm:text-2xl sm:leading-8">
                <AnimatedNumber value={value} /> <span className="text-xs font-normal text-mute">{unit}</span>
              </p>
            </Panel>
          ))}
        </div>
      </Section>

      <Section
        title="ปิดงานวันนี้"
        aside={
          <Link href="/pickups" className="flex min-h-11 items-center text-sm text-link hover:underline">
            ดูทั้งหมด
          </Link>
        }
      >
        {doneToday.length === 0 ? (
          <Empty>ยังไม่มีงานที่ปิดวันนี้</Empty>
        ) : (
          <>
            {/* มือถือ: รายการแบบแถว แตะทั้งแถวได้ */}
            <Panel className="divide-y overflow-hidden sm:hidden">
              {doneToday.map((p) => (
                <Link key={p.id} href={`/pickups/${p.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 active:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.plate}</span>
                    <span className="block truncate font-mono text-xs text-mute tabular">
                      {fmtTime(p.arrivedAt)}–{fmtTime(p.departedAt)} · {p.manifests.length} ใบ{p.carrier ? ` · ${p.carrier}` : ""}
                    </span>
                  </span>
                  <span className="tabular font-mono font-semibold">{parcelsOf(p)}</span>
                  <ChevronRightIcon className="size-4 shrink-0 text-mute" />
                </Link>
              ))}
            </Panel>
            <div className="hidden sm:block">
              <DataTable
                head={[
                  "ทะเบียน",
                  { label: "เริ่ม", className: HIDE_SM },
                  { label: "ปิดงาน", className: HIDE_SM },
                  { label: "ใช้เวลา", className: HIDE_SM },
                  { label: "Manifest", className: HIDE_SM },
                  { label: "ชิ้น", className: "text-right sm:text-left" },
                  { label: "", className: HIDE_SM },
                ]}
              >
                {doneToday.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/pickups/${p.id}`} className="font-medium hover:underline">
                        <ViewTransition name={plateVT(p.id)}>
                          <span>{p.plate}</span>
                        </ViewTransition>
                      </Link>
                      <span className="block text-xs text-mute">{p.carrier ?? "—"}</span>
                    </TableCell>
                    <TableCell className={`${HIDE_SM} tabular`}>{fmtTime(p.arrivedAt)}</TableCell>
                    <TableCell className={`${HIDE_SM} tabular`}>{fmtTime(p.departedAt)}</TableCell>
                    <TableCell className={`${HIDE_SM} text-body`}>{fmtDuration(p.arrivedAt, p.departedAt)}</TableCell>
                    <TableCell className={HIDE_SM}>
                      <div className="flex flex-wrap gap-1.5">
                        {p.manifests.map((pm) => (
                          <Mono key={pm.id} className={pm.manifestId ? "" : "text-warning-deep"}>
                            {pm.code}
                          </Mono>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-right font-medium sm:text-left sm:font-normal">{parcelsOf(p)}</TableCell>
                    <TableCell className={HIDE_SM}>
                      <PickupStatusPill status={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          </>
        )}
      </Section>

      {/* ส่งรายงานเข้า LINE — จอใหญ่เท่านั้น ไว้ท้ายหน้า (มือถืออยู่ในหน้าแจ้งเตือน LINE) */}
      {lineConfigured() && (
        <div className="hidden flex-wrap justify-end gap-2 border-t pt-4 sm:flex">
          <SyncButton action={runStatusReportNow} label="รายงานสถานะพัสดุเข้า LINE" variant="outline" />
          <SyncButton action={sendDailyReport} label="ส่งสรุปวันนี้เข้า LINE" variant="outline" />
        </div>
      )}
    </Page>
  );
}
