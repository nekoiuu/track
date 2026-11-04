import "server-only";
import { db } from "./db";

export const normalizeUsername = (s: string) => s.trim().toLowerCase();

/** ตรวจข้อมูลผู้ใช้ใหม่ — ใช้ทั้งตอนสร้างบัญชีแรกและหน้าจัดการผู้ใช้ */
export async function validateNewUser(form: FormData) {
  const username = normalizeUsername(String(form.get("username") ?? ""));
  const name = String(form.get("name") ?? "").trim() || username;
  const password = String(form.get("password") ?? "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return { error: "ชื่อผู้ใช้ 3-32 ตัว ใช้ a-z 0-9 . _ - เท่านั้น" };
  const pwError = checkPassword(password);
  if (pwError) return { error: pwError };
  if (await db.user.findUnique({ where: { username } })) return { error: `มีชื่อผู้ใช้ ${username} แล้ว` };
  return { data: { username, name: name.slice(0, 60) }, password };
}

export const checkPassword = (pw: string) => (pw.length < 6 ? "รหัสผ่านอย่างน้อย 6 ตัว" : null);
