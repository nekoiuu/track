import Link from "next/link";
import { ViewTransition, type ComponentProps, type ReactNode } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ParcelStatus, PickupStatus } from "@/generated/prisma/enums";

/**
 * ชุด component ของแอป — ประกอบจาก shadcn (./ui/*) + โทเคนของ DESIGN.md
 * หน้าไหนก็ห่อด้วย <Page> เพื่อให้มี transition ตอนเปลี่ยนหน้า
 */

export function Page({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

export type Crumb = { href: string; label: ReactNode };

/**
 * เส้นทางกลับ — มือถือโชว์ปุ่ม "‹ หน้าก่อน" ปุ่มเดียวให้กดง่าย · จอใหญ่โชว์ครบทุกชั้น
 * @param items หน้าแม่เรียงจากบนสุด (ไม่รวมหน้าปัจจุบัน)
 * @param current ชื่อหน้าปัจจุบัน (จอใหญ่เท่านั้น)
 */
export function Breadcrumbs({ items, current }: { items: Crumb[]; current?: ReactNode }) {
  const parent = items.at(-1);
  if (!parent) return null;
  return (
    <nav aria-label="breadcrumb" className="no-print mb-3">
      <Link
        href={parent.href}
        className="-ml-2 inline-flex h-10 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm text-body active:bg-muted sm:hidden"
      >
        <ChevronLeftIcon className="size-5" />
        {parent.label}
      </Link>
      <ol className="hidden flex-wrap items-center gap-1 text-sm text-mute sm:flex">
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1">
            <Link href={c.href} className="hover:text-ink hover:underline">
              {c.label}
            </Link>
            <ChevronRightIcon className="size-3.5" />
          </li>
        ))}
        {current && <li className="max-w-[40ch] truncate text-ink">{current}</li>}
      </ol>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  crumbs,
  current,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** หน้าแม่สำหรับปุ่มกลับ (ดู Breadcrumbs) */
  crumbs?: Crumb[];
  /** ชื่อหน้านี้ในเส้นทาง — ไม่ใส่ก็ได้ */
  current?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        {crumbs && <Breadcrumbs items={crumbs} current={current} />}
        {eyebrow && <div className="mb-1 text-sm text-mute">{eyebrow}</div>}
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.5px] sm:text-[28px] sm:leading-9 sm:tracking-[-0.8px]">{title}</h1>
        {description && <div className="mt-2 text-body">{description}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl bg-card ring-1 ring-hairline", className)} {...props} />;
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-6 sm:mb-8", className)}>
      <div className="mb-3 flex items-center justify-between gap-2 px-1 sm:px-0">
        <h2 className="text-base font-semibold tracking-[-0.2px] sm:text-lg sm:tracking-[-0.4px]">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg font-semibold tracking-[-0.4px]">{children}</h2>
      {aside}
    </div>
  );
}

/** สไตล์เดียวกับ <Input> ของ shadcn สำหรับ <select> ธรรมดา (ใช้ใน form ฝั่ง server ได้) */
export const nativeSelectClass =
  "h-9 lg:h-10 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
  transitionTypes,
}: {
  href: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  children: ReactNode;
  transitionTypes?: string[];
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href} transitionTypes={transitionTypes}>
        {children}
      </Link>
    </Button>
  );
}

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-mute">{hint}</p>}
    </div>
  );
}

const tones = {
  neutral: "bg-canvas-soft-2 text-body",
  blue: "bg-link-soft text-link-deep",
  green: "bg-teal-soft text-teal-deep",
  amber: "bg-warning-soft text-warning-deep",
  red: "bg-error-soft text-error-deep",
  violet: "bg-violet-soft text-violet",
};
export type Tone = keyof typeof tones;

export function Pill({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export const PARCEL_STATUS: Record<ParcelStatus, { label: string; tone: Tone }> = {
  SHIPPED: { label: "ส่งออกแล้ว", tone: "blue" },
  DELIVERED: { label: "ถึงลูกค้า", tone: "green" },
  RETURNING: { label: "กำลังตีกลับ", tone: "amber" },
  RETURNED: { label: "ได้ของคืนแล้ว", tone: "violet" },
  PROBLEM: { label: "มีปัญหา", tone: "red" },
  CANCELLED_AFTER: { label: "ยกเลิกหลังขึ้นรถ", tone: "red" },
};

export function ParcelStatusPill({ status }: { status: ParcelStatus }) {
  return <Pill tone={PARCEL_STATUS[status].tone}>{PARCEL_STATUS[status].label}</Pill>;
}

/** สถานะรอบรถ — กำลังทำมีจุดกะพริบ */
export function PickupStatusPill({ status }: { status: PickupStatus }) {
  return status === "DOING" ? (
    <Pill tone="blue">
      <span className="live-dot size-1.5 rounded-full bg-brand" />
      กำลังทำ
    </Pill>
  ) : (
    <Pill tone="green">ปิดงานแล้ว</Pill>
  );
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[13px] lg:text-sm", className)}>{children}</span>;
}

export function Empty({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card/60 px-6 py-8 text-center text-sm text-body">
      {icon && <div className="text-hairline-strong [&_svg]:size-8">{icon}</div>}
      <div>{children}</div>
    </div>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "blue"; children: ReactNode }) {
  const t = { amber: tones.amber, red: tones.red, blue: tones.blue };
  return <div className={cn("animate-in rounded-xl px-4 py-3 text-sm fade-in slide-in-from-top-1", t[tone])}>{children}</div>;
}

/** หัวคอลัมน์ — ใส่ className ได้ เช่น ซ่อนบนมือถือด้วย HIDE_SM */
export type Column = ReactNode | { label: ReactNode; className?: string };

/** ซ่อนคอลัมน์บนมือถือ — ใช้ทั้งหัวและเซลล์ของคอลัมน์นั้น */
export const HIDE_SM = "hidden sm:table-cell";

const isCol = (h: Column): h is { label: ReactNode; className?: string } =>
  typeof h === "object" && h !== null && "label" in h;

/**
 * ตารางสไตล์ data-table — หัวตารางเป็น mono ตัวเล็ก
 * fixed = ความกว้างคอลัมน์ตามที่กำหนดในหัว (w-…) ไม่ยืดตามข้อความ → ไม่ล้นกรอบ ข้อความยาวตัด/ขึ้นบรรทัดใหม่ในช่อง
 */
export function DataTable({ head, children, fixed = false }: { head: Column[]; children: ReactNode; fixed?: boolean }) {
  return (
    <Panel className="max-w-full min-w-0 overflow-hidden">
      <Table className={fixed ? "table-fixed" : undefined}>
        <TableHeader className="bg-canvas-soft">
          <TableRow className="hover:bg-transparent">
            {head.map((h, i) => (
              <TableHead key={i} className={cn("h-9 text-[13px] font-semibold text-body lg:h-11", isCol(h) && h.className)}>
                {isCol(h) ? h.label : h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </Panel>
  );
}

export function KeyValues({ items, className }: { items: [string, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[13px] text-mute">{k}</dt>
          <dd className="tabular mt-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
