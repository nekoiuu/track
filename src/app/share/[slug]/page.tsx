import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after, connection } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { SHARE_MAX, shareSelect, shareWhere } from "@/lib/share";
import { Empty, Page } from "@/components/kit";
import { ShareHeader, ShareList } from "../share-view";
import { ShareRefresh } from "../share-refresh";

// ลิงก์ส่วนตัว — ไม่ให้ search engine เก็บ
export const metadata: Metadata = { title: "ติดตามพัสดุ", robots: { index: false, follow: false } };

/**
 * ลิงก์สาธารณะดูสถานะพัสดุทั้งชุด (ไม่ต้อง login — ยกเว้นไว้ใน src/proxy.ts)
 * เปิดแล้วเช็ค Flash ให้เอง (ShareRefresh) เฉพาะชิ้นที่ข้อมูลเก่ากว่า 30 นาที
 */
export default async function SharePage({ params }: PageProps<"/share/[slug]">) {
  await connection();
  const { slug } = await params;
  const link = await db.shareLink.findUnique({ where: { slug } });
  if (!link || link.revokedAt) notFound();

  const parcels = await db.manifestParcel.findMany({
    where: await shareWhere(link),
    orderBy: [{ flashRoutedAt: { sort: "desc", nulls: "last" } }, { trackingNo: "asc" }],
    take: SHARE_MAX,
    select: shareSelect,
  });
  const checked = parcels.reduce<Date | null>((d, p) => (p.flashFetchedAt && (!d || p.flashFetchedAt > d) ? p.flashFetchedAt : d), null);

  // นับคนเปิด — หลังส่งหน้าแล้ว ไม่ให้หน้าช้า
  after(() => db.shareLink.update({ where: { id: link.id }, data: { views: { increment: 1 }, lastViewedAt: new Date() } }).catch(() => null));

  return (
    <Page>
      <ShareHeader
        title={link.title}
        sub={
          <>
            {parcels.length} ชิ้น{checked && ` · เช็ค Flash ล่าสุด ${fmtDateTime(checked)}`}
            {link.kind === "case" && " · รายการอัปเดตตามสถานะปัจจุบัน"}
            <ShareRefresh slug={slug} />
          </>
        }
      />
      {parcels.length === 0 ? <Empty>ไม่มีพัสดุในลิงก์นี้แล้ว</Empty> : <ShareList parcels={parcels} />}
    </Page>
  );
}
