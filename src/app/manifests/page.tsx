import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDateTime, normalizeCode } from "@/lib/format";
import { Trash2Icon } from "lucide-react";
import { deleteManifest, runDeleteOrphanManifests } from "@/app/actions/manifests";
import { refetchRecentManifests } from "@/app/actions/pickups";
import { ConfirmButton, SyncButton } from "@/components/client-actions";
import { orphanManifestWhere } from "@/lib/manifests";
import { DataTable, Empty, Mono, Notice, Page, PageHeader, Pill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "ใบนำจ่าย" };

export default async function ManifestsPage({ searchParams }: PageProps<"/manifests">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? normalizeCode(sp.q) : "";

  // ใบค้างจากการลบรอบรถ (เคยจดกับรถ แต่ตอนนี้ไม่มีรถคันไหน)
  const orphanP = db.manifest.count({ where: orphanManifestWhere });
  const manifests = await db.manifest.findMany({
    // เฉพาะใบที่ขึ้นรถแล้ว — ใบอื่นอยู่ใน BigSeller ไม่ต้องเก็บ
    where: { pickups: { some: {} }, ...(q ? { manifestNo: { contains: q } } : {}) },
    orderBy: [{ printedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 100,
    include: {
      _count: { select: { parcels: true } },
      pickups: { include: { pickup: { select: { id: true, plate: true, arrivedAt: true } } } },
    },
  });

  return (
    <Page>

      <PageHeader
        title="ใบนำจ่ายที่ขึ้นรถ"
        actions={
          // จับคู่ใบใหม่ (เลขต้นที่ต่อผิด) + ดึงเลขแทร็คกิ้งทุกใบจาก BigSeller ใหม่ — ทุกรอบรถใน 2 วันล่าสุด
          <SyncButton action={refetchRecentManifests.bind(null, 2)} label="ดึงเลขแทร็คใหม่ทั้งหมด (2 วัน)" variant="outline" />
        }
      />

      <OrphanNotice count={await orphanP} />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="เลขใบ หรือ 4 หลักท้าย" className="w-60 bg-card font-mono" />
          <Button type="submit" variant="outline">
            ค้นหา
          </Button>
        </form>
      </div>

      {manifests.length === 0 ? (
        <Empty>{q ? "ไม่พบใบนี้ในใบที่ขึ้นรถ" : "ยังไม่มีใบที่ขึ้นรถ — จดเลขใบตอนรถเข้ารับ ระบบดึงจาก BigSeller ให้เอง"}</Empty>
      ) : (
        <DataTable head={["เลขใบ", "พิมพ์เมื่อ", "ขนส่ง", "พัสดุ", "รถที่รับ", "ที่มา", ""]}>
          {manifests.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <Link href={`/manifests/${m.id}`} className="hover:underline">
                  <Mono>
                    {m.manifestNo.slice(0, -4)}
                    <b>{m.manifestNo.slice(-4)}</b>
                  </Mono>
                </Link>
              </TableCell>
              <TableCell className="tabular text-body">{fmtDateTime(m.printedAt)}</TableCell>
              <TableCell className="text-body">{m.logisticsName ?? "—"}</TableCell>
              <TableCell className="tabular">{m._count.parcels}</TableCell>
              <TableCell>
                {m.pickups.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {m.pickups.map((pm) => (
                      <Link key={pm.id} href={`/pickups/${pm.pickup.id}`} className="hover:underline">
                        {pm.pickup.plate}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                <Pill>{m.source === "manual" ? "สร้างเอง" : "BigSeller"}</Pill>
              </TableCell>
              <TableCell className="w-10 text-right">
                    <ConfirmButton
                      action={deleteManifest.bind(null, m.id)}
                      label={<Trash2Icon />}
                      variant="ghost"
                      size="icon-sm"
                      title={`ลบใบ ${m.manifestNo}?`}
                      description={m.pickups.length ? `ใบนี้จดอยู่ในรอบรถ ${m.pickups.length} รอบ — จะถูกเอาออกจากรอบรถเหล่านั้นด้วย พร้อมเลขแทร็คกิ้งในใบ` : "ลบใบนี้และเลขแทร็คกิ้งในใบ"}
                      confirmLabel="ลบ"
                      done={`ลบใบ ${m.manifestNo} แล้ว`}
                    />
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      )}
    </Page>
  );
}

/** ใบที่ไม่มีรถรับ (ค้างจาก sync แบบเก่า / ลบรอบรถ) — กดลบทีเดียวทั้งหมด (เลขแทร็คในใบหายด้วย) */
function OrphanNotice({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="mb-6">
      <Notice tone="amber">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0">
            ในระบบมีใบที่ไม่มีรถรับค้างอยู่ <b className="tabular">{count.toLocaleString()}</b> ใบ — ไม่ต้องเก็บแล้ว (ดูได้ใน BigSeller) · ใบที่ส่งไปจริงให้จดเข้ารอบรถ
          </p>
          <ConfirmButton
            action={runDeleteOrphanManifests}
            label={
              <>
                <Trash2Icon />
                ลบใบที่ไม่มีรถรับ
              </>
            }
            title={`ลบ ${count.toLocaleString()} ใบที่ไม่มีรถรับ?`}
            description="เลขแทร็คกิ้งในใบเหล่านี้หายด้วย — จดเลขใบเข้ารอบรถเมื่อไหร่ ระบบดึงจาก BigSeller ให้ใหม่"
            confirmLabel="ลบ"
            done="ลบแล้ว"
          />
        </div>
      </Notice>
    </div>
  );
}
