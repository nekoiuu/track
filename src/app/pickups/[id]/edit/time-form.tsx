"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/pickups";
import { Field } from "@/components/kit";
import { useActionToast } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TimeCorrectionForm({
  action,
  arrivedAt,
  departedAt,
  backHref,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  arrivedAt: string;
  departedAt: string;
  backHref: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  useActionToast(state);

  return (
    <form action={run} className="grid gap-5">
      <Field label="เวลาเริ่มงาน *" htmlFor="t-start">
        <Input id="t-start" type="datetime-local" name="arrivedAt" required defaultValue={arrivedAt} />
      </Field>
      <Field label="เวลาปิดงาน" htmlFor="t-end" hint="เว้นว่าง = ยังไม่ปิดงาน (สถานะกำลังทำ)">
        <Input id="t-end" type="datetime-local" name="departedAt" defaultValue={departedAt} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึกเวลา"}
        </Button>
        <Button asChild variant="ghost">
          <Link href={backHref}>ยกเลิก</Link>
        </Button>
      </div>
    </form>
  );
}
