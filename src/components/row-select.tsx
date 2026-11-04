"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { CopyIcon, FileSpreadsheetIcon, Link2Icon, ListChecksIcon, Loader2Icon, PencilIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { editParcels, runParcelsFlash } from "@/app/actions/manifests";
import { exportParcelsToSheets } from "@/app/actions/sheets";
import type { ParcelStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { copyText, visibleRows } from "./copy-trackings";
import { makeShareLink } from "./share-button";
import { PARCEL_STATUS } from "./kit";

/**
 * ติ๊กเลือกหลายแถว แล้วสั่งทีเดียว (ไม่ต้องกดทีละอัน)
 * - แถวใส่ <RowCheck id trackingNo /> (แถวต้องมี data-tracking อยู่แล้ว)
 * - ใส่ <SelectionBar scope /> หนึ่งอันต่อตาราง — ปุ่ม "เลือกทั้งหมดที่เห็น" + แถบล่างจอเมื่อเลือกแล้ว
 * อ่านสถานะจาก checkbox ใน DOM ตรง ๆ — แถวเป็น server component ไม่ต้องส่ง state ข้ามกัน
 */
export function RowCheck({ id, trackingNo }: { id: string; trackingNo: string }) {
  return (
    <input
      type="checkbox"
      data-select={id}
      data-select-no={trackingNo}
      aria-label={`เลือก ${trackingNo}`}
      // ช่องใหญ่พอให้นิ้วกดโดน · ไม่พาไปลิงก์ของแถว
      onClick={(e) => e.stopPropagation()}
      className="no-print mr-2 size-5 shrink-0 cursor-pointer align-middle accent-(--color-brand)"
    />
  );
}

const boxes = (scope: string) => [...(document.getElementById(scope)?.querySelectorAll<HTMLInputElement>("input[data-select]") ?? [])];
const picked = (scope: string) => boxes(scope).filter((b) => b.checked);

/** Flash ทีละไม่เกิน 100 ชิ้นต่อครั้ง */
const FLASH_CHUNK = 100;
const noop = () => () => {};

export function SelectionBar({
  scope,
  sheets = false,
  pickupId,
}: {
  scope: string;
  /** ตั้งค่า Google Sheets แล้ว → มีปุ่มส่งที่เลือกไป Sheets (ส่งได้ทุกชิ้น ไม่ว่าจะอยู่ใน Flash หรือไม่) */
  sheets?: boolean;
  /** ส่งจากหน้ารอบรถ → ใช้รถคันนี้ในแถวที่ส่ง */
  pickupId?: string;
}) {
  const [count, setCount] = useState(0);
  // portal ได้หลังอยู่ในเบราว์เซอร์แล้วเท่านั้น (server ไม่มี document.body)
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);

  const recount = useCallback(() => setCount(picked(scope).length), [scope]);

  useEffect(() => {
    const root = document.getElementById(scope);
    if (!root) return;
    const onChange = (e: Event) => {
      if ((e.target as HTMLElement).matches?.("input[data-select]")) recount();
    };
    root.addEventListener("change", onChange);
    // แถวเปลี่ยน (เปลี่ยนหน้า / revalidate) → นับใหม่
    const mo = new MutationObserver(recount);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      root.removeEventListener("change", onChange);
      mo.disconnect();
    };
  }, [scope, recount]);

  const setAll = (on: boolean) => {
    if (on) {
      // เฉพาะแถวที่เห็นอยู่ (ตามตัวกรอง/คำค้น)
      for (const row of visibleRows(scope)) row.querySelectorAll<HTMLInputElement>("input[data-select]").forEach((b) => (b.checked = true));
    } else boxes(scope).forEach((b) => (b.checked = false));
    recount();
  };

  const ids = () => [...new Set(picked(scope).map((b) => b.dataset.select!))];
  const nos = () => [...new Set(picked(scope).map((b) => b.dataset.selectNo!))];

  const copy = async () => {
    const list = nos();
    if (!(await copyText(list.join("\n")))) return void toast.error("คัดลอกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    toast.success(`คัดลอก ${list.length} เลขแล้ว`);
  };

  const flash = () =>
    start(async () => {
      const list = ids();
      const t = toast.loading(`กำลังเช็ค Flash ${list.length} ชิ้น…`);
      let failed = 0;
      for (let i = 0; i < list.length; i += FLASH_CHUNK) {
        if (list.length > FLASH_CHUNK) toast.loading(`กำลังเช็ค Flash ${Math.min(i + FLASH_CHUNK, list.length)}/${list.length}…`, { id: t });
        const r = await runParcelsFlash(list.slice(i, i + FLASH_CHUNK));
        if (!r?.ok) failed++;
        if (list.length <= FLASH_CHUNK) {
          toast[r?.ok ? "success" : "error"](r?.message ?? "เช็คไม่สำเร็จ", { id: t });
          return;
        }
      }
      toast[failed ? "error" : "success"](failed ? `เช็คเสร็จ แต่มี ${failed} ชุดไม่สำเร็จ` : `เช็ค Flash ${list.length} ชิ้นแล้ว`, { id: t });
    });

  const toSheets = () => {
    const list = ids();
    if (!window.confirm(`ส่ง ${list.length} ชิ้นที่เลือกไป Google Sheets?`)) return;
    start(async () => {
      const t = toast.loading(`กำลังส่ง ${list.length} ชิ้นไป Sheets…`);
      const r = await exportParcelsToSheets(list, pickupId);
      toast[r?.ok ? "success" : "error"](r?.message ?? "ส่งไม่สำเร็จ", { id: t });
    });
  };

  const bar = count > 0 && (
    <div className="no-print fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto max-w-2xl sm:bottom-6 lg:left-[calc(var(--sidebar-w)+1rem)]">
      <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl bg-navy p-2 pl-4 text-white shadow-float scrollbar-none">
        <span className="mr-auto shrink-0 text-sm font-semibold whitespace-nowrap tabular">เลือก {count}</span>
        <BarButton onClick={flash} disabled={pending} icon={pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} label="เช็ค Flash" />
        <BarButton onClick={() => setEditing(true)} disabled={pending} icon={<PencilIcon />} label="สถานะ" />
        <BarButton onClick={copy} disabled={pending} icon={<CopyIcon />} label="คัดลอก" />
        {sheets && <BarButton onClick={toSheets} disabled={pending} icon={<FileSpreadsheetIcon />} label="Sheets" />}
        {/* ลิงก์สาธารณะของชิ้นที่เลือก — ใครก็เปิดดูสถานะได้ไม่ต้อง login */}
        <BarButton onClick={() => start(() => makeShareLink({ parcelIds: ids() }))} disabled={pending} icon={<Link2Icon />} label="ลิงก์" />
        <button
          type="button"
          onClick={() => setAll(false)}
          className="grid size-11 shrink-0 place-items-center rounded-xl hover:bg-white/10"
          aria-label="ยกเลิกที่เลือก"
        >
          <XIcon className="size-5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setAll(count === 0)}
        className="no-print mb-3 flex h-10 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm text-body hover:bg-muted"
      >
        <ListChecksIcon className="size-4" />
        {count === 0 ? "เลือกทั้งหมดที่เห็น" : `ยกเลิกที่เลือก (${count})`}
      </button>
      {mounted && bar && createPortal(bar, document.body)}
      <BulkStatusDialog
        open={editing}
        onOpenChange={setEditing}
        count={count}
        onSave={(status, note) =>
          start(async () => {
            const res = await editParcels(ids(), status, note);
            if (res.error) return void toast.error(res.error);
            toast.success(res.ok);
            setEditing(false);
            setAll(false);
          })
        }
        saving={pending}
      />
    </>
  );
}

function BarButton({ onClick, disabled, icon, label }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 text-[11px] hover:bg-white/10 disabled:opacity-60 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm [&_svg]:size-4"
    >
      {icon}
      {label}
    </button>
  );
}

/** เปลี่ยนสถานะทีเดียวหลายชิ้น — หมายเหตุว่าง = คงหมายเหตุเดิมของแต่ละชิ้น */
function BulkStatusDialog({
  open,
  onOpenChange,
  count,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  count: number;
  onSave: (status: ParcelStatus, note: string) => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState<ParcelStatus | null>(null);
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setStatus(null);
          setNote("");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="top-auto bottom-0 max-w-full translate-y-0 rounded-b-none pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:top-1/2 sm:bottom-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-xl sm:pb-4">
        <DialogHeader>
          <DialogTitle>เปลี่ยนสถานะ {count} ชิ้น</DialogTitle>
          <DialogDescription>ทุกชิ้นที่เลือกจะเป็นสถานะเดียวกัน</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="สถานะ">
          {(Object.entries(PARCEL_STATUS) as [ParcelStatus, (typeof PARCEL_STATUS)[ParcelStatus]][]).map(([k, v]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={status === k}
              onClick={() => setStatus(k)}
              className={cn(
                "h-11 rounded-lg border px-3 text-left text-sm transition-colors",
                status === k ? "border-brand bg-brand text-white" : "bg-card text-body hover:bg-muted active:bg-muted",
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
        {/* text-base กัน iOS ซูมตอนแตะช่อง */}
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="หมายเหตุ (ไม่ใส่ = คงของเดิม)" className="text-base" />
        <Button type="button" className="h-11" disabled={!status || saving} onClick={() => status && onSave(status, note)}>
          {saving ? "กำลังบันทึก…" : `บันทึก ${count} ชิ้น`}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
