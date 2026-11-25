import Link from "next/link";
import { connection } from "next/server";
import { PackageSearchIcon } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime, fmtTime, todayKey } from "@/lib/format";
import { huntMinutes, lastHuntRun, type HuntItem } from "@/lib/cancel-hunt";
import { cageTitle } from "@/lib/cage-name";
import { Empty, Page, PageHeader } from "@/components/kit";
import type { Prisma } from "@/generated/prisma/client";
import { HuntCard, HuntSyncBar, type HuntView } from "./hunt-client";

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
  // กดผลไปแล้ว (เจอ / หาไม่เจอ / ข้าม)
  done: { status: { not: "PENDING" } },
  // ยังไม่จ่าย / ยังไม่หยิบ — ของยังอยู่บนชั้น ไม่ต้องทำอะไร
  rest: { needsFind: false, status: "PENDING" },
};

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * ตามของยกเลิก — ออเดอร์ที่ยกเลิกวันนี้ใน BigSeller (ดึงเองทุก 5 นาที · src/lib/cancel-hunt.ts)
 * แท็บ "ต้องหา" = ของที่พิมพ์ใบปะหน้า/แพ็กไปแล้ว → เจ้าหน้าที่หาของออกจากกอง/กรงก่อนขึ้นรถ แล้วกด "เจอแล้ว"
 */
export default async function CancelHuntPage({ searchParams }: PageProps<"/cancel-hunt">) {
  await connection();
  const sp = await searchParams;
  const today = todayKey();
  const day = isDay(sp.day) ? sp.day : today;
  const tab = (TABS.some((t) => t.key === sp.show) ? sp.show : "find") as Tab;

  const [rows, counts, run] = await Promise.all([
    db.cancelHunt.findMany({
      where: { day, ...WHERE[tab] },
      // ต้องหา: ยกเลิกล่าสุดอยู่บน · จัดการแล้ว: เพิ่งกดอยู่บน
      orderBy: tab === "done" ? { resolvedAt: "desc" } : { cancelledAt: { sort: "desc", nulls: "last" } },
      take: 500,
    }),
    Promise.all(TABS.map((t) => db.cancelHunt.count({ where: { day, ...WHERE[t.key] } }))),
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
      cancelledAt: r.cancelledAt ? fmtTime(r.cancelledAt) : null,
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

  const href = (t: Tab) => {
    const q = new URLSearchParams();
    if (t !== "find") q.set("show", t);
    if (day !== today) q.set("day", day);
    const s = q.toString();
    return s ? `/cancel-hunt?${s}` : "/cancel-hunt";
  };

  return (
    <Page>
      <PageHeader
        title="ตามของยกเลิก"
        description={
          <>
            ออเดอร์ที่ยกเลิก{day === today ? "วันนี้" : ` วันที่ ${day}`} จาก BigSeller — ของที่พิมพ์ใบปะหน้า/แพ็กแล้วต้องหาออกจากกองก่อนขึ้นรถ
          </>
        }
      />
      <HuntSyncBar
        isToday={day === today}
        minutes={huntMinutes()}
        lastAt={run?.finishedAt?.toISOString() ?? null}
        lastOk={run?.ok ?? null}
        lastMessage={run?.message ?? null}
      />

      <nav aria-label="แท็บ" className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t, i) => (
          <Link
            key={t.key}
            href={href(t.key)}
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

      {views.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {views.map((v) => (
            <HuntCard key={v.id} h={v} />
          ))}
        </div>
      ) : (
        <Empty icon={<PackageSearchIcon />}>
          {tab === "find" ? "ไม่มีของยกเลิกที่ต้องหาตอนนี้" : tab === "done" ? "ยังไม่มีรายการที่จัดการแล้ว" : "ไม่มีรายการ"}
        </Empty>
      )}
    </Page>
  );
}
