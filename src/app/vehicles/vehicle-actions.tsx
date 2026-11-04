"use client";

import { useTransition } from "react";
import { EyeIcon, EyeOffIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { deleteVehicle, setVehicleActive } from "@/app/actions/vehicles";
import { ConfirmButton } from "@/components/client-actions";
import { VehicleDialog, type VehicleDraft } from "@/components/vehicle-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AddVehicleButton({ carriers }: { carriers: string[] }) {
  return (
    <VehicleDialog
      carriers={carriers}
      trigger={
        <Button>
          <PlusIcon />
          เพิ่มรถ
        </Button>
      }
    />
  );
}

export function VehicleRowActions({
  vehicle,
  carriers,
  active,
  used,
}: {
  vehicle: VehicleDraft & { id: string; plate: string };
  carriers: string[];
  active: boolean;
  used: number;
}) {
  const [pending, start] = useTransition();

  return (
    <div className="flex justify-end gap-1">
      <VehicleDialog
        draft={vehicle}
        carriers={carriers}
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`แก้ไข ${vehicle.plate}`}>
            <PencilIcon />
          </Button>
        }
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await setVehicleActive(vehicle.id, !active);
                toast(active ? `ซ่อน ${vehicle.plate} แล้ว` : `เปิดใช้ ${vehicle.plate} แล้ว`);
              })
            }
            aria-label={active ? "ซ่อน" : "เปิดใช้"}
          >
            {active ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{active ? "ซ่อนจากรายการเลือก" : "เปิดใช้อีกครั้ง"}</TooltipContent>
      </Tooltip>
      <ConfirmButton
        action={deleteVehicle.bind(null, vehicle.id)}
        label={<Trash2Icon />}
        variant="ghost"
        size="icon-sm"
        title={`ลบ ${vehicle.plate}?`}
        description={
          used
            ? `รอบรถเก่า ${used} รอบยังอยู่ครบ (ทะเบียนเก็บไว้ในรอบรถแล้ว) — แค่ไม่มีให้เลือกตอนเริ่มงานอีก`
            : "รถคันนี้ยังไม่เคยมีรอบรถ ลบได้เลย"
        }
        confirmLabel="ลบ"
        done={`ลบ ${vehicle.plate} แล้ว`}
      />
    </div>
  );
}
