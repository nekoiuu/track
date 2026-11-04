import { connection } from "next/server";
import { db } from "@/lib/db";
import { listVehicleOptions } from "@/lib/vehicles";
import { Page, PageHeader, Panel } from "@/components/kit";
import { StartPickupForm } from "@/components/start-pickup-form";

export const metadata = { title: "เริ่มงานรถเข้า" };

export default async function NewPickupPage() {
  await connection();
  const [vehicles, carriers] = await Promise.all([
    listVehicleOptions(),
    db.vehicle.findMany({ where: { carrier: { not: null } }, distinct: ["carrier"], select: { carrier: true }, orderBy: { carrier: "asc" } }),
  ]);

  return (
    <Page>
      <PageHeader crumbs={[{ href: "/pickups", label: "รอบรถ" }]} current="เริ่มงาน" title="เริ่มงานรถเข้า" />
      <Panel className="max-w-3xl p-4 sm:p-8">
        <StartPickupForm vehicles={vehicles} carriers={carriers.map((c) => c.carrier!)} />
      </Panel>
    </Page>
  );
}
