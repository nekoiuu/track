"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { register, type AuthState } from "@/app/actions/auth";
import { authInputClass } from "@/app/login/login-form";
import { Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function RegisterForm({ first }: { first: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(register, undefined);

  // สมัครเสร็จ รออนุมัติ — ไม่ต้องโชว์ฟอร์มอีก
  if (state?.pending) {
    return (
      <div className="grid gap-4 text-center">
        <CheckCircle2Icon className="mx-auto size-10 text-teal-deep" />
        <p className="text-body">{state.pending}</p>
        <Button asChild variant="outline" className="h-12 text-base">
          <Link href="/login">ไปหน้าเข้าสู่ระบบ</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4">
      <Field label="ชื่อที่แสดง" htmlFor="name">
        <Input id="name" name="name" placeholder="เช่น เจมส์" autoComplete="name" autoFocus className={authInputClass} />
      </Field>
      <Field label="ชื่อผู้ใช้ (ใช้ login)" htmlFor="username">
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" required placeholder="a-z 0-9" className={authInputClass} />
      </Field>
      <Field label="รหัสผ่าน" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={6} required className={authInputClass} />
      </Field>
      <Field label="ยืนยันรหัสผ่าน" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={6} required className={authInputClass} />
      </Field>
      {state?.error && (
        <p className="text-sm text-error-deep" role="alert">
          {state.error}
        </p>
      )}
      {!first && <p className="text-xs text-mute">สมัครแล้วต้องรอแอดมินอนุมัติก่อนจึงเข้าใช้ได้</p>}
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        {first ? "สร้างบัญชีแรกและเข้าสู่ระบบ" : "สมัครสมาชิก"}
      </Button>
    </form>
  );
}
