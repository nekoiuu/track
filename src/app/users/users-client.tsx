"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { CheckIcon, KeyRoundIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { approveUser, createUser, rejectUser, resetPassword, setUserActive, type UserFormState } from "@/app/actions/users";
import { Field } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const inputClass = "h-11 bg-card text-base sm:text-sm";

/** โชว์ผลเป็น toast และบอกว่าสำเร็จหรือยัง */
function useResult(state: UserFormState, onOk?: () => void) {
  useEffect(() => {
    if (state?.error) toast.error(state.error);
    if (state?.ok) {
      toast.success(state.ok);
      onOk?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ทำเฉพาะตอนได้ผลใหม่
  }, [state]);
}

export function AddUserForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(createUser, undefined);
  useResult(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <Field label="ชื่อที่แสดง" htmlFor="nu-name">
        <Input id="nu-name" name="name" placeholder="เช่น เจมส์" className={inputClass} />
      </Field>
      <Field label="ชื่อผู้ใช้" htmlFor="nu-username">
        <Input id="nu-username" name="username" required autoCapitalize="none" autoCorrect="off" placeholder="a-z 0-9" className={inputClass} />
      </Field>
      <Field label="รหัสผ่าน" htmlFor="nu-password">
        <Input id="nu-password" name="password" type="password" required minLength={6} autoComplete="new-password" className={inputClass} />
      </Field>
      <Button type="submit" className="h-11" disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        เพิ่มผู้ใช้
      </Button>
    </form>
  );
}

export function ResetPasswordButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resetPassword.bind(null, id), undefined);
  useResult(state, () => setOpen(false));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9">
          <KeyRoundIcon />
          ตั้งรหัสใหม่
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ตั้งรหัสใหม่ให้ {name}</DialogTitle>
        </DialogHeader>
        <form action={action} className="grid gap-3">
          <Input name="password" type="password" required minLength={6} autoFocus autoComplete="new-password" placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัว)" className={inputClass} />
          <Button type="submit" className="h-11" disabled={pending}>
            บันทึก
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToggleActiveButton({ id, active, self }: { id: string; active: boolean; self: boolean }) {
  const [pending, start] = useTransition();
  if (self) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className={active ? "h-9 text-error-deep" : "h-9"}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setUserActive(id, !active);
          if (r?.error) toast.error(r.error);
          else if (r?.ok) toast.success(r.ok);
        })
      }
    >
      {active ? "ปิดใช้" : "เปิดใช้"}
    </Button>
  );
}

/** อนุมัติ / ปฏิเสธ คนที่สมัครเอง — ปุ่มใหญ่ กดง่ายบนมือถือ */
export function ApproveButtons({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  const run = (fn: typeof approveUser) =>
    start(async () => {
      const r = await fn(id);
      if (r?.error) toast.error(r.error);
      else if (r?.ok) toast.success(r.ok);
    });
  return (
    <div className="flex gap-2">
      <Button className="h-10" disabled={pending} onClick={() => run(approveUser)} aria-label={`อนุมัติ ${name}`}>
        <CheckIcon />
        อนุมัติ
      </Button>
      <Button variant="outline" className="h-10 text-error-deep" disabled={pending} onClick={() => run(rejectUser)} aria-label={`ปฏิเสธ ${name}`}>
        <XIcon />
        ปฏิเสธ
      </Button>
    </div>
  );
}
