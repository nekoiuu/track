import { connection } from "next/server";
import { db } from "@/lib/db";
import { getUser, isAdmin } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { DataTable, HIDE_SM, Notice, Page, PageHeader, Panel, Pill, SectionTitle } from "@/components/kit";
import { TableCell, TableRow } from "@/components/ui/table";
import { AddUserForm, ApproveButtons, ResetPasswordButton, ToggleActiveButton } from "./users-client";

export const metadata = { title: "ผู้ใช้" };

export default async function UsersPage() {
  await connection();
  const me = await getUser();
  // จัดการผู้ใช้ / ดูข้อมูลคนอื่น — แอดมินเท่านั้น
  if (!(await isAdmin(me))) {
    return (
      <Page>
        <PageHeader title="ผู้ใช้" />
        <Notice>หน้านี้สำหรับแอดมินเท่านั้น</Notice>
      </Page>
    );
  }
  const users = await db.user.findMany({
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    select: { id: true, username: true, name: true, role: true, active: true, approvedAt: true, lastLoginAt: true, createdAt: true },
  });
  const waiting = users.filter((u) => !u.approvedAt);
  const members = users.filter((u) => u.approvedAt);

  return (
    <Page>
      <PageHeader title="ผู้ใช้" />

      {/* คนที่สมัครเองจาก /register — แอดมินกดอนุมัติก่อนจึง login ได้ */}
      {waiting.length > 0 && (
        <section className="mb-10">
          <SectionTitle aside={<Pill tone="amber">{waiting.length} คน</Pill>}>รออนุมัติ</SectionTitle>
          <div className="grid gap-2">
            {waiting.map((u) => (
              <Panel key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4 ring-1 ring-warning/50">
                <div className="min-w-0">
                  <p className="font-medium">{u.name}</p>
                  <p className="font-mono text-xs text-mute">
                    @{u.username} · สมัคร {fmtDateTime(u.createdAt)}
                  </p>
                </div>
                <ApproveButtons id={u.id} name={u.name} />
              </Panel>
            ))}
          </div>
        </section>
      )}

      <SectionTitle>เพิ่มผู้ใช้</SectionTitle>
      <Panel className="mb-10 p-5 sm:p-6">
        <AddUserForm />
      </Panel>

      <SectionTitle>ทั้งหมด ({members.length})</SectionTitle>
      <DataTable head={["ชื่อ", { label: "login ล่าสุด", className: HIDE_SM }, "สถานะ", ""]}>
        {members.map((u) => (
          <TableRow key={u.id} className={u.active ? "" : "opacity-60"}>
            <TableCell>
              <span className="font-medium">{u.name}</span>
              {u.id === me!.id && <span className="ml-1.5 text-xs text-mute">(คุณ)</span>}
              <span className="block font-mono text-xs text-mute">@{u.username}</span>
            </TableCell>
            <TableCell className={`${HIDE_SM} tabular text-body`}>{u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : "—"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {u.role === "ADMIN" && <Pill tone="violet">แอดมิน</Pill>}
                {u.active ? <Pill tone="green">ใช้งาน</Pill> : <Pill>ปิดใช้</Pill>}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex flex-wrap justify-end gap-1">
                <ResetPasswordButton id={u.id} name={u.name} />
                <ToggleActiveButton id={u.id} active={u.active} self={u.id === me!.id} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTable>
    </Page>
  );
}
