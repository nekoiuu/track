import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { pickupScope } from "@/lib/pickup-access";
import { fmtDateTime, normalizeCode } from "@/lib/format";
import { DataTable, Empty, Mono, Page, PageHeader, ParcelStatusPill, SectionTitle } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "ค้นหา" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const raw = typeof sp.q === "string" ? sp.q.trim() : "";
  const code = normalizeCode(raw);
  // รอบรถ: staff เห็นเฉพาะงานของตัวเอง · พัสดุ/ใบนำจ่าย ค้นได้ทั้งร้าน
  const mine = raw ? await pickupScope(await requireUser()) : {};

  const [parcels, manifests, pickups] = raw
    ? await Promise.all([
        db.manifestParcel.findMany({
          where: { OR: [{ trackingNo: { contains: code } }, { orderNo: { contains: code } }] },
          take: 50,
          include: { manifest: { include: { pickups: { include: { pickup: true } } } } },
        }),
        db.manifest.findMany({ where: { manifestNo: { contains: code } }, take: 20, orderBy: { printedAt: "desc" } }),
        db.pickup.findMany({
          where: { ...mine, plate: { contains: raw, mode: "insensitive" } },
          take: 20,
          orderBy: { arrivedAt: "desc" },
        }),
      ])
    : [[], [], []];

  const none = raw && !parcels.length && !manifests.length && !pickups.length;

  return (
    <Page>

      <PageHeader title="ค้นหา" />
      <form className="mb-10 flex gap-2">
        <Input name="q" defaultValue={raw} autoFocus className="h-12 bg-card text-base" />
        <Button type="submit" size="lg" className="h-12 px-6">
          ค้นหา
        </Button>
      </form>

      {none && <Empty>ไม่พบ “{raw}”</Empty>}

      {parcels.length > 0 && (
        <section className="mb-10">
          <SectionTitle>พัสดุ</SectionTitle>
          <DataTable head={["เลขแทร็คกิ้ง", "ออเดอร์", "ใบนำจ่าย", "รถที่รับ", "สถานะ"]}>
            {parcels.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/parcels/${p.id}`} className="font-mono text-[13px] hover:underline">
                    {p.trackingNo}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-[13px] text-body">{p.orderNo ?? "—"}</TableCell>
                <TableCell>
                  <Link href={`/manifests/${p.manifest.id}`} className="font-mono text-[13px] hover:underline">
                    {p.manifest.manifestNo}
                  </Link>
                </TableCell>
                <TableCell className="text-body">
                  {p.manifest.pickups.map(({ pickup: pk }) => (
                    <Link key={pk.id} href={`/pickups/${pk.id}`} className="block hover:underline">
                      {pk.plate} · {fmtDateTime(pk.arrivedAt)}
                    </Link>
                  ))}
                  {!p.manifest.pickups.length && "—"}
                </TableCell>
                <TableCell>
                  <ParcelStatusPill status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </section>
      )}

      {manifests.length > 0 && (
        <section className="mb-10">
          <SectionTitle>ใบนำจ่าย</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {manifests.map((m) => (
              <Link key={m.id} href={`/manifests/${m.id}`} className="rounded-sm bg-canvas px-3 py-2 shadow-card hover:shadow-float">
                <Mono>{m.manifestNo}</Mono> <span className="text-xs text-mute">{fmtDateTime(m.printedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {pickups.length > 0 && (
        <section>
          <SectionTitle>รอบรถ</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {pickups.map((p) => (
              <Link key={p.id} href={`/pickups/${p.id}`} className="rounded-sm bg-canvas px-3 py-2 shadow-card hover:shadow-float">
                <span className="font-medium">{p.plate}</span> <span className="text-xs text-mute">{fmtDateTime(p.arrivedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </Page>
  );
}
