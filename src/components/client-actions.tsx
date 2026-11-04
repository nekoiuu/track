"use client";

import { useActionState, useEffect, useTransition, type ComponentProps } from "react";
import { Loader2Icon, PrinterIcon } from "lucide-react";
import { toast } from "sonner";
import type { SyncState } from "@/app/actions/manifests";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./kit";

type Variant = ComponentProps<typeof Button>["variant"];

/** ปุ่มที่เรียก server action แล้วโชว์ผลเป็น toast (ใช้กับ sync) */
export function SyncButton({ action, label, variant = "default" }: { action: () => Promise<SyncState>; label: string; variant?: Variant }) {
  const [state, run, pending] = useActionState(action, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message, { duration: 10_000 });
  }, [state]);

  return (
    <form action={run}>
      <Button type="submit" variant={variant} disabled={pending}>
        {pending && <Loader2Icon className="animate-spin" />}
        {pending ? "กำลังทำงาน…" : label}
      </Button>
    </form>
  );
}

/** แปะ cookie BigSeller ใหม่ — ใช้ได้ทันทีไม่ต้องรีสตาร์ท */
export function CookieForm({ action }: { action: (s: SyncState, f: FormData) => Promise<SyncState> }) {
  const [state, run, pending] = useActionState(action, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message, { duration: 10_000 });
  }, [state]);

  return (
    <form action={run} className="grid gap-3">
      <Field
        label="แปะ cookie ใหม่"
        htmlFor="cookie"
        hint="DevTools → Network → request ไหนก็ได้ของ bigseller.com → Request Headers → cookie → Copy value"
      >
        <Textarea
          id="cookie"
          name="cookie"
          rows={3}
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="JSESSIONID=…; muc_token=…; …"
          className="font-mono text-xs"
        />
      </Field>
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />}
          {pending ? "กำลังบันทึกและทดสอบ…" : "บันทึกและทดสอบ"}
        </Button>
      </div>
    </form>
  );
}

export function PrintButton() {
  return (
    <Button type="button" variant="outline" onClick={() => window.print()}>
      <PrinterIcon />
      พิมพ์ / PDF
    </Button>
  );
}

/** ปุ่มที่ถามก่อนทำ (ลบ ฯลฯ) */
export function ConfirmButton({
  action,
  label,
  title,
  description,
  confirmLabel = "ยืนยัน",
  variant = "destructive",
  size = "default",
  done,
}: {
  action: () => Promise<unknown>;
  label: React.ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  variant?: Variant;
  size?: ComponentProps<typeof Button>["size"];
  done?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={pending}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              start(async () => {
                const res = (await action()) as { error?: string } | undefined;
                if (res?.error) toast.error(res.error);
                else if (done) toast(done);
              })
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
