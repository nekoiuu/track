import Link from "next/link";
import { connection } from "next/server";
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { FLASH_PILL, flashLabel, flashTone, isFlashParcel } from "@/lib/flash-state";
import { PAGE_SIZES, RANGES, STALE_DAYS, TRACK_TABS, autoFlashIds, autoFlashMinutes, loadTracking, type TrackRow, type TrackTab } from "@/lib/tracking";
import { refreshTrackingFlash, runTrackingFlash } from "@/app/actions/manifests";
import { exportTrackingCase } from "@/app/actions/sheets";
import { sheetsConfigured } from "@/lib/sheets";
import { backgroundStatus } from "@/lib/tracker-status";
import { SyncButton } from "@/components/client-actions";
import { CopyTrackingsButton } from "@/components/copy-trackings";
import { Empty, LinkButton, Page, PageHeader, Panel, ParcelStatusPill } from "@/components/kit";
import { ParcelEditButton } from "@/components/parcel-edit";
import { MultiSearchInput } from "@/components/shipping-filter";
import { ShareCaseButton } from "@/components/share-button";
import { SheetsUpdateAllButton } from "@/components/sheets-update-button";
import { RowCheck, SelectionBar } from "@/components/row-select";
import { AutoFlashRefresh, FilterLink, LiveRefresh, LoadingArea, TrackingFlashButtons, TrackingShell } from "./tracking-client";

export const metadata = { title: "ติดตามสถานะ" };

const DAY = 86_400_000;
const num = (v: unknown, allowed: readonly number[], d: number) => (allowed.includes(Number(v)) ? Number(v) : d);
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * ติดตามสถานะ — ยกเลิกยังไม่คืน / สถานะไม่อัปเดต / ตีกลับ-มีปัญหา / ยังไม่เข้า Flash
 * กรองด้วยลิงก์ (?tab=&range=&stale=) · ค้นเลขแทร็ค (?q=) · แบ่งหน้าฝั่ง server (?page=) ทีละ ?size= ชิ้น (PAGE_SIZES)
 */
export default async function TrackingPage({ searchParams }: PageProps<"/tracking">) {
  await connection();
  const sp = await searchParams;
  const tab = (TRACK_TABS.some((t) => t.key === sp.tab) ? sp.tab : "cancel") as TrackTab;
  const q = str(sp.q).trim().slice(0, 4000);
  const rangeDays = num(sp.range, RANGES, 30);
  const staleDays = num(sp.stale, STALE_DAYS, Number(process.env.STATUS_STUCK_DAYS) || 2);
  const page = Math.max(1, Math.floor(Number(sp.page) || 1));
  const size = num(sp.size, PAGE_SIZES, PAGE_SIZES[0]);

  const rendered = new Date();
  const renderedAt = rendered.toISOString();
  const now = rendered.getTime();
  // มีอัปเดตเบื้องหลังที่ทำงานจริง (track-tick — timer ในเว็บ / cron) → เช็คเฉพาะข้อมูลที่เก่ามาก · ไม่มีอะไรเลย → เช็คตอนเปิดหน้าแบบเดิม
  const [data, bg] = await Promise.all([loadTracking({ tab, q, page, pageSize: size, rangeDays, staleDays }), backgroundStatus()]);
  const current = TRACK_TABS.find((t) => t.key === tab)!;

  /** ลิงก์ที่คงค่ากรองอื่นไว้ · เปลี่ยนตัวกรอง = กลับหน้า 1 */
  const href = (o: { tab?: TrackTab; range?: number; stale?: number; page?: number; size?: number; q?: string | null }) => {
    const p = new URLSearchParams();
    const t = o.tab ?? tab;
    if (t !== "cancel") p.set("tab", t);
    const r = o.range ?? rangeDays;
    if (r !== 30) p.set("range", String(r));
    const s = o.stale ?? staleDays;
    p.set("stale", String(s));
    const qq = o.q === null ? "" : (o.q ?? q);
    if (qq) p.set("q", qq);
    const z = o.size ?? size;
    if (z !== PAGE_SIZES[0]) p.set("size", String(z));
    if (o.page && o.page > 1) p.set("page", String(o.page));
    return `/tracking?${p}`;
  };

  const chip = "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors sm:h-9 sm:px-3";
  const on = "border-brand bg-brand text-white";
  const off = "bg-card text-body hover:bg-muted active:bg-muted";

  return (
    <Page>
      <TrackingShell>
      <PageHeader title="ติดตามพัสดุ" description={<span className="text-sm">{q ? "ผลค้นหา — ทุกชิ้นในระบบ" : current.hint}</span>} actions={<>{sheetsConfigured() && <SheetsUpdateAllButton />}<LinkButton href="/links" variant="outline">ลิงก์ที่แชร์</LinkButton></>} />

      {/* ค้นหา — GET ธรรมดา ไม่ต้องรอ JS · วางหลายเลขคั่นด้วยเว้นวรรค/จุลภาคได้ */}
      <form action="/tracking" className="relative mb-4">
        {tab !== "cancel" && <input type="hidden" name="tab" value={tab} />}
        <input type="hidden" name="range" value={rangeDays} />
        <input type="hidden" name="stale" value={staleDays} />
        {size !== PAGE_SIZES[0] && <input type="hidden" name="size" value={size} />}
        <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-mute" />
        <MultiSearchInput
          type="search"
          name="q"
          defaultValue={q}
          placeholder="ค้นหาเลขแทร็ค / ออเดอร์ (หลายเลขเว้นวรรค)"
          autoComplete="off"
          className="h-12 w-full rounded-2xl border bg-card pr-12 pl-12 font-mono text-base shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ink/20 sm:rounded-xl"
        />
        {q && (
          <Link href={href({ q: null })} aria-label="ล้างคำค้น" className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-full text-mute hover:bg-muted">
            <XIcon className="size-5" />
          </Link>
        )}
      </form>

      {!q && (
        <>
          {/* แท็บ — เลื่อนแนวนอนบนมือถือ */}
          <nav aria-label="ประเภท" className="no-print -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
            {TRACK_TABS.map((t) => {
              const n = data.counts[t.key];
              const alert = t.key !== "all" && n > 0;
              return (
                <FilterLink key={t.key} href={href({ tab: t.key })} group="tab" value={t.key} current={tab} className={cn(chip, "group")} onClass={on} offClass={off}>
                  {t.label}
                  <span
                    className={cn(
                      "tabular rounded-full px-1.5 text-xs font-semibold group-aria-[current=page]:bg-white/20 group-aria-[current=page]:text-white",
                      alert ? (t.key === "cancel" ? "bg-error-soft text-error-deep" : "bg-warning-soft text-warning-deep") : "text-mute",
                    )}
                  >
                    {n}
                  </span>
                </FilterLink>
              );
            })}
          </nav>

          {/* ตัวกรองย่อย */}
          <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-mute">รถออกภายใน</span>
              {RANGES.map((r) => (
                <FilterLink key={r} href={href({ range: r })} group="range" value={String(r)} current={String(rangeDays)} className="grid h-9 min-w-11 place-items-center rounded-lg border px-2 tabular" onClass={on} offClass={off}>
                  {r} วัน
                </FilterLink>
              ))}
            </span>
            {tab === "stale" && (
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-mute">ไม่ขยับเกิน</span>
                {STALE_DAYS.map((d) => (
                  <FilterLink key={d} href={href({ stale: d })} group="stale" value={String(d)} current={String(staleDays)} className="grid h-9 min-w-11 place-items-center rounded-lg border px-2 tabular" onClass={on} offClass={off}>
                    {d} วัน
                  </FilterLink>
                ))}
              </span>
            )}
          </div>
        </>
      )}

      {/* ตาราง — ระหว่างโหลดของใหม่ จางลง + วงหมุนกลางตาราง */}
      <LoadingArea>
      {/* แถบจำนวน + ปุ่ม — มือถือจอแคบปุ่มขึ้นบรรทัดใหม่ ไม่ล้นจอ */}
      <div className="no-print mb-3 flex flex-wrap items-center gap-2 px-1 sm:px-0">
        <p className="mr-auto text-sm text-body">
          <b className="tabular text-ink">{data.total}</b> ชิ้น
          {data.total > size && (
            <span className="text-mute">
              {" "}
              · แสดง {(page - 1) * size + 1}–{Math.min(page * size, data.total)}
            </span>
          )}
        </p>
        {/* แสดงทีละกี่ชิ้น — เปลี่ยนแล้วกลับหน้า 1 */}
        {data.total > PAGE_SIZES[0] && (
          <span className="flex items-center gap-1 text-sm">
            <span className="text-mute">ทีละ</span>
            {PAGE_SIZES.map((z) => (
              <FilterLink key={z} href={href({ size: z })} group="size" value={String(z)} current={String(size)} className="grid h-8 min-w-10 place-items-center rounded-lg border px-1.5 text-xs tabular" onClass={on} offClass={off}>
                {z}
              </FilterLink>
            ))}
          </span>
        )}
        {data.rows.length > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <CopyTrackingsButton scope="tracking-list" compact />
            {/* เฉพาะชิ้นในหน้านี้ที่ยังไม่เคยเช็ค — เร็วกว่าเช็คทั้งหน้า */}
            {data.rows.some((r) => !r.flashFetchedAt && isFlashParcel(r)) && (
              <SyncButton
                action={runTrackingFlash.bind(null, data.rows.filter((r) => !r.flashFetchedAt && isFlashParcel(r)).map((r) => r.id), true)}
                label={`เช็คที่ยังไม่เช็ค (${data.rows.filter((r) => !r.flashFetchedAt && isFlashParcel(r)).length})`}
              />
            )}
            {/* เช็คใหม่ หน้านี้ / ทุกหน้าของแท็บนี้ — ทีละรอบ พักกัน Flash บล็อก */}
            <TrackingFlashButtons
              pageIds={data.rows.map((r) => r.id)}
              total={q ? null : data.total}
              refresh={refreshTrackingFlash.bind(null, { tab, rangeDays, staleDays })}
            />
            {/* ส่งทั้งเคส (ทุกหน้า) ไปแท็บ "ติดตาม-…" ใน Google Sheets */}
            {!q && sheetsConfigured() && (
              <SyncButton action={exportTrackingCase.bind(null, tab, rangeDays, staleDays)} label={`ส่ง ${data.total} ชิ้นไป Sheets`} variant="outline" />
            )}
            {/* ลิงก์สาธารณะของเคสนี้ (รายการล่าสุดเสมอ) — แปะใน Sheets ให้ใครก็กดดูได้ */}
            {!q && <ShareCaseButton filter={{ tab, rangeDays, staleDays }} />}
          </div>
        )}
      </div>

      {/* รอ event ทุกแท็บ แม้แท็บว่าง — ของเพิ่งมีปัญหาจะโผล่เองไม่ต้องกดรีโหลด */}
      <LiveRefresh since={renderedAt} />
      {data.rows.length === 0 ? (
        <Empty>{q ? "ไม่พบเลขนี้ในระบบ" : tab === "all" ? "ยังไม่มีพัสดุที่ขึ้นรถในช่วงนี้" : "ไม่มีรายการที่ต้องตาม 🎉"}</Empty>
      ) : (
        <>
          {/* เช็ค Flash ให้เฉพาะชิ้นที่ข้อมูลเก่า (มีอัปเดตเบื้องหลังทำงานอยู่ → เกณฑ์ "เก่า" ยาวขึ้น) */}
          <AutoFlashRefresh ids={autoFlashIds(data.rows, autoFlashMinutes(bg.active), now)} />
          <SelectionBar scope="tracking-list" sheets={sheetsConfigured()} />
          <Panel id="tracking-list" className="divide-y overflow-hidden">
            {data.rows.map((p) => (
              <Row key={p.id} p={p} now={now} />
            ))}
          </Panel>
        </>
      )}

      {data.pages > 1 && <Pager page={page} pages={data.pages} href={(n) => href({ page: n })} />}      </LoadingArea>
      </TrackingShell>
    </Page>
  );
}

function Row({ p, now }: { p: TrackRow; now: number }) {
  const truck = p.manifest.pickups[0]?.pickup;
  const label = flashLabel(p);
  const since = p.flashRoutedAt ?? truck?.departedAt ?? null;
  const days = since ? Math.floor((now - since.getTime()) / DAY) : null;

  return (
    <div data-tracking={p.trackingNo} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] sm:gap-x-5">
      {/* เลขแทร็ค + รถ */}
      <div className="min-w-0">
        <div className="flex min-w-0 items-center">
          <RowCheck id={p.id} trackingNo={p.trackingNo} />
          <Link href={`/parcels/${p.id}`} className="block min-w-0 truncate font-mono text-[15px] font-medium hover:underline">
            {p.trackingNo}
          </Link>
        </div>
        <p className="truncate text-xs text-mute">
          {truck ? (
            <Link href={`/pickups/${truck.id}`} className="hover:underline">
              {truck.plate} · ออก {fmtDate(truck.departedAt)}
            </Link>
          ) : (
            "ยังไม่ขึ้นรถ"
          )}
          {p.orderNo && <span className="font-mono"> · {p.orderNo}</span>}
        </p>
      </div>

      {/* สถานะร้าน + แก้ไข (มือถือ: ขวาบน · จอใหญ่: คอลัมน์ท้าย) */}
      <div className="flex items-center justify-end gap-1 sm:order-last">
        <ParcelStatusPill status={p.status} />
        <ParcelEditButton parcel={p} />
      </div>

      {/* สถานะ Flash + ความเคลื่อนไหวล่าสุด */}
      <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
        {label ? (
          <span className={cn("block h-6 max-w-[9rem] shrink-0 truncate rounded-full px-2.5 text-xs leading-6 font-semibold", FLASH_PILL[flashTone(p.flashState)])}>{label}</span>
        ) : (
          <span className="shrink-0 text-xs text-mute">{p.bsStatusText ? `BigSeller: ${p.bsStatusText}` : "ยังไม่ได้เช็ค Flash"}</span>
        )}
        <span title={p.flashLastRoute ?? undefined} className="min-w-0 flex-1 truncate text-xs text-body">
          {p.flashLastRoute ?? ""}
        </span>
        {days != null && days >= 1 && (
          <span
            title={since ? `ล่าสุด ${fmtDateTime(since)}` : undefined}
            className={cn("shrink-0 text-xs tabular", days >= 3 ? "font-semibold text-error-deep" : days >= 2 ? "font-medium text-warning-deep" : "text-mute")}
          >
            {days} วัน
          </span>
        )}
      </div>
    </div>
  );
}

/** แบ่งหน้า — ปุ่มใหญ่ ก่อน/ถัดไป + เลขหน้ารอบ ๆ หน้าปัจจุบัน */
function Pager({ page, pages, href }: { page: number; pages: number; href: (n: number) => string }) {
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const btn = "grid h-11 min-w-11 place-items-center rounded-xl border bg-card px-3 text-sm tabular transition-colors hover:bg-muted active:bg-muted";
  return (
    <nav aria-label="แบ่งหน้า" className="no-print mt-5 flex items-center justify-center gap-1.5">
      {page > 1 ? (
        <FilterLink href={href(page - 1)} group="page" value={String(page - 1)} current={String(page)} className={btn} onClass="" offClass="" aria-label="หน้าก่อน">
          <ChevronLeftIcon className="size-5" />
        </FilterLink>
      ) : (
        <span className={cn(btn, "pointer-events-none opacity-40")}>
          <ChevronLeftIcon className="size-5" />
        </span>
      )}
      {nums.map((n, i) => (
        <span key={n} className="flex items-center gap-1.5">
          {i > 0 && n - nums[i - 1] > 1 && <span className="text-mute">…</span>}
          <FilterLink href={href(n)} group="page" value={String(n)} current={String(page)} className={btn} onClass="border-brand bg-brand text-white hover:bg-brand" offClass="">
            {n}
          </FilterLink>
        </span>
      ))}
      {page < pages ? (
        <FilterLink href={href(page + 1)} group="page" value={String(page + 1)} current={String(page)} className={btn} onClass="" offClass="" aria-label="หน้าถัดไป">
          <ChevronRightIcon className="size-5" />
        </FilterLink>
      ) : (
        <span className={cn(btn, "pointer-events-none opacity-40")}>
          <ChevronRightIcon className="size-5" />
        </span>
      )}
    </nav>
  );
}
