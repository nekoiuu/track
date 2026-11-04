"use server";

import { audit, requireUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { normalizePlate } from "@/lib/format";

export type VehicleOption = {
  id: string;
  plate: string;
  carrier: string | null;
  driverName: string | null;
  lastUsedAt: string | null;
  busy: boolean; // มีงานที่ยังไม่ปิดอยู่
};

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

export type VehicleState = { ok?: string; error?: string; vehicle?: VehicleOption } | undefined;

/** เพิ่มรถ — ทะเบียนซ้ำจะได้คันเดิมกลับไป (และเปิดใช้ถ้าซ่อนไว้) */
export async function saveVehicle(_: VehicleState, form: FormData): Promise<VehicleState> {
  const user = await requireUser();
  const id = text(form.get("id"));
  const plate = normalizePlate(String(form.get("plate") ?? ""));
  if (!plate) return { error: "กรอกทะเบียนรถ" };

  const data = {
    plate,
    carrier: text(form.get("carrier")),
    driverName: text(form.get("driverName")),
    phone: text(form.get("phone")),
    note: text(form.get("note")),
    active: true,
  };

  const dup = await db.vehicle.findUnique({ where: { plate } });
  if (dup && dup.id !== id) {
    if (id) return { error: `ทะเบียน ${plate} มีอยู่แล้ว` };
    // เพิ่มซ้ำ = ใช้คันเดิม เติมข้อมูลที่ว่างอยู่
    const v = await db.vehicle.update({
      where: { id: dup.id },
      data: {
        active: true,
        carrier: dup.carrier ?? data.carrier,
        driverName: dup.driverName ?? data.driverName,
        phone: dup.phone ?? data.phone,
      },
    });
    audit(user, "vehicle.save", "vehicle", v.id, plate);
    revalidatePath("/", "layout");
    return { ok: `มี ${plate} อยู่แล้ว — เลือกให้แล้ว`, vehicle: toOption(v, false) };
  }

  const v = id ? await db.vehicle.update({ where: { id }, data }) : await db.vehicle.create({ data });
  audit(user, id ? "vehicle.edit" : "vehicle.create", "vehicle", v.id, plate);
  revalidatePath("/", "layout");
  return { ok: id ? `บันทึก ${plate} แล้ว` : `เพิ่ม ${plate} แล้ว`, vehicle: toOption(v, false) };
}

/** ซ่อน / เปิดใช้ — ซ่อนแล้วประวัติรอบรถยังอยู่ครบ */
export async function setVehicleActive(id: string, active: boolean) {
  const user = await requireUser();
  const v = await db.vehicle.update({ where: { id }, data: { active } });
  audit(user, active ? "vehicle.enable" : "vehicle.disable", "vehicle", id, v.plate);
  revalidatePath("/", "layout");
}

/**
 * ลบรถ — รอบรถเก่ายังอยู่ครบ (เก็บทะเบียนเป็นข้อความไว้ในรอบรถแล้ว) แค่ไม่ผูกกับรถคันนี้
 * งานที่ยังไม่ปิดไม่ให้ลบ กันลบผิดคันระหว่างรถรับของ
 */
export async function deleteVehicle(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  const doing = await db.pickup.count({ where: { vehicleId: id, status: "DOING" } });
  if (doing) return { error: "รถคันนี้มีงานที่ยังไม่ปิด — ปิดงานก่อนแล้วค่อยลบ" };
  const v = await db.vehicle.delete({ where: { id } });
  audit(user, "vehicle.delete", "vehicle", id, v.plate);
  revalidatePath("/", "layout");
  return {};
}

function toOption(
  v: { id: string; plate: string; carrier: string | null; driverName: string | null; lastUsedAt: Date | null },
  busy: boolean,
): VehicleOption {
  return {
    id: v.id,
    plate: v.plate,
    carrier: v.carrier,
    driverName: v.driverName,
    lastUsedAt: v.lastUsedAt?.toISOString() ?? null,
    busy,
  };
}
