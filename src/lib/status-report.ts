import "server-only";
import { db } from "./db";
import { canCallBigSeller, syncManifestStatuses } from "./bigseller";
import { refreshFlashStatuses } from "./flash";
import { fmtDate, fmtDateTime, toLocalInput } from "./format";
import { appLink, lineConfig, lineConfigured, lineHint, pushFlex } from "./line";
import { dailyTabName, sheetsConfigured, updateStatusCells, type StatusCell } from "./sheets";
import { STATUS_CAT, statusCat, type StatusCat } from "./status-cat";

export { STATUS_CAT, statusCat, type StatusCat };

/**
 * รายงานสถานะพัสดุประจำวัน → LINE (การ์ดสี) + อัปเดตช่องสถานะใน Google Sheets
 *
 * ติดตามเฉพาะชิ้นที่ขึ้นรถไปแล้ว (รอบรถปิดงาน) ภายใน STATUS_TRACK_DAYS วัน และยังไม่จบ
 *   สำเร็จ / ยกเลิก → รายงานครั้งเดียว แล้วเลิกติดตาม (trackingDoneAt)
 *   สถานะไม่ขยับเกิน STATUS_STUCK_DAYS วัน → "ค้าง" รายงานทุกวันจนกว่าจะขยับ
 * เรียกจาก: ตั้งเวลาอัตโนมัติ (instrumentation → /api/line/daily) และปุ่มในหน้า /line
 */

const num = (v: string | undefined, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const reportConfig = () => ({
  trackDays: num(process.env.STATUS_TRACK_DAYS, 14),
  stuckDays: num(process.env.STATUS_STUCK_DAYS, 2),
  /** เวลาส่งรายงานอัตโนมัติ (เวลาไทย HH:MM) · "off" = ปิด */
  dailyAt: (process.env.LINE_DAILY_AT ?? "00:05").trim() || "00:05",
});

const DAY = 86_400_000;
const SHOW = 10; // รายการต่อหัวข้อในการ์ด (การ์ด LINE จำกัดขนาด)

type Row = {
  id: string;
  trackingNo: string;
  orderNo: string | null;
  bsStatusText: string | null;
  cat: StatusCat;
  plate: string | null;
  pickupId: string | null;
  arrivedAt: Date | null;
  departedAt: Date | null;
  sinceDays: number;
};

/** สรุปของรถ 1 คัน (บรรทัด "แยกตามรอบรถ" ในการ์ด) */
type Truck = { key: string; plate: string; departedAt: Date | null; count: Record<StatusCat, number>; total: number };

const emptyCount = () => Object.fromEntries((Object.keys(STATUS_CAT) as StatusCat[]).map((c) => [c, 0])) as Record<StatusCat, number>;

/** จัดกลุ่มตามรอบรถ — คันที่ปิดงานล่าสุดอยู่บน */
function byTruck(rows: Row[]): Truck[] {
  const map = new Map<string, Truck>();
  for (const r of rows) {
    const key = r.pickupId ?? "-";
    const t = map.get(key) ?? { key, plate: r.plate ?? "ไม่ทราบรถ", departedAt: r.departedAt, count: emptyCount(), total: 0 };
    t.count[r.cat]++;
    t.total++;
    map.set(key, t);
  }
  return [...map.values()].sort((a, b) => (b.departedAt?.getTime() ?? 0) - (a.departedAt?.getTime() ?? 0));
}

/** "🔵 20 · 🟡 5 · 🔴 1" — เฉพาะกลุ่มที่มี (จัดส่งแล้ว/รอรับ/ยกเลิก ก่อน) */
const ORDER: StatusCat[] = ["shipped", "waiting", "cancel", "done", "problem", "other"];
const SHORT: Record<StatusCat, string> = { shipped: "ส่งแล้ว", waiting: "รอรับ", cancel: "ยกเลิก", done: "สำเร็จ", problem: "ไม่สำเร็จ", other: "อื่น ๆ" };
const countText = (c: Record<StatusCat, number>) =>
  ORDER.filter((k) => c[k] > 0)
    .map((k) => `${STATUS_CAT[k].emoji}${SHORT[k]} ${c[k]}`)
    .join(" · ") || "—";

export type ReportResult = { ok: boolean; message: string; tracked: number };

/** ชิ้นที่ยังติดตามอยู่: ขึ้นรถที่ปิดงานแล้วภายในกี่วัน และยังไม่จบ */
function trackedWhere(trackDays: number) {
  return {
    trackingDoneAt: null,
    manifest: { pickups: { some: { pickup: { status: "DONE" as const, departedAt: { gte: new Date(Date.now() - trackDays * DAY) } } } } },
  };
}

/**
 * @param trigger auto = ตั้งเวลา · manual = กดรายงานจริง · test = ปุ่มทดสอบ
 *   test: ส่งการ์ดเข้า LINE (หัวการ์ดมี 🧪 ทดสอบ) แต่ไม่เขียน Sheets (แค่นับแถว) และไม่เลิกติดตามชิ้นที่สำเร็จ/ยกเลิก
 *   — กดกี่ครั้งก็ได้ รายงานจริงยังเห็นครบ
 */
export async function runStatusReport({ trigger, by }: { trigger: "auto" | "manual" | "test"; by?: string }): Promise<ReportResult> {
  const cfg = reportConfig();
  const test = trigger === "test";
  const run = await db.syncRun.create({ data: { kind: trigger === "auto" ? "daily-report" : test ? "status-test" : "status-report" } });
  const notes: string[] = [];
  try {
    // 1) ดึงสถานะล่าสุดจาก BigSeller (เฉพาะชิ้นที่ยังติดตาม)
    const manifestIds = [
      ...new Set((await db.manifestParcel.findMany({ where: trackedWhere(cfg.trackDays), select: { manifestId: true } })).map((p) => p.manifestId)),
    ];
    if (manifestIds.length) {
      // สถานะขนส่งจากเว็บ Flash (หลัก) — BigSeller ไว้จับยกเลิก
      const flash = await refreshFlashStatuses({ manifestIds }, { staleMinutes: 30 }).catch((e) => ({ ok: false, message: String(e) }));
      if (!flash.ok) notes.push(`เช็ค Flash ไม่ครบ: ${flash.message.split("\n")[0]}`);
      if (await canCallBigSeller()) {
        const r = await syncManifestStatuses(manifestIds, { notify: false, untrackedOnly: true });
        if (!r.ok) notes.push(`ดึงสถานะไม่ครบ: ${r.message.split("\n")[0]} — ใช้ข้อมูลล่าสุดที่มี`);
      } else notes.push("เชื่อม BigSeller ไม่ได้ — ใช้สถานะล่าสุดที่เคยดึงไว้");
    }

    // 2) อ่านกลับมาจัดกลุ่ม
    const now = Date.now();
    const parcels = await db.manifestParcel.findMany({
      where: trackedWhere(cfg.trackDays),
      orderBy: { trackingNo: "asc" },
      select: {
        id: true,
        trackingNo: true,
        orderNo: true,
        status: true,
        bsState: true,
        bsStatusText: true,
        bsStatusChangedAt: true,
        flashState: true,
        flashStateText: true,
        flashRoutedAt: true,
        createdAt: true,
        manifest: {
          select: {
            pickups: {
              where: { pickup: { status: "DONE" } },
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { pickup: { select: { id: true, plate: true, arrivedAt: true, departedAt: true } } },
            },
          },
        },
      },
    });
    const rows: Row[] = parcels.map((p) => {
      const truck = p.manifest.pickups[0]?.pickup;
      // Flash มีความเคลื่อนไหวล่าสุดเมื่อไหร่ — ไม่มีก็ใช้เวลาสถานะ BigSeller เปลี่ยน
      const since = p.flashRoutedAt ?? p.bsStatusChangedAt ?? truck?.departedAt ?? p.createdAt;
      return {
        id: p.id,
        trackingNo: p.trackingNo,
        orderNo: p.orderNo,
        // ข้อความสถานะที่โชว์ในการ์ด/ชีต — Flash ก่อน
        bsStatusText: p.flashStateText ?? p.bsStatusText,
        cat: statusCat(p),
        plate: truck?.plate ?? null,
        pickupId: truck?.id ?? null,
        arrivedAt: truck?.arrivedAt ?? null,
        departedAt: truck?.departedAt ?? null,
        sinceDays: Math.floor((now - since.getTime()) / DAY),
      };
    });

    const count = Object.fromEntries((Object.keys(STATUS_CAT) as StatusCat[]).map((c) => [c, 0])) as Record<StatusCat, number>;
    for (const r of rows) count[r.cat]++;
    const finished = rows.filter((r) => r.cat === "done" || r.cat === "cancel");
    const stuck = rows
      .filter((r) => r.cat !== "done" && r.cat !== "cancel" && r.sinceDays >= cfg.stuckDays)
      .sort((a, b) => b.sinceDays - a.sinceDays);

    // 3) อัปเดตช่องสถานะใน Sheets (เฉพาะแถวที่เคยส่งไป)
    let sheetNote: string | null = null;
    if (sheetsConfigured()) {
      const cells: StatusCell[] = rows
        .filter((r) => r.arrivedAt)
        .map((r) => ({
          tab: dailyTabName(r.arrivedAt!),
          trackingNo: r.trackingNo,
          value: r.bsStatusText ?? STATUS_CAT[r.cat].label,
          color: STATUS_CAT[r.cat].sheet,
        }));
      try {
        const s = await updateStatusCells(cells, { dryRun: test });
        sheetNote = `Sheets: ${test ? "จะอัปเดต" : "อัปเดต"} ${s.updated} แถว${s.notFound ? ` · ยังไม่อยู่ในชีต ${s.notFound}` : ""}${test ? " (ทดสอบ — ยังไม่เขียน)" : ""}`;
      } catch (e) {
        console.warn("[report] อัปเดต Sheets ไม่สำเร็จ:", e);
        sheetNote = "Sheets: อัปเดตไม่สำเร็จ";
      }
    }

    // 4) ส่ง LINE
    let lineOk = true;
    let lineNote: string | null = null;
    if (lineConfigured()) {
      const { altText, contents, preview } = buildFlex({ rows, count, stuck, finished, stuckDays: cfg.stuckDays, sheetNote, notes, test });
      const r = await pushFlex(altText, contents, preview);
      lineOk = r.ok && !r.error;
      lineNote = lineOk ? "ส่ง LINE แล้ว" : r.error ? lineHint(r.error) : "ส่ง LINE ไม่สำเร็จ";
    }

    // 5) สำเร็จ/ยกเลิก รายงานแล้ว → เลิกติดตาม (ส่ง LINE ไม่ผ่าน = เก็บไว้รายงานรอบหน้า)
    if (finished.length && lineOk && !test) {
      await db.manifestParcel.updateMany({ where: { id: { in: finished.map((r) => r.id) } }, data: { trackingDoneAt: new Date() } });
    }

    const message = [
      `ติดตาม ${rows.length} ชิ้น`,
      (Object.keys(STATUS_CAT) as StatusCat[]).filter((c) => count[c]).map((c) => `${STATUS_CAT[c].label} ${count[c]}`).join(" · "),
      stuck.length && `ค้าง ≥${cfg.stuckDays} วัน ${stuck.length}`,
      lineNote,
      sheetNote,
      ...notes,
    ]
      .filter(Boolean)
      .join(" · ");
    await db.syncRun.update({ where: { id: run.id }, data: { ok: lineOk, finishedAt: new Date(), count: rows.length, message: by ? `${message} (โดย ${by})` : message } });
    return { ok: lineOk, message, tracked: rows.length };
  } catch (e) {
    const message = (e as Error).message?.slice(0, 1000) ?? String(e);
    await db.syncRun.update({ where: { id: run.id }, data: { ok: false, finishedAt: new Date(), errorKind: "report", message } });
    return { ok: false, message: `ทำรายงานไม่สำเร็จ: ${message}`, tracked: 0 };
  }
}

/** เวลาส่งอัตโนมัติ "HH:MM" · null = ปิด ("off" หรือรูปแบบผิด) — ใช้ทั้งตัวตั้งเวลาและหน้า /line */
export function dailyTime(dailyAt = reportConfig().dailyAt) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(dailyAt);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/** ถึงเวลาส่งรายงานอัตโนมัติของวันนี้แล้ว และวันนี้ยังไม่ได้ส่ง */
export async function dailyReportDue(now = new Date()) {
  const at = dailyTime();
  if (!at) return false;
  const local = toLocalInput(now); // YYYY-MM-DDTHH:mm เวลาไทย
  if (local.slice(11) < at) return false;
  const startOfDay = new Date(`${local.slice(0, 10)}T00:00:00+07:00`);
  const runs = await db.syncRun.findMany({
    where: { kind: "daily-report", startedAt: { gte: startOfDay } },
    orderBy: { startedAt: "desc" },
    select: { ok: true, startedAt: true },
  });
  if (runs.some((r) => r.ok)) return false; // วันนี้ส่งแล้ว
  // ส่งไม่ผ่าน → รอ 1 ชม. ค่อยลองใหม่ (ไม่ยิง BigSeller/LINE รัวทุก 5 นาที)
  return !runs[0] || now.getTime() - runs[0].startedAt.getTime() > 3_600_000;
}

// ───────────────────────────────────────────────────────────── การ์ด LINE (Flex)

type FlexBox = Record<string, unknown>;
const text = (t: string, extra: FlexBox = {}): FlexBox => ({ type: "text", text: t || " ", wrap: true, size: "sm", color: "#171717", ...extra });

function catTile(c: StatusCat, n: number): FlexBox {
  const s = STATUS_CAT[c];
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    backgroundColor: s.soft,
    cornerRadius: "md",
    paddingAll: "8px",
    contents: [
      text(String(n), { size: "xl", weight: "bold", color: s.color, align: "center" }),
      text(s.label, { size: "xxs", color: s.color, align: "center" }),
    ],
  };
}

function section(title: string, color: string, lines: FlexBox[], more: number): FlexBox[] {
  if (!lines.length) return [];
  return [
    { type: "separator", margin: "lg" },
    text(title, { weight: "bold", color, margin: "lg" }),
    ...lines,
    ...(more > 0 ? [text(`…และอีก ${more} ชิ้น (ดูทั้งหมดในเว็บ/ชีต)`, { size: "xs", color: "#888888", margin: "sm" })] : []),
  ];
}

function parcelLine(r: Row, right: string, rightColor: string): FlexBox {
  return {
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 5,
        contents: [
          text(r.trackingNo, { size: "xs", weight: "bold" }),
          text([r.plate && `รถ ${r.plate}`, r.orderNo].filter(Boolean).join(" · "), { size: "xxs", color: "#888888" }),
        ],
      },
      text(right, { flex: 3, size: "xxs", color: rightColor, align: "end", gravity: "center" }),
    ],
  };
}

function buildFlex({
  rows,
  count,
  stuck,
  finished,
  stuckDays,
  sheetNote,
  notes,
  test = false,
}: {
  test?: boolean;
  rows: Row[];
  count: Record<StatusCat, number>;
  stuck: Row[];
  finished: Row[];
  stuckDays: number;
  sheetNote: string | null;
  notes: string[];
}) {
  const today = fmtDate(new Date());
  const cancelled = finished.filter((r) => r.cat === "cancel");
  const done = finished.filter((r) => r.cat === "done");
  const main: StatusCat[] = ["waiting", "shipped", "done", "cancel"];
  const extra = (["problem", "other"] as StatusCat[]).filter((c) => count[c]);

  // แยกตามรอบรถ — ตัวเลขด้านบนมาจากรถคันไหนบ้าง
  const trucks = byTruck(rows);
  const TRUCKS = 10;
  const truckLine = (t: Truck): FlexBox => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "box",
        layout: "vertical",
        flex: 4,
        contents: [
          text(t.plate, { size: "xs", weight: "bold" }),
          text(`ปิด ${t.departedAt ? fmtDateTime(t.departedAt) : "—"} · ${t.total} ชิ้น`, { size: "xxs", color: "#888888" }),
        ],
      },
      text(countText(t.count), { flex: 4, size: "xxs", align: "end", gravity: "center" }),
    ],
  });

  const body: FlexBox[] = [
    { type: "box", layout: "horizontal", spacing: "sm", contents: main.map((c) => catTile(c, count[c])) },
    ...(extra.length
      ? [{ type: "box", layout: "horizontal", spacing: "sm", margin: "sm", contents: extra.map((c) => catTile(c, count[c])) }]
      : []),
    ...(trucks.length
      ? [
          { type: "separator", margin: "lg" },
          text(`🚚 แยกตามรอบรถ (${trucks.length} คัน)`, { weight: "bold", margin: "lg" }),
          ...trucks.slice(0, TRUCKS).map(truckLine),
          ...(trucks.length > TRUCKS ? [text(`…และอีก ${trucks.length - TRUCKS} คัน`, { size: "xs", color: "#888888", margin: "sm" })] : []),
        ]
      : []),
    ...section(
      `🔴 ยกเลิก ${cancelled.length} ชิ้น — ต้องตามคืน`,
      STATUS_CAT.cancel.color,
      cancelled.slice(0, SHOW).map((r) => parcelLine(r, r.bsStatusText ?? "ยกเลิก", STATUS_CAT.cancel.color)),
      cancelled.length - SHOW,
    ),
    ...section(
      `⏰ ค้างเกิน ${stuckDays} วัน ${stuck.length} ชิ้น`,
      "#AB570A",
      stuck.slice(0, SHOW).map((r) => parcelLine(r, `${r.bsStatusText ?? STATUS_CAT[r.cat].label} · ${r.sinceDays} วัน`, STATUS_CAT[r.cat].color)),
      stuck.length - SHOW,
    ),
    ...(done.length
      ? [
          { type: "separator", margin: "lg" },
          text(`🟢 สำเร็จ ${done.length} ชิ้น — ${test ? "รายงานจริงจะเลิกติดตามหลังรายงาน" : "รายงานครั้งนี้แล้วเลิกติดตาม"}`, { weight: "bold", color: STATUS_CAT.done.color, margin: "lg" }),
        ]
      : []),
    ...(!rows.length ? [text("ไม่มีพัสดุที่ต้องติดตาม", { color: "#888888", margin: "lg" })] : []),
    ...[sheetNote, ...notes].filter((n): n is string => Boolean(n)).map((n) => text(n, { size: "xxs", color: "#888888", margin: "md" })),
  ];

  const link = appLink(cancelled.length ? "/cancelled" : "/");
  const contents = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#171717",
      paddingAll: "16px",
      contents: [
        text(test ? "🧪 ทดสอบ · รายงานสถานะพัสดุ" : "📦 รายงานสถานะพัสดุ", { color: "#FFFFFF", weight: "bold", size: "md" }),
        text(`${today} · ติดตาม ${rows.length} ชิ้น`, { color: "#A1A1A1", size: "xs" }),
      ],
    },
    body: { type: "box", layout: "vertical", paddingAll: "16px", contents: body },
    ...(link
      ? {
          footer: {
            type: "box",
            layout: "vertical",
            contents: [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "เปิดในเว็บ", uri: link } }],
          },
        }
      : {}),
  };

  // ข้อความที่ขึ้นในแจ้งเตือนมือถือ + ไว้ดูใน log ตอนทดลอง
  const altText = `${test ? "🧪 ทดสอบ · " : ""}📦 สถานะพัสดุ ${today}: ${main.map((c) => `${STATUS_CAT[c].label} ${count[c]}`).join(" · ")}${stuck.length ? ` · ค้าง ${stuck.length}` : ""}`;
  const preview = [
    altText,
    ...(trucks.length
      ? ["", `🚚 แยกตามรอบรถ (${trucks.length} คัน)`, ...trucks.slice(0, TRUCKS).map((t) => `  ${t.plate} ปิด ${t.departedAt ? fmtDateTime(t.departedAt) : "—"} · ${t.total} ชิ้น · ${countText(t.count)}`)]
      : []),
    ...(cancelled.length ? ["", `🔴 ยกเลิก ${cancelled.length}`, ...cancelled.slice(0, SHOW).map((r) => `  ${r.trackingNo} ${r.plate ? `รถ ${r.plate}` : ""}`)] : []),
    ...(stuck.length
      ? ["", `⏰ ค้างเกิน ${stuckDays} วัน ${stuck.length}`, ...stuck.slice(0, SHOW).map((r) => `  ${r.trackingNo} · ${r.bsStatusText ?? STATUS_CAT[r.cat].label} · ${r.sinceDays} วัน`)]
      : []),
    ...(done.length ? ["", `🟢 สำเร็จ ${done.length} (เลิกติดตาม)`] : []),
    ...(sheetNote ? ["", sheetNote] : []),
    ...notes,
    `ส่งเมื่อ ${fmtDateTime(new Date())}`,
  ].join("\n");

  return { altText, contents, preview };
}

/** ยังใช้งานอยู่ไหม — โชว์ในหน้า /line */
export async function reportStatus() {
  const cfg = reportConfig();
  const [tracked, last] = await Promise.all([
    db.manifestParcel.count({ where: trackedWhere(cfg.trackDays) }),
    db.syncRun.findFirst({ where: { kind: { in: ["daily-report", "status-report"] } }, orderBy: { startedAt: "desc" } }),
  ]);
  return { ...cfg, tracked, last, lineReady: lineConfigured(), dryRun: lineConfig().dryRun, sheetsReady: sheetsConfigured() };
}

/**
 * ดึงสถานะ BigSeller ใหม่เฉพาะใบนำจ่ายของรถคันนี้ — ใช้ก่อนสรุปปิดงาน / ปุ่ม "ส่งเข้า LINE"
 * ไม่แจ้งยกเลิกแยก (สรุปของรถคันนี้รวมรายการยกเลิกไว้แล้ว) · เชื่อมไม่ได้ = ใช้สถานะล่าสุดที่เคยดึง
 * @returns หมายเหตุสั้น ๆ ใส่ท้ายข้อความ (null = ดึงสำเร็จ)
 */
export async function refreshPickupStatuses(pickupId: string): Promise<string | null> {
  const pms = await db.pickupManifest.findMany({ where: { pickupId, manifestId: { not: null } }, select: { manifestId: true } });
  const ids = [...new Set(pms.map((pm) => pm.manifestId!))];
  if (!ids.length) return null;
  // สรุปปิดงาน: ถาม Flash อย่างเดียว (ไม่ยิง BigSeller)
  const flash = await refreshFlashStatuses({ manifestIds: ids }, { force: true }).catch((e) => ({ ok: false, message: String(e) }));
  return flash.ok ? null : `เช็ค Flash ไม่ครบ: ${flash.message.split("\n")[0]}`;
}
