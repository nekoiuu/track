import "server-only";
import { db } from "./db";
import type { VehicleOption } from "@/app/actions/vehicles";

/** รถที่เปิดใช้ — คันที่มาล่าสุดอยู่บน พร้อมบอกว่าคันไหนมีงานค้าง */
export async function listVehicleOptions(): Promise<VehicleOption[]> {
  const vehicles = await db.vehicle.findMany({
    where: { active: true },
    orderBy: [{ lastUsedAt: { sort: "desc", nulls: "last" } }, { plate: "asc" }],
    include: { pickups: { where: { status: "DOING" }, select: { id: true }, take: 1 } },
  });
  return vehicles.map((v) => ({
    id: v.id,
    plate: v.plate,
    carrier: v.carrier,
    driverName: v.driverName,
    lastUsedAt: v.lastUsedAt?.toISOString() ?? null,
    busy: v.pickups.length > 0,
  }));
}
