import Link from "next/link";
import { connection } from "next/server";
import { PackageSearchIcon } from "lucide-react";
import { db } from "@/lib/db";
import { dayRange, fmtDateTime, fmtTime, todayKey } from "@/lib/format";
import { backDays, huntMinutes, lastHuntRun, type HuntItem } from "@/lib/cancel-hunt";
import { cageTitle } from "@/lib/cage-name";
import { Empty, Page, PageHeader } from "@/components/kit";
import type { Prisma } from "@/generated/prisma/client";
import { HuntCard, HuntSyncBar, ManualReceiveBox, type HuntView } from "./hunt-client";

export const metadata = { title: "ตามของยกเลิก" };

const TABS = [
  { key: "find", label: "ต้องหา" },
  { key: "done", label: "จัดการแล้ว" },
  { key: "rest", label: "ไม่ต้องหา" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const WHERE: Record<Tab, Prisma.CancelHuntWhereInput> = {
  // ของออกจากชั้นแล้ว ยังไม่มีใครหา
  find: { needsFind: true, status: "PENDING" },
  // กดผลไปแล้ว (ได้คืน / หาไม่เจอ / ข้าม)
  done: { status: { not: "PENDING" } },
  // ยังไม่จ่าย / ยังไม่หยิบ — ของยังอยู่บนชั้น ไม่ต้องทำอะไร
  rest: { needsFind: false, status: "PENDING" },
};

type Range = "today" | "back";

/** ขนส่ง — จับจากชื่อใน BigSeller (เช่น TikTok-TH-Flash Express Thailand → Flash) */
const CARRIERS = [
  { key: "flash", label: "Flash", words: ["Flash"] },
  { key: "spx", label: "SPX", words: ["SPX", "Shopee Xpress"] },
  { key: "jt", label: "J&T", words: ["J&T"] },
  { key: "kerry", label: "Kerry", words: ["Kerry"] },
  { key: "best", label: "Best", words: ["Best"] },
  { key: "post", label: "ไปรษณีย์ไทย", words: ["Thailand Post", "EMS", "THP"] },
  { key: "lex", label: "Lazada (LEX)", words: ["LEX"] },
  { key: "instant", label: "ส่งด่วน / ส่งทันที", words: ["Instant", "SHP Food", "Grab"] },
] as const;
type CarrierKey = (typeof CARRIERS)[number]["key"] | "other";
const carrierOf = (c: string | null): CarrierKey => {
  const s = (c ?? "").toLowerCase();
  return CARRIERS.find((x) => x.words.some((w) => s.includes(w.toLowerCase())))?.key ?? "other";
};
const carrierWhere = (k: CarrierKey): Prisma.CancelHuntWhereInput => {
  if (k !== "other") return { OR: CARRIERS.find((x) => x.key === k)!.words.map((w) => ({ carrier: { contains: w, mode: "insensitive" as const } })) };
  return { OR: [{ carrier: null }, { AND: CARRIERS.flatMap((x) => x.words).map((w) => ({ NOT: { carrier: { contains: w, mode: "insensitive" as const } } })) }] };
};

/** วันที่พิมพ์ใบปะหน้า */
const LABELS = [
  { key: "today", label: "พิมพ์วันนี้" },
  { key: "yesterday", label: "เมื่อวาน" },
  { key: "older", label: "ก่อนหน้านั้น" },
  { key: "none", label: "ยังไม่พิมพ์" },
] as const;
type LabelKey = (typeof LABELS)[number]["key"];

type Params = { tab: Tab; range: Range; before: string | null; nomf: boolean; carrier: CarrierKey | null; label: LabelKey | null };

const chip = "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors";
const chipOn = "bg-ink font-medium text-white";
const chipOff = "bg-canvas-soft-2 text-body hover:bg-muted";

/**
 * ตามของยกเลิก — ออเดอร์ที่ยกเลิกใน BigSeller (ดึงเองทุก 5 นาที · src/lib/cancel-hunt.ts)
 * - แท็บ "ต้องหา" = ของที่แพ็ก/พิมพ์ใบปะหน้าไปแล้ว → เจ้าหน้าที่หาของออกจากกอง/กรง แล้วกด "เจอแล้ว"
 * - ช่วง: วันนี้ (ทุกใบที่ยกเลิก) / ย้อนหลัง N วัน (เฉพาะที่ยกเลิกตอนกำลังดำเนินการ / รอรับสินค้า — ของที่มักค้างในร้าน)
 * - กรอง: สถานะก่อนยกเลิก · ยังไม่ลงใบนำจ่าย (ไม่ได้สแกน = ของน่าจะยังอยู่ในร้าน)
 */
export default async function CancelHuntPage({ searchParams }: PageProps<"/cancel-hunt">) {
  await connection();
  const sp = await searchParams;
  const today = todayKey();
  const N = backDays();
  const tab = (TABS.some((t) => t.key === sp.show) ? sp.show : "find") as Tab;
  // ต้องหา: ค่าเริ่มต้นย้อนหลัง (ของค้างจากวันก่อนต้องยังเห็น) · แท็บอื่น: วันนี้
  const range: Range = sp.range === "today" || sp.range === "back" ? sp.range : tab === "find" ? "back" : "today";
  const before = typeof sp.before === "string" && sp.before ? sp.before : null;
  const nomf = sp.nomf === "1";
  const carrier = ([...CARRIERS.map((c) => c.key), "other"] as string[]).includes(String(sp.carrier)) ? (sp.carrier as CarrierKey) : null;
  const label = LABELS.some((l) => l.key === sp.label) ? (sp.label as LabelKey) : null;
  const cur: Params = { tab, range, before, nomf, carrier, label };

  // วันแรกของช่วงย้อนหลัง (รวมวันนี้ = N วัน) — คิดเป็นวันที่ตามเวลาไทย ไม่ขึ้นกับ timezone ของเซิร์ฟเวอร์
  const sinceKey = new Date(Date.parse(`${today}T12:00:00Z`) - (N - 1) * 86_400_000).toISOString().slice(0, 10);
  const dayWhere: Prisma.CancelHuntWhereInput = range === "today" ? { day: today } : { day: { gte: sinceKey } };
  const todayR = dayRange(today);
  const yesterdayR = { gte: new Date(todayR.gte.getTime() - 86_400_000), lt: todayR.gte };
  const LABEL_WHERE: Record<LabelKey, Prisma.CancelHuntWhereInput> = {
    today: { labelPrintedAt: todayR },
    yesterday: { labelPrintedAt: yesterdayR },
    older: { labelPrintedAt: { lt: yesterdayR.gte } },
    none: { labelPrintedAt: null },
  };
  // ตัวกรองแต่ละตัวแยกไว้ — ชิปของกลุ่มไหนนับโดยไม่รวมตัวกรองของกลุ่มนั้นเอง (เห็นว่าเลือกอันอื่นแล้วได้กี่ใบ)
  const parts = {
    before: before ? { beforeStatus: before } : {},
    nomf: nomf ? { parcelId: null } : {},
    carrier: carrier ? carrierWhere(carrier) : {},
    label: label ? LABEL_WHERE[label] : {},
  } satisfies Record<string, Prisma.CancelHuntWhereInput>;
  const except = (skip: keyof typeof parts): Prisma.CancelHuntWhereInput => ({
    AND: (Object.keys(parts) as (keyof typeof parts)[]).filter((k) => k !== skip).map((k) => parts[k]),
  });
  const filterWhere: Prisma.CancelHuntWhereInput = { AND: Object.values(parts) };
  const base: Prisma.CancelHuntWhereInput = { ...dayWhere, ...WHERE[tab] };

  const [rows, counts, beforeGroups, nomfCount, carrierGroups, labelCounts, run] = await Promise.all([
    db.cancelHunt.findMany({
      where: { AND: [base, filterWhere] },
      // ต้องหา: ยกเลิกล่าสุดอยู่บน · จัดการแล้ว: เพิ่งกดอยู่บน
      orderBy: tab === "done" ? { resolvedAt: "desc" } : { cancelledAt: { sort: "desc", nulls: "last" } },
      take: 500,
    }),
    Promise.all(TABS.map((t) => db.cancelHunt.count({ where: { AND: [dayWhere, WHERE[t.key], filterWhere] } }))),
    // ชิปสถานะก่อนยกเลิก — นับในแท็บ/ช่วงที่เปิดอยู่ (ไม่รวมตัวกรองสถานะเอง)
    db.cancelHunt.groupBy({ by: ["beforeStatus"], where: { AND: [base, except("before")] }, _count: { _all: true } }),
    db.cancelHunt.count({ where: { AND: [base, except("nomf"), { parcelId: null }] } }),
    // ขนส่ง — นับตามชื่อเต็มแล้วรวมเป็นกลุ่มฝั่งนี้
    db.cancelHunt.groupBy({ by: ["carrier"], where: { AND: [base, except("carrier")] }, _count: { _all: true } }),
    Promise.all(LABELS.map((l) => db.cancelHunt.count({ where: { AND: [base, except("label"), LABEL_WHERE[l.key]] } }))),
    lastHuntRun(),
  ]);

  // อยู่ใบนำจ่ายไหน กรงไหน รถคันไหน — เฉพาะชิ้นที่สแกนลงใบแล้ว
  const parcelIds = rows.map((r) => r.parcelId).filter((x): x is string => Boolean(x));
  const parcels = parcelIds.length
    ? await db.manifestParcel.findMany({
        where: { id: { in: parcelIds } },
        select: {
          id: true,
          manifest: {
            select: {
              id: true,
              manifestNo: true,
              pickups: {
                select: {
                  cage: { select: { label: true } },
                  pickup: { select: { id: true, plate: true, status: true, departedAt: true } },
                },
              },
            },
          },
        },
      })
    : [];
  const where = new Map(parcels.map((p) => [p.id, p.manifest]));

  const views: HuntView[] = rows.map((r) => {
    const m = r.parcelId ? where.get(r.parcelId) : undefined;
    const pms = m?.pickups ?? [];
    const gone = pms.find((pm) => pm.pickup.status === "DONE");
    const loading = pms.find((pm) => pm.pickup.status === "DOING");
    const cage = pms.map((pm) => pm.cage?.label).find((l) => l !== undefined);
    return {
      id: r.id,
      packageNo: r.packageNo,
      orderNo: r.orderNo,
      trackingNo: r.trackingNo,
      platform: r.platform,
      shopName: r.shopName,
      carrier: r.carrier,
      // วันก่อน → โชว์วันที่ด้วย
      cancelledAt: r.cancelledAt ? (r.day === today ? fmtTime(r.cancelledAt) : fmtDateTime(r.cancelledAt)) : null,
      cancelReason: r.cancelReason,
      cancelBy: r.cancelBy,
      beforeStatus: r.beforeStatus,
      labelPrintedAt: r.labelPrintedAt ? fmtDateTime(r.labelPrintedAt) : null,
      packedAt: r.packedAt ? fmtDateTime(r.packedAt) : null,
      items: (Array.isArray(r.items) ? r.items : []) as HuntItem[],
      needsFind: r.needsFind,
      status: r.status,
      resolvedAt: r.resolvedAt ? fmtTime(r.resolvedAt) : null,
      resolvedBy: r.resolvedBy,
      note: r.note,
      manifest: m ? { id: m.id, no: m.manifestNo } : null,
      cage: cage === undefined ? null : cageTitle(cage),
      truck: gone
        ? { id: gone.pickup.id, plate: gone.pickup.plate, state: "gone" as const }
        : loading
          ? { id: loading.pickup.id, plate: loading.pickup.plate, state: "loading" as const }
          : null,
    };
  });

  const href = (next: Partial<Params>) => {
    const p = { ...cur, ...next };
    // เปลี่ยนแท็บ → ช่วงกลับเป็นค่าเริ่มต้นของแท็บนั้น (ถ้าไม่ได้ระบุ)
    if (next.tab && !("range" in next)) p.range = next.tab === "find" ? "back" : "today";
    const q = new URLSearchParams();
    if (p.tab !== "find") q.set("show", p.tab);
    if (p.range !== (p.tab === "find" ? "back" : "today")) q.set("range", p.range);
    if (p.before) q.set("before", p.before);
    if (p.nomf) q.set("nomf", "1");
    if (p.carrier) q.set("carrier", p.carrier);
    if (p.label) q.set("label", p.label);
    const s = q.toString();
    return s ? `/cancel-hunt?${s}` : "/cancel-hunt";
  };

  const groups = beforeGroups
    .map((g) => ({ label: g.beforeStatus, n: g._count._all }))
    .filter((g): g is { label: string; n: number } => Boolean(g.label))
    .sort((a, b) => b.n - a.n);

  const carrierCount = new Map<CarrierKey, number>();
  for (const g of carrierGroups) carrierCount.set(carrierOf(g.carrier), (carrierCount.get(carrierOf(g.carrier)) ?? 0) + g._count._all);
  const carrierChips = [...CARRIERS.map((c) => ({ key: c.key as CarrierKey, label: c.label as string })), { key: "other" as CarrierKey, label: "อื่น ๆ / ไม่ระบุ" }]
    .map((c) => ({ ...c, n: carrierCount.get(c.key) ?? 0 }))
    .filter((c) => c.n > 0 || c.key === carrier);

  return (
    <Page>
      <PageHeader
        title="ตามของยกเลิก"
        description={
          <>
            ออเดอร์ที่ยกเลิกใน BigSeller — ของที่แพ็ก/พิมพ์ใบปะหน้าแล้วต้องหาออกจากกองก่อนขึ้นรถ · ย้อนหลัง {N} วันดึงเฉพาะที่ยกเลิกตอนกำลังดำเนินการ / รอรับสินค้า
          </>
        }
      />
      <HuntSyncBar
        isToday
        minutes={huntMinutes()}
        lastAt={run?.finishedAt?.toISOString() ?? null}
        lastOk={run?.ok ?? null}
        lastMessage={run?.message ?? null}
      />

      <ManualReceiveBox />

      <nav aria-label="แท็บ" className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={href({ tab: t.key })}
            aria-current={tab === t.key ? "page" : undefined}
            className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm transition-colors ${
              tab === t.key ? "border-brand bg-brand font-medium text-white" : "bg-card text-body hover:bg-muted"
            }`}
          >
            {t.label}
            <span className={`tabular text-xs ${t.key === "find" && counts[i] && tab !== "find" ? "rounded-full bg-error px-1.5 text-white" : "opacity-80"}`}>
              {counts[i]}
            </span>
          </Link>
        ))}
      </nav>

      {/* ตัวกรอง: ช่วงวัน · ยังไม่ลงใบนำจ่าย · สถานะก่อนยกเลิก */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-mute">ช่วง</span>
          <Link href={href({ range: "today" })} className={`${chip} ${range === "today" ? chipOn : chipOff}`}>
            วันนี้
          </Link>
          <Link href={href({ range: "back" })} className={`${chip} ${range === "back" ? chipOn : chipOff}`}>
            ย้อนหลัง {N} วัน
          </Link>
          <span className="mx-1 h-5 w-px bg-hairline" />
          <Link href={href({ nomf: !nomf })} className={`${chip} ${nomf ? chipOn : chipOff}`}>
            ยังไม่ลงใบนำจ่าย (ไม่ได้สแกน) <span className="tabular text-xs opacity-80">{nomfCount}</span>
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[13px] text-mute">ใบปะหน้า</span>
          <Link href={href({ label: null })} className={`${chip} ${!label ? chipOn : chipOff}`}>
            ทั้งหมด
          </Link>
          {LABELS.map((l, i) => (
            <Link key={l.key} href={href({ label: l.key })} className={`${chip} ${label === l.key ? chipOn : chipOff}`}>
              {l.label} <span className="tabular text-xs opacity-80">{labelCounts[i]}</span>
            </Link>
          ))}
        </div>
        {carrierChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[13px] text-mute">ขนส่ง</span>
            <Link href={href({ carrier: null })} className={`${chip} ${!carrier ? chipOn : chipOff}`}>
              ทั้งหมด
            </Link>
            {carrierChips.map((c) => (
              <Link key={c.key} href={href({ carrier: c.key })} className={`${chip} ${carrier === c.key ? chipOn : chipOff}`}>
                {c.label} <span className="tabular text-xs opacity-80">{c.n}</span>
              </Link>
            ))}
          </div>
        )}
        {groups.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[13px] text-mute">สถานะก่อนยกเลิก</span>
            <Link href={href({ before: null })} className={`${chip} ${!before ? chipOn : chipOff}`}>
              ทั้งหมด
            </Link>
            {groups.map((g) => (
              <Link key={g.label} href={href({ before: g.label })} className={`${chip} ${before === g.label ? chipOn : chipOff}`}>
                {g.label} <span className="tabular text-xs opacity-80">{g.n}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {views.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {views.map((v) => (
            <HuntCard key={v.id} h={v} />
          ))}
        </div>
      ) : (
        <Empty icon={<PackageSearchIcon />}>
          {tab === "find" ? "ไม่มีของยกเลิกที่ต้องหาตามตัวกรองนี้" : tab === "done" ? "ยังไม่มีรายการที่จัดการแล้ว" : "ไม่มีรายการ"}
        </Empty>
      )}
    </Page>
  );
}
