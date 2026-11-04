import Link from "next/link";
import type { ReactNode } from "react";
import { Panel } from "@/components/kit";
import { Logo } from "@/components/logo";

/** กรอบหน้า login / สมัคร — โลโก้ หัวข้อ ฟอร์ม และลิงก์สลับไปอีกหน้า */
export function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: { text: string; href: string; label: string } }) {
  return (
    <div className="mx-auto grid min-h-[70vh] max-w-sm content-center">
      <div className="mb-8">
        <Logo />
        <p className="mt-2 text-xs tracking-wide text-mute">Track · Transit · Deliver</p>
      </div>
      <h1 className="mb-6 text-[24px] leading-8 font-semibold tracking-[-1px] sm:text-[28px] sm:leading-9">{title}</h1>
      <Panel className="p-5 sm:p-6">{children}</Panel>
      {footer && (
        <p className="mt-6 text-center text-sm text-body">
          {footer.text}{" "}
          <Link href={footer.href} className="inline-flex h-10 items-center font-medium text-brand underline-offset-4 hover:underline">
            {footer.label}
          </Link>
        </p>
      )}
    </div>
  );
}
