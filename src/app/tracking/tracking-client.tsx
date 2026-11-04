"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { cn } from "cn";
import { autoRefreshTrackingFlash, type FlashRoundState } from "@/app/actions/manifests";
import { Button } from "@/components/ui/button";
import { FlashRunningBar, useFlashRounds } from "@/components/flash-rounds";
import { LoadingBuddy } from "@/components/loading-buddy";

/**
 * หน้าติดตามสถานะ — กดแท็บ/ตัวกรอง/เลขหน้า แล้ว "ปุ่มเปลี่ยนทันที" ส่วนตารางโหลดตามมา
 * ระหว่างรอ ตารางเดิมจางลงและมีวงหมุนตรงกลาง (ไม่กระพริบเป็นหน้าว่าง)
 */

type Pending = { group: string; value: string } | null;
const Ctx = createContext<{ pending: Pending; loading: boolean; go: (href: string, group: string, value: string) => void }>({
  pending: null,
  loading: false,
  go: () => {},
});

export function TrackingShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [loading, start] = useTransition();
  const [pending, setPending] = useState<Pending>(null);
  const go = (href: string, group: string, value: string) => {
    setPending({ group, value });
    start(() => router.push(href, { scroll: false }));
  };
  return <Ctx.Provider value={{ pending: loading ? pending : null, loading, go }}>{children}</Ctx.Provider>;
}

/**
 * ลิงก์ตัวกรอง — กดแล้วขึ้นสถานะ "เลือกแล้ว" ทันที (ไม่รอข้อมูล)
 * group: กลุ่มของตัวเลือก (tab / range / stale / page) · value: ค่าของปุ่มนี้ · current: ค่าที่เลือกอยู่ตาม URL
 */
export function FilterLink({
  href,
  group,
  value,
  current,
  className,
  onClass,
  offClass,
  children,
  ...rest
}: {
  href: string;
  group: string;
  value: string;
  current: string;
  className?: string;
  onClass: string;
  offClass: string;
  children: ReactNode;
  "aria-label"?: string;
}) {
  const { pending, go } = useContext(Ctx);
  const selected = (pending?.group === group ? pending.value : current) === value;
  return (
    <a
      href={href}
      onClick={(e) => {
        // เปิดแท็บใหม่ (ctrl/cmd/คลิกกลาง) ให้เบราว์เซอร์จัดการเอง
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        if (!selected) go(href, group, value);
      }}
      aria-current={selected ? "page" : undefined}
      className={cn(className, selected ? onClass : offClass)}
      {...rest}
    >
      {children}
    </a>
  );
}

/** กล่องตาราง — ระหว่างโหลดของใหม่ เบลอ + น้อง Claude กลางตาราง */
export function LoadingArea({ children }: { children: ReactNode }) {
  const { loading } = useContext(Ctx);
  return (
    <div className="relative" aria-busy={loading}>
      <div className={cn("transition-[opacity,filter] duration-200", loading && "pointer-events-none opacity-60 blur-[3px]")}>{children}</div>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-start justify-center pt-24">
          <LoadingBuddy size={60} />
        </div>
      )}
    </div>
  );
}

/**
 * ปุ่มเช็คสถานะ Flash ใหม่ — "หน้านี้" (เฉพาะชิ้นที่เห็น) หรือ "ทุกหน้า" (ทั้งแท็บ + ตัวกรองนี้)
 * ทีละรอบ ~400 ชิ้น พักระหว่างรอบ มีนับถอยหลัง + กดหยุดได้ — เปิดหน้าค้างไว้จนเสร็จ
 * refresh = refreshTrackingFlash ที่ bind ตัวกรองแล้ว — (ids | null, before)
 */
export function TrackingFlashButtons({
  pageIds,
  total,
  refresh,
}: {
  pageIds: string[];
  /** จำนวนทุกหน้า · null = ไม่มีปุ่ม "ทุกหน้า" (ผลค้นหา) */
  total: number | null;
  refresh: (ids: string[] | null, before: number) => Promise<FlashRoundState>;
}) {
  const { running, pull, stop } = useFlashRounds();
  if (running) return <FlashRunningBar running={running} onStop={stop} />;
  return (
    <>
      <Button type="button" variant="outline" onClick={() => { const before = Date.now(); pull("เช็คหน้านี้", () => refresh(pageIds, before)); }}>
        <RefreshCwIcon /> เช็คหน้านี้ ({pageIds.length})
      </Button>
      {total != null && total > pageIds.length && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!confirm(`เช็คสถานะ Flash ใหม่ทุกหน้า (${total} ชิ้น)?\nทีละ ~400 ชิ้น พักรอบละ 1 นาที — เปิดหน้านี้ค้างไว้จนเสร็จ`)) return;
            const before = Date.now();
            pull("เช็คทุกหน้า", () => refresh(null, before));
          }}
        >
          <RefreshCwIcon /> เช็คทุกหน้า ({total})
        </Button>
      )}
    </>
  );
}

/** id ชุดที่เช็คไปแล้วในแท็บนี้— Flash ล้มก็ไม่ยิงซ้ำทุกครั้งที่หน้า refresh */
const tried = new Set<string>();

/**
 * เปิดหน้าแล้วเช็คสถานะกับ Flash ให้เอง (เบื้องหลัง) — เฉพาะชิ้นในหน้านี้ที่ข้อมูลเก่า
 * หน้าขึ้นทันทีด้วยข้อมูลเดิม เสร็จแล้ว refresh ตารางให้
 */
export function AutoFlashRefresh({ ids }: { ids: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const key = ids.join(",");
  const ran = useRef<string | null>(null);

  useEffect(() => {
    if (!key || ran.current === key || tried.has(key)) return;
    ran.current = key;
    tried.add(key);
    start(async () => {
      const r = await autoRefreshTrackingFlash(key.split(","));
      setResult(r ? { ok: r.ok, message: r.message } : null);
      router.refresh();
    });
  }, [key, router]);

  if (pending)
    return (
      <p className="no-print mb-3 flex items-center gap-1.5 text-xs text-mute">
        <Loader2Icon className="size-3.5 animate-spin" /> กำลังอัปเดตสถานะจาก Flash {ids.length} ชิ้น…
      </p>
    );
  if (result && !result.ok)
    return <p className="no-print mb-3 text-xs text-warning-deep">อัปเดตจาก Flash ไม่ครบ — แสดงข้อมูลล่าสุดที่มี ({result.message.split(" · ").at(-1)})</p>;
  return null;
}

/**
 * อัปเดตหน้าเองเมื่อมีพัสดุเปลี่ยนสถานะ (ตัวดึงสถานะเขียน ParcelEvent ไว้) — ถาม /api/track/changes ทุก 60 วินาที (เฉพาะตอนเปิดแท็บนี้ดูอยู่)
 * ถามเฉพาะตอนแท็บนี้เปิดอยู่บนจอ · ไม่มีอะไรเปลี่ยน = ไม่โหลดอะไรเพิ่ม
 */
export function LiveRefresh({ since }: { since: string }) {
  const router = useRouter();
  const sinceRef = useRef(since);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/track/changes?since=${encodeURIComponent(sinceRef.current)}`, { cache: "no-store" });
        if (!res.ok) return;
        const r = (await res.json()) as { count: number; latest: string };
        if (r.count > 0) {
          sinceRef.current = r.latest;
          setNote(`อัปเดตแล้ว — สถานะเปลี่ยน ${r.count} รายการ (${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })})`);
          router.refresh();
        }
      } catch {
        /* เน็ตหลุดชั่วคราว — รอบหน้าค่อยถามใหม่ */
      }
    };
    const timer = setInterval(check, 60_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return note ? <p className="no-print mb-3 text-xs text-mute">{note}</p> : null;
}
