import { connection } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { publicBase } from "@/lib/share";
import { revokeShareLink } from "@/app/actions/share";
import { ConfirmButton } from "@/components/client-actions";
import { DataTable, Empty, HIDE_SM, Page, PageHeader, Pill } from "@/components/kit";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "ลิงก์ที่แชร์" };

/** ลิงก์สาธารณะทั้งหมด — ดูว่ามีคนเปิดไหม · ปิดลิงก์ที่ไม่ใช้แล้ว (คนที่มีลิงก์จะเปิดไม่ได้อีก) */
export default async function LinksPage() {
  await connection();
  const [links, base] = await Promise.all([db.shareLink.findMany({ orderBy: { createdAt: "desc" }, take: 200 }), publicBase()]);

  return (
    <Page>
      <PageHeader
        crumbs={[{ href: "/tracking", label: "ติดตามสถานะ" }]}
        current="ลิงก์ที่แชร์"
        title="ลิงก์ที่แชร์"
        description="เปิดได้โดยไม่ต้อง login · สร้างจากหน้าติดตามสถานะ (ลิงก์เคสนี้) หรือติ๊กเลือกพัสดุแล้วกด “ลิงก์”"
      />
      {links.length === 0 ? (
        <Empty>ยังไม่มีลิงก์ที่แชร์</Empty>
      ) : (
        <DataTable head={["ชื่อ", { label: "สร้างเมื่อ", className: HIDE_SM }, { label: "เปิดดู", className: HIDE_SM }, ""]}>
          {links.map((l) => {
            const url = `${base}/share/${l.slug}`;
            return (
              <TableRow key={l.id} className={l.revokedAt ? "opacity-50" : ""}>
                <TableCell className="max-w-0 min-w-0">
                  <p className="truncate font-medium">{l.title}</p>
                  {l.revokedAt ? (
                    <p className="text-xs text-mute">ปิดแล้ว {fmtDateTime(l.revokedAt)}</p>
                  ) : (
                    <a href={url} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-link hover:underline">
                      {url}
                    </a>
                  )}
                </TableCell>
                <TableCell className={`${HIDE_SM} text-[13px] text-body`}>
                  {fmtDateTime(l.createdAt)}
                  <span className="block text-xs text-mute">
                    {l.createdBy ?? "—"} · {l.kind === "case" ? "เคส (อัปเดตเอง)" : `${l.parcelIds.length} ชิ้น`}
                  </span>
                </TableCell>
                <TableCell className={`${HIDE_SM} text-[13px] text-body`}>
                  {l.views} ครั้ง
                  {l.lastViewedAt && <span className="block text-xs text-mute">ล่าสุด {fmtDateTime(l.lastViewedAt)}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {l.revokedAt ? (
                    <Pill>ปิดแล้ว</Pill>
                  ) : (
                    <ConfirmButton
                      action={revokeShareLink.bind(null, l.id)}
                      label="ปิดลิงก์"
                      variant="outline"
                      title={`ปิดลิงก์ “${l.title}”?`}
                      description="คนที่มีลิงก์จะเปิดดูไม่ได้อีก (ลิงก์ในแถวของ Sheets ทีละชิ้นยังใช้ได้)"
                      confirmLabel="ปิดลิงก์"
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </DataTable>
      )}
    </Page>
  );
}
