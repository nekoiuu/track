"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ADMIN_ONLY, audit, isAdmin, requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { checkPassword, validateNewUser } from "@/lib/users";

export type UserFormState = { ok?: string; error?: string } | undefined;

export async function createUser(_: UserFormState, form: FormData): Promise<UserFormState> {
  const me = await requireUser();
  if (!(await isAdmin(me))) return { error: ADMIN_ONLY };
  const res = await validateNewUser(form);
  if ("error" in res) return { error: res.error };
  // คนในระบบเพิ่มให้เอง = อนุมัติแล้ว
  const u = await db.user.create({ data: { ...res.data, passwordHash: await hashPassword(res.password), approvedAt: new Date() } });
  audit(me, "user.create", "user", u.id, `${u.name} (@${u.username})`);
  revalidatePath("/users");
  return { ok: `เพิ่ม ${u.name} แล้ว` };
}

export async function resetPassword(id: string, _: UserFormState, form: FormData): Promise<UserFormState> {
  const me = await requireUser();
  if (!(await isAdmin(me))) return { error: ADMIN_ONLY };
  const password = String(form.get("password") ?? "");
  const err = checkPassword(password);
  if (err) return { error: err };
  const u = await db.user.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
  audit(me, "user.password", "user", id, u.name);
  return { ok: `ตั้งรหัสใหม่ให้ ${u.name} แล้ว` };
}

/** ปิดใช้ = login ไม่ได้ (ประวัติที่เคยทำยังอยู่ครบ) */
export async function setUserActive(id: string, active: boolean): Promise<UserFormState> {
  const me = await requireUser();
  if (!(await isAdmin(me))) return { error: ADMIN_ONLY };
  if (id === me.id && !active) return { error: "ปิดใช้บัญชีตัวเองไม่ได้" };
  const u = await db.user.update({ where: { id }, data: { active } });
  audit(me, active ? "user.enable" : "user.disable", "user", id, u.name);
  revalidatePath("/users");
  return { ok: `${active ? "เปิดใช้" : "ปิดใช้"} ${u.name} แล้ว` };
}

/** อนุมัติคนที่สมัครเองจากหน้า /register — หลังจากนี้ login ได้ */
export async function approveUser(id: string): Promise<UserFormState> {
  const me = await requireUser();
  if (!(await isAdmin(me))) return { error: ADMIN_ONLY };
  const u = await db.user.update({ where: { id }, data: { approvedAt: new Date(), active: true } });
  audit(me, "user.approve", "user", id, `${u.name} (@${u.username})`);
  revalidatePath("/users");
  return { ok: `อนุมัติ ${u.name} แล้ว` };
}

/** ปฏิเสธคำขอสมัคร — ลบทิ้ง (เฉพาะที่ยังไม่อนุมัติ ลบผู้ใช้ที่ใช้งานอยู่ไม่ได้) */
export async function rejectUser(id: string): Promise<UserFormState> {
  const me = await requireUser();
  if (!(await isAdmin(me))) return { error: ADMIN_ONLY };
  const u = await db.user.findUnique({ where: { id } });
  if (!u || u.approvedAt) return { error: "ปฏิเสธได้เฉพาะคนที่ยังรออนุมัติ" };
  await db.user.delete({ where: { id } });
  audit(me, "user.reject", "user", id, `${u.name} (@${u.username})`);
  revalidatePath("/users");
  return { ok: `ปฏิเสธ ${u.name} แล้ว` };
}
