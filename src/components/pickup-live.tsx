"use client";

import Link from "next/link";
import { type ReactNode, useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightLeftIcon, BanIcon, CheckCircle2Icon, EllipsisIcon, HashIcon, LockIcon, LockOpenIcon, Loader2Icon, MessageSquareTextIcon, MinusIcon, PencilIcon, PlusIcon, RotateCcwIcon, SplitIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  addPickupManifest,
  closeCage,
  closePickup,
  movePickupManifestCage,
  pollPickupCancels,
  renamePickupCage,
  setPickupCageDone,
  reopenCage,
  setCageShare,
  removePickupManifest,
  replacePickupManifest,
  reopenPickup,
  savePickupManifestNote,
  savePickupDetails,
  setPickupManifestCount,
  type FormState,
} from "@/app/actions/pickups";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./kit";
import { LiveTimer, useActionToast } from "./motion";

export type ManifestChip = {
  id: string;
  code: string;
  manifestId: string | null;
  manifestNo: string | null;
  parcels: number;
  /** จำนวนกล่องตาม BigSeller */
  expected?: number | null;
  /** ทะเบียนรถคันอื่นที่จดใบนี้ด้วย */
  alsoOn?: string[];
  /** ใบแบ่งหลายคัน: จำนวนที่คันนี้รับ (null = ทั้งใบ) */
  taken?: number | null;
  /** คันอื่นที่รับใบนี้ + จำนวน (null = ไม่ได้ใส่ ถือว่าทั้งใบ) */
  others?: { plate: string; count: number | null; doing?: boolean }[];
  /** ใครจด (จาก login) */
  addedBy?: string | null;
  /** เวลาที่กดเพิ่ม (จัดรูปแบบแล้ว เช่น 14:32) */
  addedAt?: string;
  /** หมายเหตุ เช่น ของที่รถรับไปไม่ตรงกับใบ */
  note?: string | null;
  pending?: boolean;
  /** อยู่ในกรงไหน (null = ใบเก่าที่แบ่งรายใบ) */
  cageId?: string | null;
};

/** กรงที่รถคันนี้อยู่ด้วย — share/count ของคันนี้ (ไม่ใส่ทั้งคู่ = ที่เหลือ / ทั้งกรงถ้าอยู่คันเดียว) */
export type CageInfo = {
  id: string;
  label: string;
  /** กรงที่กำลังยิงลงอยู่ (ใบถัดไปลงกรงนี้) */
  open: boolean;
  /** เริ่มกรงนี้ในรถคันนี้ */
  mine: boolean;
  share: number | null;
  count: number | null;
  others: { plate: string; share: number | null; count: number | null; doing?: boolean }[];
  /** ออเดอร์ที่ยกเลิกในกรงนี้ — ต้องหยิบออกก่อนขึ้นรถ */
  cancelled?: { trackingNo: string; orderNo: string | null }[];
  /** กด "ขนหมดแล้ว" — ใบในกรงนี้จดเข้ารถคันอื่นอีกไม่ได้ · at = เวลา (จัดรูปแบบแล้ว) */
  done?: { by: string | null; at: string } | null;
};

/** เช็คยกเลิกทุกเท่านี้ (server ล็อกรอบไว้ — หลายเครื่องเปิดพร้อมกันก็ยิง BigSeller แค่ 1 รอบ) */
const CANCEL_POLL_MS = 30_000;

/**
 * งานที่กำลังทำ: เช็คออเดอร์ยกเลิกเงียบ ๆ ทุก 30 วิ ตอนหน้านี้เปิดอยู่บนจอ
 * ไม่มี spinner ไม่มี toast ตอนปกติ · โหลดหน้าใหม่เฉพาะตอนจำนวนยกเลิกเปลี่ยน
 */
function useCancelWatch(pickupId: string, enabled: boolean, count: number) {
  const router = useRouter();
  const known = useRef(count);
  // หน้าโหลดใหม่แล้ว (นับจาก server) → ใช้ค่านั้นเป็นฐาน
  useEffect(() => {
    known.current = count;
  }, [count]);
  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await pollPickupCancels(pickupId);
        if (res.cancelled !== known.current) {
          if (res.cancelled > known.current) toast.warning(`มีออเดอร์ยกเลิกเพิ่ม ${res.cancelled - known.current} ชิ้น — ดูที่กรง แล้วหยิบออก`, { duration: 15_000 });
          known.current = res.cancelled;
          router.refresh();
        }
      } catch {
        // เน็ตหลุด / หมดเวลา → รอรอบหน้า ไม่กวนคนจด
      } finally {
        busy = false;
      }
    };
    const first = setTimeout(tick, 3_000);
    const timer = setInterval(tick, CANCEL_POLL_MS);
    // กลับมาที่หน้านี้ (สลับแอป/เปิดจอ) → เช็คเลย ไม่ต้องรอครบรอบ
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pickupId, enabled, router]);
}

/** ช่องจด manifest — เพิ่มแล้วโผล่ทันที (optimistic) แล้วระบบไปดึงจาก BigSeller ว่ามีพัสดุอะไร */
export function ManifestScanner({
  pickupId,
  items,
  editable,
  prefix,
  cages = [],
  cancelledCount = 0,
}: {
  pickupId: string;
  items: ManifestChip[];
  editable: boolean;
  prefix?: string;
  cages?: CageInfo[];
  /** ชิ้นที่ยกเลิกทั้งงานตอนโหลดหน้า — ใช้เทียบว่ามียกเลิกใหม่ไหม */
  cancelledCount?: number;
}) {
  useCancelWatch(pickupId, editable, cancelledCount);
  const [draft, setDraft] = useState("");
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [optimistic, apply] = useOptimistic(
    items,
    (list, op: { type: "add"; chip: ManifestChip } | { type: "remove"; id: string }) =>
      op.type === "add" ? [...list, op.chip] : list.filter((c) => c.id !== op.id),
  );

  const add = () => {
    const codes = draft
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .filter((c) => !optimistic.some((x) => x.code === c));
    setDraft("");
    inputRef.current?.focus();
    for (const code of codes) {
      startTransition(async () => {
        apply({ type: "add", chip: { id: `tmp-${code}`, code, manifestId: null, manifestNo: null, parcels: 0, pending: true } });
        const res = await addPickupManifest(pickupId, code);
        if (res.error) toast.error(res.error);
        else toast.success(res.ok);
        if ("warn" in res && res.warn) toast.warning(res.warn, { duration: 12_000 });
      });
    }
  };

  const remove = (chip: ManifestChip) =>
    startTransition(async () => {
      apply({ type: "remove", id: chip.id });
      await removePickupManifest(chip.id);
      toast(`ลบ ${chip.code} แล้ว`);
    });

  // จัดกลุ่มตามกรง — ใบที่กำลังค้นหา (ยังไม่มี cageId) ไปอยู่กรงที่เปิดอยู่ · ไม่มีกรงเปิด = กรงใหม่ชั่วคราว
  const openCage = cages.find((c) => c.open);
  const cageIds = new Set(cages.map((c) => c.id));
  const groups: { cage: CageInfo | null; chips: ManifestChip[] }[] = cages.map((cage) => ({
    cage,
    chips: optimistic.filter((c) => c.cageId === cage.id || (c.pending && cage === openCage)),
  }));
  const loose = optimistic.filter((c) => !c.pending && (!c.cageId || !cageIds.has(c.cageId)));
  const waiting = openCage ? [] : optimistic.filter((c) => c.pending);
  if (waiting.length)
    groups.push({ cage: { id: "new", label: "…", open: true, mine: true, share: null, count: null, others: [] }, chips: waiting });
  if (loose.length) groups.unshift({ cage: null, chips: loose });

  return (
    <div className="grid gap-4">
      {editable && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            {/* มี prefix → โชว์เลขต้นไว้ในช่อง พิมพ์แค่ 4 หลักท้าย */}
            {prefix ? (
              <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-mono text-sm text-mute">{prefix}</span>
            ) : (
              <HashIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-mute" />
            )}
            <Input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              autoFocus
              autoComplete="off"
              inputMode={prefix ? "numeric" : "text"}
              aria-label="เลข manifest 4 หลักท้าย"
              placeholder={prefix ? "____" : "เลข manifest 4 หลักท้าย แล้ว Enter"}
              style={prefix ? { paddingLeft: `calc(1rem + ${prefix.length + 0.6}ch)` } : undefined}
              className={cn(
                "h-12 rounded-xl border-[1.5px] border-brand/50 bg-card font-mono focus-visible:border-brand",
                prefix ? "text-xl font-semibold tracking-[0.18em]" : "pl-11 text-base",
              )}
            />
          </div>
          <Button type="button" className="h-12 rounded-xl px-5 text-[15px]" onClick={add} disabled={!draft.trim()}>
            เพิ่ม
          </Button>
        </div>
      )}

      {optimistic.length === 0 ? (
        <p className="rounded-2xl border border-dashed bg-card/60 px-4 py-8 text-center text-sm text-mute">
          ยังไม่ได้จด manifest — พิมพ์ 4 หลักท้ายแล้วกด Enter
          <span className="mt-1 block text-xs">ใบที่ยิงต่อกันจะรวมเป็น “กรง” ให้เอง · กรงเต็มกด “ปิดกรง” แล้วยิงกรงถัดไป</span>
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) =>
            g.cage ? (
              <CageCard key={g.cage.id} pickupId={pickupId} cage={g.cage} chips={g.chips} editable={editable}>
                <ChipList chips={g.chips} editable={editable} onRemove={remove} inCage cages={cages} />
              </CageCard>
            ) : (
              g.chips.length > 0 && (
                <div key="loose" className="grid gap-2">
                  {cages.length > 0 && <p className="px-1 text-xs font-medium text-mute">ไม่ได้อยู่ในกรง (จดก่อนมีระบบกรง)</p>}
                  <ChipList chips={g.chips} editable={editable} onRemove={remove} />
                </div>
              )
            ),
          )}
          {editable && !openCage && cages.length > 0 && (
            <p className="rounded-xl border border-dashed px-4 py-3 text-center text-sm text-mute">ใบถัดไปที่ยิงจะขึ้นกรงใหม่</p>
          )}
        </div>
      )}
    </div>
  );
}

function ChipList({
  chips,
  editable,
  onRemove,
  inCage,
  cages,
}: {
  chips: ManifestChip[];
  editable: boolean;
  onRemove: (c: ManifestChip) => void;
  inCage?: boolean;
  cages?: CageInfo[];
}) {
  return (
    <ul className="grid grid-cols-1 items-start gap-1.5 sm:grid-cols-2 [&>*]:min-w-0">
      <AnimatePresence initial={false}>
        {chips.map((c) => (
          <ManifestChipItem key={c.code} chip={c} editable={editable} onRemove={() => onRemove(c)} inCage={inCage} cages={cages} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

const FRACTIONS: { label: string; value: number }[] = [
  { label: "¾", value: 0.75 },
  { label: "½", value: 0.5 },
  { label: "¼", value: 0.25 },
];

const shareText = (s: { share: number | null; count: number | null }, alone: boolean) =>
  s.count != null
    ? `${s.count} ชิ้น`
    : s.share == null
      ? alone
        ? "ทั้งกรง"
        : "ที่เหลือ"
      : s.share >= 0.999
        ? "ทั้งกรง"
        : (FRACTIONS.find((f) => Math.abs(f.value - s.share!) < 0.01)?.label ?? `${Math.round(s.share * 100)}%`) + " กรง";

/**
 * การ์ดกรง — หัวการ์ดบอกว่าคันนี้เอาไปเท่าไหร่ กดปุ่มใหญ่เลือกได้เลย (ทั้งกรง / ¾ / ½ / ¼ / นับได้ / ที่เหลือ)
 * ระบบกระจายจำนวนลงแต่ละใบให้เอง ตามขนาดของใบ
 */
/** แสดงก่อน 3 เลข ที่เหลือกดดู — กรงใหญ่ยกเลิกหลายชิ้นจะได้ไม่ดันการ์ดยาว */
const CANCELLED_PREVIEW = 3;

/** ออเดอร์ที่ยกเลิกในกรง — เลขแทร็คตัวใหญ่ ให้หาบนกล่องแล้วหยิบออก */
function CancelledInCage({ items }: { items: { trackingNo: string; orderNo: string | null }[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, CANCELLED_PREVIEW);
  return (
    <div role="alert" className="mb-2.5 rounded-xl border border-error/40 bg-error-soft/40 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-error-deep">
        <BanIcon className="size-4 shrink-0" />
        ยกเลิก {items.length} ชิ้น — หยิบออกจากกรงนี้
      </p>
      <ul className="mt-1.5 grid gap-1">
        {shown.map((p) => (
          <li key={p.trackingNo} className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-base font-semibold tracking-tight text-ink">{p.trackingNo}</span>
            {p.orderNo && <span className="truncate font-mono text-xs text-mute">#{p.orderNo}</span>}
          </li>
        ))}
      </ul>
      {items.length > CANCELLED_PREVIEW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 h-8 text-xs font-medium text-error-deep hover:underline">
          {all ? "ย่อ" : `ดูอีก ${items.length - CANCELLED_PREVIEW} ชิ้น`}
        </button>
      )}
    </div>
  );
}

function CageCard({
  pickupId,
  cage,
  chips,
  editable,
  children,
}: {
  pickupId: string;
  cage: CageInfo;
  chips: ManifestChip[];
  editable: boolean;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [counting, setCounting] = useState(false);
  const [countDraft, setCountDraft] = useState("");
  const [showSplit, setShowSplit] = useState(false);
  // ตั้งชื่อกรงเอง (เช่น ตามเลขบนกรงจริง)
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const saveName = () => {
    if (!nameDraft.trim() || nameDraft.trim().toUpperCase() === cage.label) return setRenaming(false);
    run(() => renamePickupCage(pickupId, cage.id, nameDraft));
    setRenaming(false);
  };
  // กดแล้วเปลี่ยนทันที ไม่ต้องรอหน้า refresh
  // จำค่าเดิมจาก server ไว้ด้วย — server ส่งค่าใหม่มาแล้วใช้ของจริงแทน
  const base = `${cage.share}|${cage.count}`;
  const [mineNow, setMineNow] = useState<{ share: number | null; count: number | null; base: string } | null>(null);
  const me = mineNow && mineNow.base === base ? mineNow : { share: cage.share, count: cage.count };
  const alone = cage.others.length === 0;
  const real = chips.filter((c) => !c.pending);
  const total = real.reduce((n, c) => n + c.parcels, 0);
  const taken = real.reduce((n, c) => n + (c.taken ?? c.parcels), 0);
  const canSplit = editable || !alone;

  const pick = (p: { fraction?: number; count?: number }) => {
    const next = { share: p.count != null ? null : (p.fraction ?? null), count: p.count ?? null, base };
    setMineNow(next);
    setCounting(false);
    start(async () => {
      const res = await setCageShare(pickupId, cage.id, p);
      if (res.error) {
        toast.error(res.error);
        setMineNow(null);
        return;
      }
      toast.success(res.ok);
      if (res.warn) toast.warning(res.warn);
    });
  };
  const run = (fn: () => Promise<{ ok?: string; error?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else if (res.ok) toast.success(res.ok);
    });

  const isWhole = me.count == null && (me.share == null ? alone : me.share >= 0.999);
  const isRest = !alone && me.count == null && me.share == null;
  const btn = (on: boolean) =>
    cn(
      "h-11 min-w-0 rounded-lg border px-2 text-[15px] font-semibold transition-colors active:scale-[0.98] disabled:opacity-60",
      on ? "border-brand bg-brand text-white" : "border-hairline bg-card text-ink hover:border-brand/50",
    );

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-2.5 sm:p-3",
        cage.open && editable ? "border-brand/40" : alone ? "border-hairline" : "border-warning/50 bg-warning-soft/20",
      )}
    >
      <header className="mb-2 flex items-center gap-2.5">
        <button
          type="button"
          disabled={!editable || cage.id === "new"}
          onClick={() => {
            setNameDraft(cage.label);
            setRenaming((v) => !v);
          }}
          aria-label={`เปลี่ยนชื่อกรง ${cage.label}`}
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg text-base font-bold disabled:cursor-default",
            cage.label.length > 2 && "text-xs",
            cage.open && editable ? "bg-brand text-white" : "bg-ink/80 text-white",
          )}
        >
          {cage.label}
        </button>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-semibold">
            กรง {cage.label}
            {cage.open && editable && (
              <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand-deep">กำลังยิงลงกรงนี้</span>
            )}
            {pending && <Loader2Icon className="size-4 animate-spin text-mute" />}
          </p>
          <p className="text-xs text-mute">
            {real.length} ใบ · {total} ชิ้น
            {!alone || !isWhole ? (
              <span className="font-medium text-ink"> · คันนี้ ~{taken} ชิ้น ({shareText(me, alone)})</span>
            ) : null}
          </p>
          {!alone && (
            <p className="mt-0.5 text-sm font-medium text-warning-deep">
              แบ่งกับ {cage.others.map((o) => `${o.plate} (${shareText(o, false)})`).join(", ")}
            </p>
          )}
        </div>
      </header>

      {cage.cancelled && cage.cancelled.length > 0 && <CancelledInCage items={cage.cancelled} />}

      {renaming && (
        <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveName();
              } else if (e.key === "Escape") setRenaming(false);
            }}
            autoFocus
            maxLength={12}
            autoCapitalize="characters"
            placeholder="ชื่อกรง เช่น 1, A, กรงแดง"
            className="h-12 text-base"
          />
          <Button type="button" className="h-12 px-5" disabled={pending || !nameDraft.trim()} onClick={saveName}>
            ตั้งชื่อ
          </Button>
        </div>
      )}

      {/* กรงที่คันนี้เอาไปทั้งกรง (ปกติ) — ซ่อนปุ่มแบ่งไว้ แตะลิงก์เล็กเพื่อเปิด · กรงที่แบ่งกับคันอื่นเปิดให้เห็นเลย */}
      {canSplit && real.length > 0 && alone && isWhole && !showSplit && editable && (
        <button type="button" onClick={() => setShowSplit(true)} className="mb-1 flex h-9 items-center gap-1 px-1 text-xs text-mute hover:text-ink">
          <SplitIcon className="size-3.5" /> รถคันนี้ไม่ได้เอาไปทั้งกรง? แบ่งกรง
        </button>
      )}
      {canSplit && real.length > 0 && (!alone || !isWhole || showSplit) && (
        <div className="mb-3 grid animate-in gap-2 duration-150 fade-in slide-in-from-top-1">
          <p className="px-1 text-xs text-mute">คันนี้เอาไปจากกรงนี้เท่าไหร่ (กะคร่าว ๆ ได้)</p>
          <div className={cn("grid gap-2", alone ? "grid-cols-5" : "grid-cols-3 sm:grid-cols-6")}>
            <button type="button" disabled={pending} className={btn(isWhole)} onClick={() => pick(alone ? {} : { fraction: 1 })}>
              ทั้งกรง
            </button>
            {FRACTIONS.map((f) => (
              <button
                key={f.label}
                type="button"
                disabled={pending}
                className={btn(me.count == null && me.share != null && Math.abs(me.share - f.value) < 0.01)}
                onClick={() => pick({ fraction: f.value })}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              disabled={pending}
              className={btn(me.count != null || counting)}
              onClick={() => {
                setCountDraft(me.count != null ? String(me.count) : "");
                setCounting((v) => !v);
              }}
            >
              {me.count != null && !counting ? me.count : "นับ"}
            </button>
            {!alone && (
              <button type="button" disabled={pending} className={btn(isRest)} onClick={() => pick({})}>
                ที่เหลือ
              </button>
            )}
          </div>
          {counting && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Input
                value={countDraft}
                onChange={(e) => setCountDraft(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && countDraft) {
                    e.preventDefault();
                    pick({ count: Number(countDraft) });
                  }
                }}
                autoFocus
                inputMode="numeric"
                placeholder={`นับได้กี่ชิ้น (ทั้งกรง ${total})`}
                className="h-12 text-base"
              />
              <Button type="button" className="h-12 px-5" disabled={!countDraft || pending} onClick={() => pick({ count: Number(countDraft) })}>
                ตกลง
              </Button>
            </div>
          )}
        </div>
      )}

      {children}

      {editable && cage.mine && (
        <div className="mt-2">
          {cage.open ? (
            <Button type="button" variant="secondary" className="h-11 w-full rounded-lg text-sm" disabled={pending || real.length === 0} onClick={() => run(() => closeCage(pickupId))}>
              <LockIcon className="size-4" /> กรง {cage.label} เต็ม · เริ่มกรงใหม่
            </Button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenCage(pickupId, cage.id))}
              className="flex h-10 items-center gap-1.5 px-1 text-sm text-mute hover:text-ink"
            >
              <LockOpenIcon className="size-4" /> ยิงต่อลงกรงนี้
            </button>
          )}
        </div>
      )}

      {/* ขนหมดแล้ว — ปิดทางจดใบในกรงนี้ซ้ำเข้ารถคันอื่น (กรงที่แบ่งกับคันอื่นด้วย ทุกคันที่อยู่ในกรงกดได้) */}
      {editable && cage.id !== "new" && real.length > 0 && (
        <div className="mt-2">
          {cage.done ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink/5 px-3 py-2">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <CheckCircle2Icon className="size-4 text-success" />
                ขนหมดแล้ว · จดใบในกรงนี้ซ้ำไม่ได้
                <span className="text-xs font-normal text-mute">
                  {cage.done.by ? `${cage.done.by} ` : ""}
                  {cage.done.at}
                </span>
              </p>
              <button type="button" disabled={pending} onClick={() => run(() => setPickupCageDone(pickupId, cage.id, false))} className="h-8 text-xs text-mute hover:text-ink">
                ยังเหลือของ
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setPickupCageDone(pickupId, cage.id, true))}
              className="flex h-10 items-center gap-1.5 px-1 text-sm text-mute hover:text-ink"
            >
              <CheckCircle2Icon className="size-4" /> ของในกรงนี้ขนหมดแล้ว (กันจดซ้ำ)
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** ข้อความสำเร็จรูป — กดแล้วต่อท้ายหมายเหตุ ไม่ต้องพิมพ์บนมือถือ */
const NOTE_PRESETS = ["ของขาด", "ของเกิน", "กล่องเสียหาย", "รถไม่รับบางชิ้น", "สลับใบ"];

/** แถวในเมนู ⋯ — สูง 44px กดง่าย มีไอคอน + ข้อความ */
function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-11 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm transition-[background-color,transform] duration-100 hover:bg-muted active:scale-[0.98] active:bg-muted [&_svg]:size-4 [&_svg]:shrink-0",
        danger ? "text-error-deep" : "text-ink [&_svg]:text-mute",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function ManifestChipItem({
  chip: c,
  editable,
  onRemove,
  inCage,
  cages = [],
}: {
  chip: ManifestChip;
  editable: boolean;
  onRemove: () => void;
  inCage?: boolean;
  cages?: CageInfo[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // ค่าที่เพิ่งบันทึก — โชว์ทันทีไม่ต้องรอหน้า refresh
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [saving, startSaving] = useTransition();
  const note = saved !== undefined ? saved : (c.note ?? null);
  // ใบที่แบ่งกับคันอื่นแต่คันนี้ยังไม่มีจำนวน → เปิดช่องแบ่งคันให้เลย (ค่าเริ่มต้น = ที่เหลือ)
  // ใบในกรง → แบ่งที่การ์ดกรง ไม่ต้องแบ่งรายใบ
  const [splitting, setSplitting] = useState(!inCage && editable && c.taken == null && (c.others?.length ?? 0) > 0);
  // แก้เลข / ค้นใหม่ — จับคู่ผิดใบ (เช่น ได้ prefix เก่า) ใส่เลขที่ถูกแทน
  const [fixing, setFixing] = useState(false);
  // ย้ายกรง — ยิงหลายกรงพร้อมกันแล้วใบลงผิดกรง
  const [moving, setMoving] = useState(false);
  // เมนู ⋯ ของใบ — ลบต้องแตะสองครั้ง กันนิ้วพลาด
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const menu = (fn: () => void) => {
    setMenuOpen(false);
    setConfirmRemove(false);
    fn();
  };
  const [movePending, startMove] = useTransition();
  const moveTo = (target: string) =>
    startMove(async () => {
      const res = await movePickupManifestCage(c.id, target);
      if (res.error) return void toast.error(res.error);
      toast.success(res.ok);
      setMoving(false);
    });
  const [fixDraft, setFixDraft] = useState("");
  const [fixPending, startFix] = useTransition();
  const openFix = () => {
    setFixDraft(c.manifestNo ?? c.code);
    setFixing(true);
  };
  const submitFix = () => {
    const value = fixDraft.trim();
    if (!value) return;
    startFix(async () => {
      const res = await replacePickupManifest(c.id, value);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.ok);
      if (res.warn) toast.warning(res.warn, { duration: 12_000 });
      setFixing(false);
    });
  };

  const open = () => {
    setDraft(note ?? "");
    setEditing(true);
  };
  const addPreset = (p: string) => setDraft((d) => (d.trim() ? `${d.trim()} · ${p} ` : `${p} `));
  const save = (value: string) =>
    startSaving(async () => {
      await savePickupManifestNote(c.id, value);
      setSaved(value.trim() || null);
      setEditing(false);
      toast.success(value.trim() ? `บันทึกหมายเหตุ ${c.manifestNo ?? c.code} แล้ว` : "ลบหมายเหตุแล้ว");
    });

  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 500, damping: 34 }}
      className={cn(
        "rounded-xl bg-card py-1 pr-1 pl-3 ring-1 ring-hairline",
        !c.pending && !c.manifestId && "bg-warning-soft/30 ring-warning/50",
        !inCage && !c.pending && (c.others?.length ?? 0) > 0 && "bg-warning-soft/30 ring-warning/50",
        note && "ring-warning/60",
      )}
    >
      <div className="flex min-h-11 items-center gap-1">
        <div className="min-w-0 flex-1">
          {/* เลขที่จด (4 หลักท้าย) อ่านง่ายเทียบกับใบที่กรง · เลขเต็มตัวเล็กข้าง ๆ */}
          {c.manifestId ? (
            <Link href={`/manifests/${c.manifestId}`} className="flex min-w-0 items-baseline gap-2 hover:underline">
              <span className="shrink-0 font-mono text-lg font-semibold tracking-tight">{c.code.length > 6 ? c.code.slice(-4) : c.code}</span>
              <span className="truncate font-mono text-xs text-mute">{c.manifestNo}</span>
            </Link>
          ) : (
            <span className="block truncate font-mono text-lg font-semibold tracking-tight">{c.code}</span>
          )}
          <span className="block truncate text-xs text-mute">
            {c.pending ? (
              <span className="inline-flex items-center gap-1">
                <Loader2Icon className="size-3 animate-spin" /> กำลังค้นหา…
              </span>
            ) : (
              <>
                {c.addedAt && <span className="tabular">{c.addedAt}</span>}
                {c.addedBy && <span> {c.addedBy}</span>}
                {c.addedAt && " · "}
                {c.manifestId ? (
                  <span className={c.expected != null && c.parcels < c.expected ? "text-warning-deep" : ""}>
                    {c.expected != null ? `${c.parcels}/${c.expected}` : c.parcels} ชิ้น
                  </span>
                ) : (
                  <span className="text-warning-deep">ยังไม่พบใบ</span>
                )}
                {(c.others?.length ?? 0) > 0 && (
                  <span className="font-medium text-warning-deep">
                    {" "}
                    {inCage ? (c.taken != null ? ` · คันนี้ ~${c.taken}` : "") : ` · แบ่ง ${c.others!.length + 1} คัน${c.taken != null ? ` · คันนี้ ${c.taken}` : ""}`}
                  </span>
                )}
              </>
            )}
          </span>
        </div>
        {/* ใบที่ยังไม่พบ — ปุ่มแก้เลขโชว์ตรง ๆ ไม่ต้องเปิดเมนู */}
        {editable && !c.pending && !c.manifestId && !editing && !fixing && (
          <button
            type="button"
            onClick={openFix}
            className="h-9 shrink-0 rounded-lg border border-warning/60 bg-card px-3 text-sm font-semibold text-warning-deep active:bg-warning-soft"
          >
            แก้เลข
          </button>
        )}
        {/* ทุกอย่างของใบนี้อยู่ในปุ่มเดียว — แถวโล่ง ไม่มีไอคอนเรียงยาว */}
        {!c.pending && !editing && (
          <Popover open={menuOpen} onOpenChange={(o) => { setMenuOpen(o); if (!o) setConfirmRemove(false); }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-full transition-colors hover:bg-muted active:bg-muted",
                  splitting || moving || fixing ? "text-ink" : "text-mute",
                )}
                aria-label={`ตัวเลือกของใบ ${c.code}`}
              >
                <EllipsisIcon className="size-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5 duration-100">
              <p className="truncate px-2.5 pt-1 pb-2 font-mono text-xs text-mute">{c.manifestNo ?? c.code}</p>
              {!inCage && c.manifestId && (editable || (c.others?.length ?? 0) > 0) && (
                <MenuItem icon={<SplitIcon />} onClick={() => menu(() => setSplitting((v) => !v))}>
                  แบ่งกับรถคันอื่น
                </MenuItem>
              )}
              {inCage && editable && (
                <MenuItem icon={<ArrowRightLeftIcon />} onClick={() => menu(() => setMoving(true))}>
                  ย้ายไปกรงอื่น
                </MenuItem>
              )}
              <MenuItem icon={<MessageSquareTextIcon />} onClick={() => menu(open)}>
                {note ? "แก้หมายเหตุ" : "เพิ่มหมายเหตุ"}
              </MenuItem>
              {editable && (
                <MenuItem icon={<PencilIcon />} onClick={() => menu(openFix)}>
                  แก้เลข / ค้นใหม่
                </MenuItem>
              )}
              {editable && (
                <div className="mt-1 border-t pt-1">
                  <MenuItem
                    icon={<Trash2Icon />}
                    danger
                    onClick={() => (confirmRemove ? menu(onRemove) : setConfirmRemove(true))}
                  >
                    {confirmRemove ? "แตะอีกครั้งเพื่อลบ" : "ลบใบนี้"}
                  </MenuItem>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      <AnimatePresence initial={false}>
        {splitting && <SplitPanel chip={c} editable={editable} onDone={() => setSplitting(false)} />}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {moving && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2 pt-2 pr-3 pb-2">
              <p className="flex items-center gap-1.5 text-xs text-mute">
                ย้ายใบนี้ไปกรง… {movePending && <Loader2Icon className="size-3.5 animate-spin" />}
              </p>
              <div className="flex flex-wrap gap-2">
                {cages
                  .filter((k) => k.id !== c.cageId)
                  .map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      disabled={movePending}
                      onClick={() => moveTo(k.id)}
                      className="h-11 min-w-14 rounded-xl border-2 border-hairline bg-card px-3 text-base font-semibold hover:border-brand/50 active:scale-[0.98] disabled:opacity-60"
                    >
                      {k.label}
                    </button>
                  ))}
                <button
                  type="button"
                  disabled={movePending}
                  onClick={() => moveTo("new")}
                  className="flex h-11 items-center gap-1 rounded-xl border-2 border-dashed border-hairline px-3 text-sm text-body hover:border-brand/50 disabled:opacity-60"
                >
                  <PlusIcon className="size-4" /> กรงใหม่
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {fixing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2 pt-2 pr-3 pb-2">
              <p className="text-xs text-mute">ใส่เลขใบนำจ่ายที่ถูก (แนะนำเลขเต็ม) · ไม่แก้แล้วกดบันทึก = ค้นใหม่</p>
              {/* text-base (16px) กัน iOS ซูมตอนแตะช่อง */}
              <Input
                value={fixDraft}
                onChange={(e) => setFixDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitFix();
                  }
                }}
                autoFocus
                autoComplete="off"
                placeholder="เช่น MFG963098839"
                className="h-11 font-mono text-base"
                disabled={fixPending}
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Button type="button" className="h-11" onClick={submitFix} disabled={fixPending || !fixDraft.trim()}>
                  {fixPending ? (
                    <>
                      <Loader2Icon className="size-4 animate-spin" /> กำลังค้นหา…
                    </>
                  ) : fixDraft.trim().toUpperCase() === (c.manifestNo ?? c.code) ? (
                    <>
                      <RotateCcwIcon className="size-4" /> ค้นใหม่
                    </>
                  ) : (
                    "บันทึกเลขใหม่"
                  )}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setFixing(false)} disabled={fixPending}>
                  ยกเลิก
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {note && !editing && (
        <button
          type="button"
          onClick={open}
          className="mt-1 mr-3 mb-1 block w-[calc(100%-0.75rem)] rounded-md bg-warning/10 px-3 py-2 text-left text-sm whitespace-pre-wrap text-warning-deep"
        >
          {note}
        </button>
      )}

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 pt-2 pr-3 pb-2">
              <div className="flex flex-wrap gap-2">
                {NOTE_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => addPreset(p)}
                    className="h-9 rounded-full border px-3 text-sm text-body transition-colors hover:bg-muted active:bg-muted"
                  >
                    + {p}
                  </button>
                ))}
              </div>
              {/* text-base (16px) กัน iOS ซูมตอนแตะช่อง */}
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                maxLength={500}
                autoFocus
                placeholder="เช่น ขาด 1 ชิ้น (TH2638…) / รถรับเกินมา 2 ชิ้น"
                className="text-base"
              />
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Button type="button" className="h-11" onClick={() => save(draft)} disabled={saving}>
                  {saving ? "กำลังบันทึก…" : "บันทึกหมายเหตุ"}
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setEditing(false)} disabled={saving}>
                  ยกเลิก
                </Button>
              </div>
              {note && (
                <button
                  type="button"
                  onClick={() => save("")}
                  disabled={saving}
                  className="h-9 justify-self-start text-sm text-error-deep hover:underline"
                >
                  ลบหมายเหตุ
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

type Details = { parcelCount: number | null; carrier: string | null; driverName: string | null; note: string | null };

export function PickupDetailsForm({ pickupId, details, carriers }: { pickupId: string; details: Details; carriers: string[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePickupDetails.bind(null, pickupId), undefined);
  useActionToast(state);

  return (
    <form action={action} className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="จำนวนชิ้นที่รถนับ" htmlFor="d-count">
          <Input id="d-count" name="parcelCount" type="number" min={0} inputMode="numeric" defaultValue={details.parcelCount ?? ""} className="h-11 text-base" />
        </Field>
        <Field label="ขนส่ง" htmlFor="d-carrier">
          <Input id="d-carrier" name="carrier" list="d-carriers" defaultValue={details.carrier ?? ""} className="h-11" />
          <datalist id="d-carriers">
            {carriers.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="คนขับ" htmlFor="d-driver">
          <Input id="d-driver" name="driverName" defaultValue={details.driverName ?? ""} />
        </Field>
      </div>
      <Field label="หมายเหตุ" htmlFor="d-note">
        <Textarea id="d-note" name="note" rows={2} defaultValue={details.note ?? ""} />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึกรายละเอียด"}
        </Button>
      </div>
    </form>
  );
}

/** แถบงานที่กำลังทำ: นาฬิกาเดิน + ปุ่มปิดงาน */
export function DoingBar({
  pickupId,
  plate,
  since,
  manifests,
  parcels,
  parcelCount,
}: {
  pickupId: string;
  plate: string;
  since: string;
  manifests: number;
  parcels: number;
  parcelCount: number | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(closePickup.bind(null, pickupId), undefined);
  useActionToast(state);
  // ปิดหน้าต่างหลังเซิร์ฟเวอร์ตอบแล้วเท่านั้น — ถ้าปิดทันทีตอนกด ฟอร์มหายก่อนส่ง (มือถือ: กดแล้วไม่ปิดงาน / ไม่ส่ง LINE)
  // จำผลล่าสุดตอนเปิดหน้าต่างไว้ · ได้ผลใหม่จากเซิร์ฟเวอร์ (state เปลี่ยน) = ปิดเอง ไม่ต้องใช้ effect
  const [openedWith, setOpenedWith] = useState<{ state: FormState } | null>(null);
  const open = openedWith !== null && openedWith.state === state;
  // จำนวนที่รถนับ — เทียบกับในระบบให้เห็นทันทีว่าขาด/เกินเท่าไหร่
  // ตั้งค่าใหม่ทุกครั้งที่เปิดหน้าต่าง — ระหว่างจด parcels เพิ่มขึ้นเรื่อย ๆ ค่าตอน mount จะเก่า
  const [countDraft, setCountDraft] = useState("");
  const setOpen = (o: boolean) => {
    if (o) setCountDraft(String(parcelCount ?? (parcels || "")));
    setOpenedWith(o ? { state } : null);
  };
  const countDiff = countDraft.trim() === "" ? 0 : Number(countDraft) - parcels;

  return (
    <>
      {/* แถบสถานะแบบบาง — นาฬิกา + ยอด อ่านได้ในบรรทัดเดียว */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-4 py-2.5 ring-1 ring-hairline sm:mb-6">
        <span className="flex items-center gap-2 text-sm text-body">
          <span className="live-dot size-2 rounded-full bg-brand" />
          กำลังรับของ
          <LiveTimer since={since} className="tabular font-mono font-semibold text-brand-deep" />
        </span>
        <span className="text-sm text-mute tabular">
          <b className="font-semibold text-ink">{manifests}</b> ใบ · <b className="font-semibold text-ink">{parcels}</b> ชิ้น
        </span>
        {/* จอใหญ่: ปุ่มอยู่ในแถบ · มือถือ: ปุ่มติดล่างจอ (ด้านล่าง) */}
        <Button className="ml-auto hidden h-10 px-5 sm:inline-flex" onClick={() => setOpen(true)}>
          <CheckCircle2Icon />
          ปิดงาน {plate}
        </Button>
      </div>

      {/* มือถือ: ปุ่มปิดงานติดล่างจอ — มีทะเบียนบนปุ่ม สลับคันแล้วไม่ปิดผิดคัน */}
      <div className="no-print fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+var(--tabbar-h))] z-20 border-t bg-card/95 px-4 pt-2.5 pb-3 backdrop-blur-md sm:hidden">
        <Button className="h-12 w-full rounded-xl text-[15px] font-semibold" onClick={() => setOpen(true)}>
          ปิดงาน {plate} · รถออก
          <span className="ml-1 font-normal text-white/75 tabular">{parcels} ชิ้น</span>
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <form action={action} className="grid gap-5">
            <AlertDialogHeader>
              <AlertDialogTitle>ปิดงาน {plate}?</AlertDialogTitle>
              <AlertDialogDescription>
                จด {manifests} manifest · เช็คจำนวนกับคนขับก่อนปล่อยรถ
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-canvas-soft-2 px-4 py-3">
                <p className="text-xs text-mute">ในระบบ</p>
                <p className="tabular text-2xl font-semibold">{parcels}</p>
              </div>
              <Field label="รถนับรับไป" htmlFor="close-count">
                <Input
                  id="close-count"
                  name="parcelCount"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={countDraft}
                  onChange={(e) => setCountDraft(e.target.value)}
                  className="h-12 text-center font-mono text-xl font-semibold"
                />
              </Field>
            </div>
            {countDiff !== 0 && (
              <p className="animate-in rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-deep duration-150 fade-in slide-in-from-top-1">
                {countDiff < 0 ? `ขาดไป ${-countDiff} ชิ้น` : `เกินมา ${countDiff} ชิ้น`} จากในระบบ — ใส่หมายเหตุที่ใบนั้นไว้ด้วยจะตามง่าย
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel type="button" className="h-12">
                ยังไม่ปิด
              </AlertDialogCancel>
              {/* ปุ่มส่งฟอร์มธรรมดา (ไม่ใช่ AlertDialogAction ที่ปิดหน้าต่างทันทีตอนกด) */}
              <Button type="submit" disabled={pending} className="h-12">
                {pending ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}
                {pending ? "กำลังปิด…" : "ยืนยันปิดงาน"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ReopenButton({ pickupId }: { pickupId: string }) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pending}>
          <RotateCcwIcon />
          เปิดงานใหม่
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>เปิดงานนี้ใหม่?</AlertDialogTitle>
          <AlertDialogDescription>ใช้เมื่อกดปิดงานผิด — เวลาสิ้นสุดจะถูกลบ และกลับเป็นสถานะ “กำลังทำ”</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            onClick={() =>
              start(async () => {
                await reopenPickup(pickupId);
                toast("เปิดงานใหม่แล้ว");
              })
            }
          >
            เปิดงานใหม่
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * ใบเดียวแบ่งขึ้นหลายคัน — ใส่จำนวนกล่องที่คันนี้รับจากใบนี้
 * ปุ่มลัด: ที่เหลือ (ทั้งใบ − คันอื่น) · ครึ่งใบ · ทั้งใบ (ล้างค่า)
 */
function SplitPanel({ chip: c, editable, onDone }: { chip: ManifestChip; editable: boolean; onDone: () => void }) {
  const size = c.parcels || c.expected || 0;
  // นับเฉพาะคันที่ใส่จำนวนแล้ว — คันที่ยังไม่ใส่จะได้ "ที่เหลือ" ตอนบันทึก
  const othersSum = (c.others ?? []).reduce((n, o) => n + (o.count ?? 0), 0);
  const blankOthers = (c.others ?? []).filter((o) => o.count == null).length;
  const remaining = Math.max(0, size - othersSum);
  // ค่าเริ่มต้น = ที่เหลือ (ใบที่แบ่งกับคันอื่น) · แก้ได้
  const [value, setValue] = useState<string>(c.taken != null ? String(c.taken) : String(c.others?.length ? remaining : size));
  const [saving, start] = useTransition();
  const n = Number(value);
  const valid = value.trim() === "" || (Number.isInteger(n) && n >= 0);
  const mine = value.trim() === "" ? size : n || 0;
  // คันที่ยังไม่ใส่ (คันเดียว) จะได้ส่วนที่เหลือจากคันนี้
  const total = othersSum + mine + (blankOthers === 1 ? Math.max(0, size - othersSum - mine) : 0);

  const save = (v: string | null) =>
    start(async () => {
      const res = await setPickupManifestCount(c.id, v);
      if (res.error) return void toast.error(res.error);
      toast.success(res.ok);
      if (res.warn) toast.warning(res.warn, { duration: 10_000 });
      onDone();
    });

  const presets: [string, number | null][] = [
    ...(c.others?.length ? ([[`ที่เหลือ · ${remaining}`, remaining]] as [string, number][]) : []),
    [`ครึ่งใบ · ${Math.ceil(size / 2)}`, Math.ceil(size / 2)],
    [`ทั้งใบ · ${size}`, null],
  ];

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
      <div className="grid gap-3 pt-2 pr-3 pb-2">
        <p className="text-sm text-body">ใบนี้มี {size} ชิ้น — คันนี้รับไปกี่ชิ้น? ยอดของรถจะนับเฉพาะส่วนนี้</p>
        {editable && (
          <>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" className="size-14 shrink-0" aria-label="ลด 1" onClick={() => setValue(String(Math.max(0, (Number(value) || 0) - 1)))}>
                <MinusIcon />
              </Button>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                aria-label="จำนวนชิ้นบนคันนี้"
                className="h-14 text-center font-mono text-2xl font-semibold"
              />
              <Button type="button" variant="outline" className="size-14 shrink-0" aria-label="เพิ่ม 1" onClick={() => setValue(String((Number(value) || 0) + 1))}>
                <PlusIcon />
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {presets.map(([label, v]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => (v == null ? save(null) : setValue(String(v)))}
                  className="h-10 rounded-full border px-3 text-sm text-body transition-colors hover:bg-muted active:bg-muted"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {(c.others?.length ?? 0) > 0 && (
          <ul className="divide-y rounded-lg bg-canvas-soft-2 px-3 text-sm">
            {c.others!.map((o, i) => (
              <li key={i} className="flex min-h-11 items-center justify-between">
                <span>
                  {o.plate} {o.doing && <span className="text-xs text-mute">กำลังรับของ</span>}
                </span>
                <span className="tabular font-mono font-medium">
                  {o.count ?? (blankOthers === 1 ? <span className="font-sans text-xs text-mute">ได้ที่เหลือ {Math.max(0, size - othersSum - mine)}</span> : <span className="font-sans text-xs text-mute">ยังไม่ระบุ</span>)}
                </span>
              </li>
            ))}
            <li className="flex min-h-11 items-center justify-between font-medium">
              <span>รวมทุกคัน</span>
              <span className={cn("tabular font-mono", size && total !== size ? "text-warning-deep" : "text-teal-deep")}>
                {total} / {size}
              </span>
            </li>
          </ul>
        )}
        {editable && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button type="button" className="h-12" disabled={!valid || saving} onClick={() => save(value.trim() === "" ? null : value)}>
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </Button>
            <Button type="button" variant="outline" className="h-12" onClick={onDone} disabled={saving}>
              ยกเลิก
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
