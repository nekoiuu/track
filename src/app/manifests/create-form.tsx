"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/pickups";
import { useActionToast } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateManifestForm({
  action,
  prefix,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  prefix?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  useActionToast(state);
  return (
    <form action={run} className="flex gap-2">
        <Input
          name="manifestNo"
          placeholder={prefix ? `${prefix}____ (ใส่ 4 หลักท้าย)` : "MFG963072007"}
          className="w-64 bg-card font-mono"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          + สร้างใบเอง
        </Button>
    </form>
  );
}
