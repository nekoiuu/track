"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { CheckIcon, KeyboardIcon, Loader2Icon, RefreshCwIcon, SearchXIcon, SkipForwardIcon, TruckIcon, Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { pullCancelsNow, receiveManual, setHuntStatus, type ManualReceive } from "@/app/actions/cancel-hunt";
import type { HuntItem } from "@/lib/cancel-hunt";
import type { CancelHuntStatus } from "@/generated/prisma/enums";
import { Mono, Panel, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";

export type HuntView = {
  id: string;
  packageNo: string | null;
  orderNo: string | null;
  trackingNo: string | null;
  platform: string | null;
  shopName: string | null;
  carrier: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelBy: string | null;
  beforeStatus: string | null;
  labelPrintedAt: string | null;
  packedAt: string | null;
  items: HuntItem[];
  needsFind: boolean;
  status: CancelHuntStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
  manifest: { id: string; no: string } | null;
  cage: string | null;
  truck: { id: string; plate: string; state: "loading" | "gone" } | null;
};

const RESULT: Record<Exclude<CancelHuntStatus, "PENDING">, { label: string; tone: "green" | "red" | "neutral" }> = {
  FOUND: { label: "ได้รับสินค้ากลับมาแล้ว", tone: "green" },
  MISSING: { label: "หาไม่เจอ", tone: "red" },
  SKIPPED: { label: "ไม่ต้องหา", tone: "neutral" },
};

/** สถานะก่อนยกเลิก → ไทย (ที่ไม่รู้จักโชว์ตามเดิม) */
const BEFORE: Record<string, string> = {
  "to ship": "รอส่ง (แพ็กแล้ว)",
  "to pickup": "รอรถรับ",
  new: "ออเดอร์ใหม่",
  unpaid: "ยังไม่จ่าย",
  processing: "กำลังจัดการ",
};
const beforeLabel = (s: string | null) => (s ? (BEFORE[s.toLowerCase()] ?? s) : "—");

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "เมื่อกี้" : m < 60 ? `${m} นาทีที่แล้ว` : `${Math.floor(m / 60)} ชม. ${m % 60} นาทีที่แล้ว`;
};

/**
 * แถบบนสุด: ดึงล่าสุดเมื่อไหร่ + ปุ่มดึงตอนนี้
 * - เปิดหน้าแล้วข้อมูลเก่ากว่ารอบ (เช่น เซิร์ฟเวอร์ไม่มี timer) → ดึงให้เองครั้งเดียว
 * - หน้าเปิดค้างไว้ → refresh ทุก 1 นาที (รายการใหม่จากรอบเบื้องหลังขึ้นเอง)
 */
export function HuntSyncBar({
  isToday,
  minutes,
  lastAt,
  lastOk,
  lastMessage,
}: {
  isToday: boolean;
  minutes: number;
  lastAt: string | null;
  lastOk: boolean | null;
  lastMessage: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [, tick] = useState(0);
  const ran = useRef(false);

  const pull = (manual: boolean) =>
    start(async () => {
      try {
        const r = await pullCancelsNow();
        if (r.ran && r.ok) {
          if (r.newFind) toast.warning(`ยกเลิกใหม่ที่ต้องหาของ ${r.newFind} ใบ`);
          else if (manual) toast.success(r.message);
          router.refresh();
        } else if (manual || (r.ran && !r.ok)) (r.ok ? toast : toast.error)(r.message);
      } catch (e) {
        unstable_rethrow(e);
        if (manual) toast.error("ดึงจาก BigSeller ไม่สำเร็จ — ลองอีกครั้ง");
      }
    });

  useEffect(() => {
    if (!isToday || ran.current) return;
    ran.current = true;
    const stale = !lastAt || Date.now() - new Date(lastAt).getTime() > Math.max(1, minutes) * 60_000;
    if (stale) pull(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
      tick((n) => n + 1);
    }, 60_000);
    return () => clearInterval(id);
  }, [isToday, router]);

  return (
    <Panel className="mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 text-sm">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", lastOk === false ? "bg-error" : pending ? "bg-warning" : "live-dot bg-teal")} />
          <span className="font-medium text-ink">
            {pending ? "กำลังดึงจาก BigSeller…" : lastAt ? `ดึงล่าสุด ${ago(lastAt)}` : "ยังไม่เคยดึง"}
          </span>
          {minutes > 0 && isToday && <span className="text-mute">· ดึงเองทุก {minutes} นาที</span>}
        </div>
        {lastMessage && <div className={cn("mt-0.5 truncate", lastOk === false ? "text-error-deep" : "text-body")}>{lastMessage}</div>}
      </div>
      {isToday && (
        <Button type="button" variant="outline" className="h-11" disabled={pending} onClick={() => pull(true)}>
          {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          ดึงตอนนี้
        </Button>
      )}
    </Panel>
  );
}

/** การ์ด 1 ออเดอร์ — ของอะไร อยู่ไหน + ปุ่มผลการหา */
export function HuntCard({ h }: { h: HuntView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [askNote, setAskNote] = useState(false);
  const [note, setNote] = useState("");

  const act = (status: CancelHuntStatus, text?: string) =>
    start(async () => {
      try {
        const r = await setHuntStatus(h.id, status, text);
        if (r.error) toast.error(r.error);
        else {
          toast.success(r.ok);
          setAskNote(false);
          router.refresh();
        }
      } catch (e) {
        unstable_rethrow(e);
        toast.error("บันทึกไม่สำเร็จ — ลองอีกครั้ง");
      }
    });

  const ref = h.trackingNo ?? h.packageNo ?? h.orderNo ?? "—";
  const done = h.status !== "PENDING";

  return (
    <Panel className={cn("flex flex-col gap-3 p-4", pending && "opacity-60")}>
      {/* หัว: เลขที่ใช้หา (ใหญ่) + ร้าน */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Mono className="text-base font-semibold break-all text-ink lg:text-lg">{ref}</Mono>
          <div className="mt-0.5 text-[13px] text-mute">
            {[h.shopName, h.platform, h.packageNo !== ref && h.packageNo, h.orderNo !== ref && h.orderNo].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {done ? (
            <Pill tone={RESULT[h.status as Exclude<CancelHuntStatus, "PENDING">].tone}>
              {RESULT[h.status as Exclude<CancelHuntStatus, "PENDING">].label}
            </Pill>
          ) : h.needsFind ? (
            <Pill tone="red">ต้องหา</Pill>
          ) : null}
          <Pill tone="amber">{beforeLabel(h.beforeStatus)}</Pill>
        </div>
      </div>

      {/* สินค้าในกล่อง */}
      {h.items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {h.items.map((it, i) => (
            <li key={i} className="flex items-center gap-3">
              {it.img ? (
                // รูปจาก BigSeller (โดเมนภายนอก)
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.img} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg bg-canvas-soft-2 object-cover ring-1 ring-hairline" />
              ) : (
                <div className="size-14 shrink-0 rounded-lg bg-canvas-soft-2 ring-1 ring-hairline" />
              )}
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-sm text-ink">{it.sku || it.name}</div>
                {it.name && it.sku && <div className="truncate text-xs text-mute">{it.name}</div>}
              </div>
              <span className="tabular shrink-0 text-base font-semibold text-ink">×{it.qty}</span>
            </li>
          ))}
        </ul>
      )}

      {/* อยู่ไหน */}
      <div className="rounded-lg bg-canvas-soft px-3 py-2 text-sm">
        {h.truck?.state === "gone" ? (
          <div className="flex items-start gap-2 text-error-deep">
            <TruckIcon className="mt-0.5 size-4 shrink-0" />
            <span>
              ขึ้นรถ <b>{h.truck.plate}</b> ไปแล้ว{h.cage && ` (${h.cage})`} — ตามคืนที่หน้า{" "}
              <Link href="/cancelled" className="underline">
                ยกเลิก / ตีกลับ
              </Link>
            </span>
          </div>
        ) : h.manifest ? (
          <div className="text-body">
            อยู่ในใบ{" "}
            <Link href={`/manifests/${h.manifest.id}`} className="font-mono text-ink underline">
              {h.manifest.no}
            </Link>
            {h.cage && (
              <>
                {" "}
                · <b className="text-ink">{h.cage}</b>
              </>
            )}
            {h.truck?.state === "loading" && (
              <>
                {" "}
                · <b className="text-warning-deep">รถ {h.truck.plate} กำลังรับของ</b>
              </>
            )}
          </div>
        ) : (
          <div className="text-body">ยังไม่ลงใบนำจ่าย — น่าจะอยู่โต๊ะแพ็ก / กองรอสแกน</div>
        )}
        <div className="mt-1 text-xs text-mute">
          {[
            h.labelPrintedAt && `พิมพ์ใบปะหน้า ${h.labelPrintedAt}`,
            h.packedAt && `แพ็ก ${h.packedAt}`,
            h.carrier,
          ]
            .filter(Boolean)
            .join(" · ") || "ยังไม่พิมพ์ใบปะหน้า"}
        </div>
      </div>

      <div className="text-xs text-mute">
        ยกเลิก {h.cancelledAt ?? "—"}
        {h.cancelBy && ` โดย ${h.cancelBy}`}
        {h.cancelReason && ` · ${h.cancelReason}`}
      </div>

      {done && (
        <div className="text-xs text-body">
          {h.resolvedBy ?? "—"} กดเมื่อ {h.resolvedAt ?? "—"}
          {h.note && <span className="text-ink"> · {h.note}</span>}
        </div>
      )}

      {/* ปุ่ม */}
      {askNote ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act("MISSING", note);
          }}
        >
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="หาที่ไหนแล้วบ้าง (ไม่บังคับ)"
            className="h-11 rounded-lg border bg-card px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" variant="destructive" className="h-11 flex-1" disabled={pending}>
              <SearchXIcon /> ยืนยันหาไม่เจอ
            </Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => setAskNote(false)}>
              ยกเลิก
            </Button>
          </div>
        </form>
      ) : done ? (
        <Button type="button" variant="ghost" className="h-10 self-start text-body" disabled={pending} onClick={() => act("PENDING")}>
          <Undo2Icon /> ย้อนกลับเป็นยังไม่หา
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" className="h-12 flex-1 bg-teal text-base text-white hover:bg-teal-deep" disabled={pending} onClick={() => act("FOUND")}>
            {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} เจอแล้ว
          </Button>
          <Button type="button" variant="outline" className="h-12" disabled={pending} onClick={() => setAskNote(true)}>
            <SearchXIcon /> หาไม่เจอ
          </Button>
          {!h.needsFind && (
            <Button type="button" variant="ghost" className="h-12 text-body" disabled={pending} onClick={() => act("SKIPPED")}>
              <SkipForwardIcon /> ไม่ต้องหา
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * ใส่เลขแทร็คเอง — รูปใบปะหน้าในกลุ่ม LINE ที่บอทอ่าน QR ไม่ได้ (ไม่ชัด) หรือส่งตอนบอทไม่ได้เปิด
 * พิมพ์ได้หลายเลข · เลขท้าย 4 ตัวขึ้นไปก็ได้ (ตรงใบเดียวในของยกเลิกที่ยังไม่ได้คืน)
 */
export function ManualReceiveBox() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [res, setRes] = useState<ManualReceive | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      try {
        const r = await receiveManual(text);
        setRes(r);
        if (r.error) return void toast.error(r.error);
        if (r.matched.length) {
          toast.success(`ได้รับสินค้ากลับมาแล้ว ${r.matched.length} ชิ้น`);
          setText("");
          router.refresh();
        } else toast("ไม่มีเลขที่ตรงกับของยกเลิกที่ยังไม่ได้คืน");
      } catch (e) {
        unstable_rethrow(e);
        toast.error("บันทึกไม่สำเร็จ — ลองอีกครั้ง");
      }
    });

  if (!open)
    return (
      <Button type="button" variant="outline" className="mb-4 h-11" onClick={() => setOpen(true)}>
        <KeyboardIcon /> ใส่เลขแทร็คเอง (รูปอ่านไม่ได้ / บอทไม่ได้เปิด)
      </Button>
    );

  return (
    <Panel className="mb-4 flex flex-col gap-3 p-4">
      <div>
        <div className="font-medium text-ink">ใส่เลขแทร็คของที่ได้คืนแล้ว</div>
        <div className="text-sm text-body">
          สำหรับรูปในกลุ่ม LINE ที่บอทอ่าน QR ไม่ได้ หรือส่งตอนบอทไม่ได้เปิด — ใส่ได้หลายเลข (บรรทัดละเลข) · พิมพ์แค่เลขท้าย 4 ตัวขึ้นไปก็ได้
        </div>
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={"THT47135HVJ2B4Z\nHVJ2B4Z"}
        className="rounded-lg border bg-card px-3 py-2 font-mono text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-11 bg-teal text-white hover:bg-teal-deep" disabled={pending || !text.trim()} onClick={submit}>
          {pending ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} บันทึกว่าได้รับสินค้ากลับมาแล้ว
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => (setOpen(false), setRes(null))}>
          ปิด
        </Button>
      </div>
      {res && !res.error && (
        <ul className="flex flex-col gap-1 text-sm">
          {res.matched.map((m) => (
            <li key={m.trackingNo} className="text-teal-deep">
              ✅ <Mono>{m.trackingNo}</Mono> {m.items && `— ${m.items}`}
            </li>
          ))}
          {res.already.map((t) => (
            <li key={t} className="text-body">
              • <Mono>{t}</Mono> บันทึกไว้แล้วก่อนหน้า
            </li>
          ))}
          {res.ambiguous.map((a) => (
            <li key={a.tail} className="text-warning-deep">
              ⚠️ <Mono>{a.tail}</Mono> ตรงหลายใบ ({a.hits.join(", ")}) — พิมพ์ให้ยาวขึ้น
            </li>
          ))}
          {res.unknown.map((t) => (
            <li key={t} className="text-mute">
              ✕ <Mono>{t}</Mono> ไม่ใช่ของยกเลิกที่รอคืน (ใน 14 วัน)
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
