import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePickupPage } from "@/lib/pickup-access";
import { toLocalInput } from "@/lib/format";
import { correctPickupTimes } from "@/app/actions/pickups";
import { Page, PageHeader, Panel } from "@/components/kit";
import { TimeCorrectionForm } from "./time-form";

export const metadata = { title: "แก้เวลารอบรถ" };

/** แก้เวลา — ใช้เฉพาะตอนลืมกดเริ่ม/ปิดงาน ปกติระบบลงเวลาให้เอง */
export default async function EditPickupPage({ params }: PageProps<"/pickups/[id]/edit">) {
  const { id } = await params;
  const [, pickup] = await Promise.all([requirePickupPage(id), db.pickup.findUnique({ where: { id } })]);
  if (!pickup) notFound();

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/pickups", label: "รอบรถ" }, { href: `/pickups/${id}`, label: pickup.plate }]}
        current="แก้เวลา"
        title={`แก้เวลา ${pickup.plate}.`}
      />
      <Panel className="max-w-xl p-6 sm:p-8">
        <TimeCorrectionForm
          action={correctPickupTimes.bind(null, id)}
          arrivedAt={toLocalInput(pickup.arrivedAt)}
          departedAt={toLocalInput(pickup.departedAt)}
          backHref={`/pickups/${id}`}
        />
      </Panel>
    </Page>
  );
}
