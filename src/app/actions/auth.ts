"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { db } from "@/lib/db";
import { audit, endSession, getUser, startSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { normalizeUsername, validateNewUser } from "@/lib/users";

export type AuthState = { error?: string; pending?: string } | undefined;

const field = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** กลับไปหน้าที่ตั้งใจจะเข้า — รับเฉพาะ path ในเว็บเรา (กัน open redirect) */
const safeNext = (v: string) => (v.startsWith("/") && !v.startsWith("//") && !/^\/(login|register)\b/.test(v) ? v : "/");

// ─── กันเดารหัส: ผิดเกิน 5 ครั้งใน 10 นาที → ล็อกชื่อนั้นไว้ 10 นาที (จำในหน่วยความจำของ server)
const WINDOW_MS = 10 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, { n: number; first: number }>();
const locked = (u: string) => {
  const f = fails.get(u);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) return void fails.delete(u), false;
  return f.n >= MAX_FAILS;
};
const recordFail = (u: string) => {
  const f = fails.get(u);
  if (!f || Date.now() - f.first > WINDOW_MS) fails.set(u, { n: 1, first: Date.now() });
  else f.n++;
};

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const username = normalizeUsername(field(form, "username"));
  const password = String(form.get("password") ?? "");
  if (!username || !password) return { error: "กรอกชื่อผู้ใช้และรหัสผ่าน" };
  if (locked(username)) return { error: "ใส่รหัสผิดหลายครั้ง — รอ 10 นาทีแล้วลองใหม่" };

  const user = await db.user.findUnique({ where: { username } });
  // ไม่บอกว่าผิดที่ชื่อหรือรหัส — กันเดาชื่อผู้ใช้
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
    recordFail(username);
    return { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
  }
  fails.delete(username);
  // รหัสถูกแล้ว แต่ยังไม่มีใครอนุมัติ — บอกตรง ๆ ได้ (คนนี้รู้รหัสตัวเองอยู่แล้ว)
  if (!user.approvedAt) return { error: "บัญชียังรอการอนุมัติ — ให้แอดมินกดอนุมัติที่หน้าผู้ใช้" };

  const session = { id: user.id, username: user.username, name: user.name };
  await startSession(session);
  after(() => db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {}));
  audit(session, "auth.login", "user", user.id);
  redirect(safeNext(field(form, "next")));
}

/** รอสมัครค้างได้ไม่เกินเท่านี้ — กันคนยิงสมัครรัว ๆ จนรายการรออนุมัติท่วม */
const MAX_PENDING = 20;

/**
 * สมัครสมาชิก (/register)
 * - ยังไม่มีผู้ใช้สักคน → บัญชีแรกเป็นแอดมิน อนุมัติเลยและเข้าระบบทันที
 * - ไม่งั้น → สร้างแบบรออนุมัติ (STAFF) login ไม่ได้จนกว่าแอดมินจะกดอนุมัติที่หน้าผู้ใช้
 */
export async function register(_: AuthState, form: FormData): Promise<AuthState> {
  if (String(form.get("password") ?? "") !== String(form.get("confirm") ?? "")) return { error: "รหัสผ่านสองช่องไม่ตรงกัน" };
  const res = await validateNewUser(form);
  if ("error" in res) return { error: res.error };

  const [total, pending] = await Promise.all([db.user.count(), db.user.count({ where: { approvedAt: null } })]);
  const first = total === 0;
  if (!first && pending >= MAX_PENDING) return { error: "มีคนรออนุมัติเยอะเกินไป — ติดต่อแอดมินให้อนุมัติก่อน" };

  const user = await db.user.create({
    // บัญชีแรกเป็นแอดมิน ไม่งั้นไม่มีใครอนุมัติคนต่อไปได้
    data: { ...res.data, passwordHash: await hashPassword(res.password), approvedAt: first ? new Date() : null, role: first ? "ADMIN" : "STAFF" },
  });
  const session = { id: user.id, username: user.username, name: user.name };
  audit(session, "auth.register", "user", user.id, first ? `${user.name} (บัญชีแรก อนุมัติอัตโนมัติ)` : `${user.name} (รออนุมัติ)`);

  if (first) {
    await startSession(session);
    redirect("/");
  }
  return { pending: `สมัครแล้ว — รอแอดมินอนุมัติ แล้วจึง login ด้วย @${user.username}` };
}

export async function logout() {
  const user = await getUser();
  if (user) audit(user, "auth.logout", "user", user.id);
  await endSession();
  redirect("/login");
}
