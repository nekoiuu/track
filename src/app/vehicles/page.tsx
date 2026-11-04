import { connection } from "next/server";
import { TruckIcon } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { DataTable, Empty, Page, PageHeader, Pill, Section } from "@/components/kit";
import { TableCell, TableRow } from "@/components/ui/table";
import { AddVehicleButton, VehicleRowActions } from "./vehicle-actions";

export const metadata = { title: "รถ" };

export default async function VehiclesPage() {
  await connection();
  const vehicles = await db.vehicle.findMany({
    orderBy: [{ active: "desc" }, { lastUsedAt: { sort: "desc", nulls: "last" } }, { plate: "asc" }],
    include: {
      _count: { select: { pickups: true } },
      pickups: { where: { status: "DOING" }, select: { id: true }, take: 1 },
    },
  });
  const carriers = [...new Set(vehicles.map((v) => v.carrier).filter((c): c is string => Boolean(c)))].sort();

  return (
    <Page>
      <PageHeader
        title="รถ"
        actions={<AddVehicleButton carriers={carriers} />}
      />

      <Section title={`ทั้งหมด (${vehicles.length})`}>
        {vehicles.length === 0 ? (
          <Empty icon={<TruckIcon />}>ยังไม่มีรถ — เพิ่มได้ที่ปุ่มด้านบน หรือตอนเริ่มงาน</Empty>
        ) : (
          <DataTable head={["ทะเบียน", "ขนส่ง", "คนขับ", "เบอร์", "มาล่าสุด", "รอบ", ""]}>
            {vehicles.map((v) => (
              <TableRow key={v.id} className={v.active ? "" : "opacity-50"}>
                <TableCell>
                  <span className="font-medium">{v.plate}</span>
                  <span className="ml-2 inline-flex gap-1">
                    {v.pickups.length > 0 && <Pill tone="amber">กำลังทำ</Pill>}
                    {!v.active && <Pill>ซ่อนอยู่</Pill>}
                  </span>
                  {v.note && <span className="block text-xs text-mute">{v.note}</span>}
                </TableCell>
                <TableCell className="text-body">{v.carrier ?? "—"}</TableCell>
                <TableCell className="text-body">{v.driverName ?? "—"}</TableCell>
                <TableCell className="tabular text-body">{v.phone ?? "—"}</TableCell>
                <TableCell className="tabular text-body">{fmtDateTime(v.lastUsedAt)}</TableCell>
                <TableCell className="tabular">{v._count.pickups}</TableCell>
                <TableCell>
                  <VehicleRowActions
                    vehicle={{ id: v.id, plate: v.plate, carrier: v.carrier, driverName: v.driverName, phone: v.phone, note: v.note }}
                    carriers={carriers}
                    active={v.active}
                    used={v._count.pickups}
                  />
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Section>
    </Page>
  );
}
