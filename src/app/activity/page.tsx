import Link from "next/link";
import { connection } from "next/server";
import { cn } from "cn";
import { db } from "@/lib/db";
import { isAdmin, requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { searchKey } from "@/lib/shipping";
import { DataTable, Empty, HIDE_SM, Page, PageHeader } from "@/components/kit";
import { TableSearch } from "@/components/shipping-filter";
import { TableCell, TableRow } from "@/components/ui/table";

export const metadata = { title: "ประวัติการใช้งาน" };

/** ชื่อการกระทำที่คนอ่านเข้าใจ */
const ACTION_LABEL: Record<string, string> = {
  "auth.login": "เข้าสู่ระบบ",
  "auth.logout": "ออกจากระบบ",
  "pickup.start": "เริ่มงานรถ",
  "pickup.close": "ปิดงานรถ",
  "pickup.reopen": "เปิดงานใหม่",
  "pickup.details": "แก้รายละเอียดรอบรถ",
  "pickup.times": "แก้เวลารอบรถ",
  "pickup.delete": "ลบรอบรถ",
  "manifest.add": "จด manifest",
  "manifest.note": "หมายเหตุ manifest",
  "manifest.remove": "เอา manifest ออก",
  "manifest.create": "สร้างใบนำจ่าย",
  "manifest.delete": "ลบใบนำจ่าย",
  "manifest.fetch": "ดึงเลขแทร็คกิ้ง",
  "manifest.link": "จับคู่ manifest",
  "manifest.statuses": "ดึงสถานะจาก BigSeller",
  "manifest.weight": "ดูน้ำหนักรวม",
  "cage.close": "ปิดกรง",
  "cage.reopen": "ยิงต่อลงกรงเดิม",
  "cage.share": "แบ่งกรง",
  "cage.move": "ย้ายใบไปกรงอื่น",
  "cage.rename": "เปลี่ยนชื่อกรง",
  "flash.api.test": "ทดสอบ Flash Open API",
  "flash.webhook": "ตั้ง webhook Flash",
  "flash.pod": "ดึงหลักฐานส่งถึง (Flash)",
  "share.create": "สร้างลิงก์ดูสถานะ",
  "share.revoke": "ปิดลิงก์ดูสถานะ",
  "sheets.update": "อัปเดตแถวใน Google Sheets",
  "sheets.export": "ส่งไป Google Sheets",
  "parcel.status": "เปลี่ยนสถานะพัสดุ",
  "parcel.reload": "รีโหลดพัสดุจาก BigSeller",
  "bigseller.sync": "Sync ใบนำจ่าย",
  "bigseller.cookie": "แปะ cookie BigSeller",
  "vehicle.create": "เพิ่มรถ",
  "vehicle.edit": "แก้ข้อมูลรถ",
  "vehicle.save": "เพิ่มรถ (มีอยู่แล้ว)",
  "vehicle.enable": "เปิดใช้รถ",
  "vehicle.disable": "ซ่อนรถ",
  "vehicle.delete": "ลบรถ",
  "user.create": "เพิ่มผู้ใช้",
  "auth.register": "สมัครสมาชิก",
  "user.approve": "อนุมัติผู้ใช้",
  "user.reject": "ปฏิเสธผู้สมัคร",
  "user.password": "ตั้งรหัสใหม่",
  "user.enable": "เปิดใช้ผู้ใช้",
  "user.disable": "ปิดใช้ผู้ใช้",
};

/** ลิงก์ไปของที่ถูกแก้ (ถ้ายังมีหน้าให้ดู) */
const targetHref = (type: string | null, id: string | null) =>
  !id ? null : type === "pickup" ? `/pickups/${id}` : type === "manifest" ? `/manifests/${id}` : type === "parcel" ? `/parcels/${id}` : null;

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await connection();
  const [sp, me] = await Promise.all([searchParams, requireUser()]);
  // แอดมินดูของทุกคน (กรองตามคนได้) · คนทั่วไปเห็นเฉพาะของตัวเอง ไม่ว่าจะใส่ ?user= อะไรมา
  const admin = await isAdmin(me);
  const userId = admin ? (typeof sp.user === "string" ? sp.user : undefined) : me.id;
  const [rows, users] = await Promise.all([
    db.activity.findMany({ where: userId ? { userId } : undefined, orderBy: { createdAt: "desc" }, take: 300 }),
    admin ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  const chip = "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm transition-colors";
  return (
    <Page>
      <PageHeader title={admin ? "ประวัติการใช้งาน" : "ประวัติของฉัน"} />

      {/* กรองตามคน — แอดมินเท่านั้น */}
      {admin && (
        <nav className="no-print -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0" aria-label="กรองตามผู้ใช้">
          <Link href="/activity" className={cn(chip, !userId ? "border-brand bg-brand text-white" : "bg-card text-body hover:bg-muted")}>
            ทุกคน
          </Link>
          {users.map((u) => (
            <Link key={u.id} href={`/activity?user=${u.id}`} className={cn(chip, userId === u.id ? "border-brand bg-brand text-white" : "bg-card text-body hover:bg-muted")}>
              {u.name}
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <Empty>ยังไม่มีประวัติ</Empty>
      ) : (
        <>
          <TableSearch scope="activity-rows" placeholder="ค้นหา เช่น ทะเบียน เลขใบ เลขแทร็คกิ้ง" />
          <div id="activity-rows" className="min-w-0">
            <DataTable head={["เวลา", "ใคร", "ทำอะไร", { label: "รายละเอียด", className: HIDE_SM }]}>
              {rows.map((r) => {
                const href = targetHref(r.targetType, r.targetId);
                const label = ACTION_LABEL[r.action] ?? r.action;
                return (
                  <TableRow key={r.id} data-q={searchKey(r.userName, label, r.detail)}>
                    <TableCell className="font-mono text-xs whitespace-nowrap text-body">{fmtDateTime(r.createdAt)}</TableCell>
                    <TableCell className="font-medium">{r.userName}</TableCell>
                    <TableCell>
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {label}
                        </Link>
                      ) : (
                        label
                      )}
                      {/* มือถือ: รายละเอียดอยู่ใต้ชื่อการกระทำ */}
                      {r.detail && <span className="block max-w-[50vw] truncate text-xs text-mute sm:hidden">{r.detail}</span>}
                    </TableCell>
                    <TableCell className={`${HIDE_SM} max-w-md truncate text-[13px] text-body`}>{r.detail ?? "—"}</TableCell>
                  </TableRow>
                );
              })}
            </DataTable>
          </div>
        </>
      )}
    </Page>
  );
}
