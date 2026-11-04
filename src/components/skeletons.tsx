import { ViewTransition } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingBuddy } from "@/components/loading-buddy";

/**
 * โครงหน้าที่โชว์ทันทีตอนกดเปลี่ยนหน้า (loading.tsx) — ไม่ต้องรอ server
 * ข้อมูลจริงมาแล้วสลับเข้าไปแทนเอง
 */

function Header({ crumb = false }: { crumb?: boolean }) {
  return (
    <div className="mb-8">
      {crumb && <Skeleton className="mb-4 h-4 w-28" />}
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
    </div>
  );
}

function Rows({ n = 6 }: { n?: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-12 rounded-lg" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

/**
 * น้อง Claude ย่ำขาอยู่กลางหน้า บนโครงหน้าที่เบลอไว้ข้างหลัง
 * โครงใช้ slate-200 — bg-muted เดิม (#f1f5f9) แทบกลืนกับพื้น (#f7f8fa) ดูเป็นหน้าขาวเปล่า
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition exit="page" default="none">
      <div aria-busy="true" aria-label="กำลังโหลด" className="relative min-h-[70vh]">
        <div className="blur-[3px] **:data-[slot=skeleton]:bg-slate-200/80">{children}</div>
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-background/30 pt-[18vh]">
          <LoadingBuddy />
        </div>
      </div>
    </ViewTransition>
  );
}

/** หน้ารายการ (ภาพรวม, รอบรถ, ใบนำจ่าย …) */
export function ListSkeleton() {
  return (
    <Shell>
      <Header />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="mb-3 h-6 w-40" />
      <Rows />
    </Shell>
  );
}

/** หน้ารายละเอียด (ใบนำจ่าย, พัสดุ) — หัว + ตาราง */
export function DetailSkeleton() {
  return (
    <Shell>
      <Header crumb />
      <Skeleton className="mb-3 h-11 w-full rounded-lg sm:w-96" />
      <Skeleton className="mb-3 h-6 w-40" />
      <Rows n={8} />
    </Shell>
  );
}

/** หน้ารอบรถ — หัว + ช่องจด manifest + การ์ด manifest */
export function PickupSkeleton() {
  return (
    <Shell>
      <Header crumb />
      <Skeleton className="mb-8 h-24 w-full rounded-xl" />
      <Skeleton className="mb-3 h-6 w-40" />
      <Skeleton className="mb-4 h-14 w-full rounded-lg" />
      <div className="mb-8 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Rows n={5} />
    </Shell>
  );
}
