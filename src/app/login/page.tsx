import { redirect } from "next/navigation";
import { connection } from "next/server";
import { db } from "@/lib/db";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  await connection();
  const [sp, users] = await Promise.all([searchParams, db.user.count()]);
  // ยังไม่มีใครในระบบ — ไปสร้างบัญชีแรกที่หน้าสมัคร
  if (users === 0) redirect("/register");
  const next = typeof sp.next === "string" ? sp.next : undefined;

  return (
    <AuthShell title="เข้าสู่ระบบ" footer={{ text: "ยังไม่มีบัญชี?", href: "/register", label: "สมัครสมาชิก" }}>
      <LoginForm next={next} />
    </AuthShell>
  );
}
