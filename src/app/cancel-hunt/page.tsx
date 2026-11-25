import Link from "next/link";
import { connection } from "next/server";
import { PackageSearchIcon } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime, fmtTime, todayKey } from "@/lib/format";
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
type Params = { tab: Tab; range: Range; before: string | null; nomf: boolean };

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
  const cur: Params = { tab, range, before, nomf };

  // วันแรกของช่วงย้อนหลัง (รวมวันนี้ = N วัน) — คิดเป็นวันที่ตามเวลาไทย ไม่ขึ้นกับ timezone ของเซิร์ฟเวอร์
  const sinceKey = new Date(Date.parse(`${today}T12:00:00Z`) - (N - 1) * 86_400_000).toISOString().slice(0, 10);
  const dayWhere: Prisma.CancelHuntWhereInput = range === "today" ? { day: today } : { day: { gte: sinceKey } };
  const filterWhere: Prisma.CancelHuntWhereInput = { ...(before ? { beforeStatus: before } : {}), ...(nomf ? { parcelId: null } : {}) };

  const [rows, counts, beforeGroups, nomfCount, run] = await Promise.all([
    db.cancelHunt.findMany({
      where: { ...dayWhere, ...WHERE[tab], ...filterWhere },
      // ต้องหา: ยกเลิกล่าสุดอยู่บน · จัดการแล้ว: เพิ่งกดอยู่บน
      orderBy: tab === "done" ? { resolvedAt: "desc" } : { cancelledAt: { sort: "desc", nulls: "last" } },
      take: 500,
    }),
    Promise.all(TABS.map((t) => db.cancelHunt.count({ where: { ...dayWhere, ...WHERE[t.key], ...filterWhere } }))),
    // ชิปสถานะก่อนยกเลิก — นับในแท็บ/ช่วงที่เปิดอยู่ (ก่อนกรองสถานะ)
    db.cancelHunt.groupBy({
      by: ["beforeStatus"],
      where: { ...dayWhere, ...WHERE[tab], ...(nomf ? { parcelId: null } : {}) },
      _count: { _all: true },
    }),
    db.cancelHunt.count({ where: { ...dayWhere, ...WHERE[tab], ...(before ? { beforeStatus: before } : {}), parcelId: null } }),
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
    const s = q.toString();
    return s ? `/cancel-hunt?${s}` : "/cancel-hunt";
  };

  const groups = beforeGroups
    .map((g) => ({ label: g.beforeStatus, n: g._count._all }))
    .filter((g): g is { label: string; n: number } => Boolean(g.label))
    .sort((a, b) => b.n - a.n);

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
