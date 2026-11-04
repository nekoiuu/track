"use client";

import { useActionState } from "react";
import { Loader2Icon } from "lucide-react";
import { login, type AuthState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/kit";

/** ช่องกรอก text-base (16px) กัน iOS ซูมตอนแตะ */
export const authInputClass = "h-12 bg-card text-base";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="ชื่อผู้ใช้" htmlFor="username">
        <Input id="username" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" autoFocus required className={authInputClass} />
      </Field>
      <Field label="รหัสผ่าน" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required className={authInputClass} />
      </Field>
      {state?.error && (
        <p className="text-sm text-error-deep" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-12 text-base" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}
