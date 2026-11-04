"use client";

import { useState, useTransition } from "react";
import { PencilIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { editParcel } from "@/app/actions/manifests";
import type { ParcelStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PARCEL_STATUS } from "./kit";

/** ข้อความสำเร็จรูป — กดแล้วต่อท้ายหมายเหตุ ไม่ต้องพิมพ์บนมือถือ */
const NOTE_PRESETS = ["ลูกค้ายกเลิก", "ยกเลิกก่อนขึ้นรถ", "ของหมด", "แพ็กใหม่", "รถไม่รับ"];

export type EditableParcel = { id: string; trackingNo: string; orderNo: string | null; status: ParcelStatus; statusNote: string | null };

/** ปุ่มแก้ไขในแถวตาราง → popup เปลี่ยนสถานะ / หมายเหตุ (เช่น ยกเลิกกลางคันก่อนขึ้นรถ) */
export function ParcelEditButton({ parcel }: { parcel: EditableParcel }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ParcelStatus>(parcel.status);
  const [note, setNote] = useState(parcel.statusNote ?? "");
  const [saving, startSaving] = useTransition();

  const onOpenChange = (o: boolean) => {
    // เปิดใหม่ทุกครั้งเริ่มจากค่าล่าสุด
    if (o) {
      setStatus(parcel.status);
      setNote(parcel.statusNote ?? "");
    }
    setOpen(o);
  };

  const save = () =>
    startSaving(async () => {
      const res = await editParcel(parcel.id, status, note);
      if (res.error) return void toast.error(res.error);
      toast.success(res.ok);
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="-my-2 grid size-10 place-items-center rounded-full text-mute transition-colors hover:bg-muted hover:text-ink active:bg-muted"
          aria-label={`แก้ไข ${parcel.trackingNo}`}
        >
          <PencilIcon className="size-4" />
        </button>
      </DialogTrigger>
      {/* มือถือ: เต็มความกว้าง ชิดล่างจอ นิ้วโป้งเอื้อมถึง */}
      <DialogContent className="top-auto bottom-0 max-w-full translate-y-0 rounded-b-none pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:top-1/2 sm:bottom-auto sm:max-w-md sm:-translate-y-1/2 sm:rounded-xl sm:pb-4">
        <DialogHeader>
          <DialogTitle className="font-mono">{parcel.trackingNo}</DialogTitle>
          {parcel.orderNo && <DialogDescription className="font-mono">ออเดอร์ {parcel.orderNo}</DialogDescription>}
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

        <div className="grid gap-2">
          <div className="flex flex-wrap gap-1.5">
            {NOTE_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setNote((d) => (d.trim() ? `${d.trim()} · ${p}` : p))}
                className="h-8 rounded-full border px-3 text-xs text-body hover:bg-muted active:bg-muted"
              >
                + {p}
              </button>
            ))}
          </div>
          {/* text-base กัน iOS ซูมตอนแตะช่อง */}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="หมายเหตุ" className="text-base" />
        </div>

        <Button type="button" className="h-11" onClick={save} disabled={saving}>
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
