import { connection } from "next/server";
import { db } from "@/lib/db";
import { AuthShell } from "@/app/login/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata = { title: "สมัครสมาชิก" };

export default async function RegisterPage() {
  await connection();
  const first = (await db.user.count()) === 0;

  return (
    <AuthShell
      title={first ? "สร้างบัญชีแรก" : "สมัครสมาชิก"}
      footer={first ? undefined : { text: "มีบัญชีแล้ว?", href: "/login", label: "เข้าสู่ระบบ" }}
    >
      <RegisterForm first={first} />
    </AuthShell>
  );
}
