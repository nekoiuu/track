"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { saveVehicle, type VehicleOption, type VehicleState } from "@/app/actions/vehicles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "./kit";
import { useActionToast } from "./motion";

export type VehicleDraft = {
  id?: string;
  plate?: string;
  carrier?: string | null;
  driverName?: string | null;
  phone?: string | null;
  note?: string | null;
};

/** เพิ่ม / แก้ไขรถ — ใช้ทั้งในตัวเลือกทะเบียนและหน้ารายการรถ */
export function VehicleDialog({
  draft,
  carriers,
  trigger,
  open,
  onOpenChange,
  onSaved,
}: {
  draft?: VehicleDraft;
  carriers: string[];
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved?: (v: VehicleOption) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;

  const [state, action, pending] = useActionState<VehicleState, FormData>(saveVehicle, undefined);
  useActionToast(state);

  useEffect(() => {
    if (state?.vehicle) {
      onSaved?.(state.vehicle);
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ปิดเฉพาะตอนได้ผลใหม่
  }, [state]);

  const editing = Boolean(draft?.id);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        {/* key: เปิดใหม่ = ฟอร์มใหม่ ค่าเริ่มต้นตาม draft ล่าสุด */}
        <form key={`${draft?.id ?? "new"}-${draft?.plate ?? ""}-${isOpen}`} action={action} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{editing ? `แก้ไข ${draft?.plate}` : "เพิ่มรถ"}</DialogTitle>
            <DialogDescription>บันทึกไว้ครั้งเดียว ครั้งหน้าเลือกจากรายการได้เลย</DialogDescription>
          </DialogHeader>

          {draft?.id && <input type="hidden" name="id" value={draft.id} />}
          <Field label="ทะเบียนรถ *" htmlFor="v-plate">
            <Input id="v-plate" name="plate" required autoFocus defaultValue={draft?.plate} placeholder="1กข 1234 กทม" className="h-11 text-base" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="ขนส่ง" htmlFor="v-carrier">
              <Input id="v-carrier" name="carrier" list="v-carriers" defaultValue={draft?.carrier ?? ""} placeholder="Flash / J&T / SPX" />
              <datalist id="v-carriers">
                {carriers.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="คนขับ" htmlFor="v-driver">
              <Input id="v-driver" name="driverName" defaultValue={draft?.driverName ?? ""} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="เบอร์โทร" htmlFor="v-phone">
              <Input id="v-phone" name="phone" type="tel" inputMode="tel" defaultValue={draft?.phone ?? ""} />
            </Field>
            <Field label="หมายเหตุ" htmlFor="v-note">
              <Input id="v-note" name="note" defaultValue={draft?.note ?? ""} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "กำลังบันทึก…" : editing ? "บันทึก" : "เพิ่มรถ"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
