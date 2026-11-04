"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { unstable_rethrow, useRouter } from "next/navigation";
import { CheckCircle2Icon, Loader2Icon, PackageCheckIcon, RefreshCwIcon, WarehouseIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { checkStockIns, receiveReturn } from "@/app/actions/returns";
import type { StockInSync } from "@/lib/bigseller";
import { ParcelStatusPill } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { ParcelStatus } from "@/generated/prisma/enums";

export type ReturnCandidate = {
  id: string;
  trackingNo: string;
  orderNo: string | null;
  status: ParcelStatus;
  shippingMethod: string | null;
  plate: string | null;
  /** รถออกกี่วันแล้ว */
  days: number | null;
  /** ตีกลับ / ยกเลิก · ไม่ได้ไปกับรถ / ยกเลิก · ไปกับรถ */
  kindLabel: string | null;
};

/**
 * ตัวเลขท้ายของเลขแทร็ค — เลข SPX ลงท้ายด้วยตัวอักษร (TH260811652882T) ตัดตัวอักษรท้ายทิ้งก่อน
 * เจ้าหน้าที่พิมพ์ "2882" ก็เจอ ไม่ต้องพิมพ์ T
 */
const digitsTail = (no: string) => no.toUpperCase().replace(/[^0-9]+$/, "");

/**
 * ถาม BigSeller ว่าชิ้นไหน Stock-In แล้ว — ชิ้นที่ครบบันทึกรับคืนให้ (คนกด + เวลาจาก BigSeller)
 * เปิดหน้าแล้วเช็คให้เองครั้งเดียว + ปุ่ม "เช็คสถานะ BigSeller" กดเช็คซ้ำได้ (เพิ่ง Stock-In ไปเมื่อกี้)
 * หน้าขึ้นทันทีด้วยรายการเดิม เสร็จแล้ว refresh ถ้ามีชิ้นเปลี่ยน (router.refresh ไม่ทำให้ยิงซ้ำ — คอมโพเนนต์ยังอยู่)
 */
function useStockInSync() {
  const router = useRouter();
  const ran = useRef(false);
  const [state, setState] = useState<{ pending: boolean; result: StockInSync | null }>({ pending: true, result: null });

  const check = useCallback(
    (manual: boolean) => {
      setState((s) => ({ ...s, pending: true }));
      checkStockIns()
        .then((r) => {
          setState({ pending: false, result: r });
          if (r.marked.length) {
            toast.success(`Stock-In ใน BigSeller แล้ว ${r.marked.length} ชิ้น — บันทึกรับคืนให้แล้ว`);
            router.refresh();
          } else if (manual) {
            if (r.ok) toast(`BigSeller: ${r.message}`);
            else toast.error(`BigSeller: ${r.message}`);
          }
        })
        .catch((e: unknown) => {
          unstable_rethrow(e);
          setState({ pending: false, result: null });
          if (manual) toast.error("เช็ค Stock-In กับ BigSeller ไม่สำเร็จ — ลองอีกครั้ง");
        });
    },
    [router],
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    check(false);
  }, [check]);
  return { ...state, check };
}

/**
 * รับของคืน — พิมพ์เลขแทร็ค 4 ตัวท้าย ค้นเฉพาะรายการยกเลิก / ตีกลับที่ยังไม่คืน (ไม่กี่สิบชิ้น เลขท้ายแทบไม่ซ้ำ)
 * เจอ → การ์ด + ปุ่ม "ได้ของคืนแล้ว" กดครั้งเดียวจบ แล้วช่องว่างรอชิ้นถัดไป
 */
export function ReturnReceiver({ parcels }: { parcels: ReturnCandidate[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const stockIn = useStockInSync();

  const term = q.replace(/\D/g, "");
  const matches = term.length >= 4 ? parcels.filter((p) => digitsTail(p.trackingNo).endsWith(term)) : [];

  const receive = (p: ReturnCandidate) => {
    setBusy(p.id);
    start(async () => {
      const r = await receiveReturn(p.id).catch((e: unknown) => {
        // login หมดอายุ → requireUser redirect ไปหน้า login (ปล่อยให้ Next จัดการ ไม่กลืน error)
        unstable_rethrow(e);
        return { error: "บันทึกไม่สำเร็จ — ลองอีกครั้ง" } as { ok?: string; error?: string };
      });
      setBusy(null);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok);
      setQ("");
      input.current?.focus();
      router.refresh();
    });
  };

  return (
    <div className="mb-5 rounded-2xl bg-card p-4 shadow-card ring-1 ring-hairline sm:p-5">
      <label htmlFor="return-tail" className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <PackageCheckIcon className="size-5 text-brand" />
        รับของคืน — พิมพ์เลขแทร็ค 4 ตัวท้าย
      </label>
      {/* ผลเช็ค Stock-In กับ BigSeller (เปิดหน้าแล้วเช็คให้เอง · กดปุ่มเช็คซ้ำได้) */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-mute">
          {stockIn.pending ? (
            <>
              <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> กำลังเช็ค Stock-In กับ BigSeller…
            </>
          ) : stockIn.result ? (
            <>
              <WarehouseIcon className="size-3.5 shrink-0" />
              <span className={stockIn.result.ok ? "" : "text-warning-deep"}>BigSeller: {stockIn.result.message}</span>
            </>
          ) : (
            <span className="text-warning-deep">เช็ค Stock-In กับ BigSeller ไม่สำเร็จ — รับคืนด้วยมือได้ตามปกติ</span>
          )}
        </p>
        <Button type="button" variant="outline" className="h-10 w-full sm:w-auto" disabled={stockIn.pending} onClick={() => stockIn.check(true)}>
          {stockIn.pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
          เช็คสถานะ BigSeller
        </Button>
      </div>
      <div className="relative">
        <input
          ref={input}
          id="return-tail"
          value={q}
          onChange={(e) => setQ(e.target.value.replace(/\D/g, "").slice(0, 8))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="เช่น 2882"
          className="h-14 w-full rounded-xl border bg-canvas-soft pr-12 pl-4 text-center font-mono text-2xl font-semibold tracking-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        {q && (
          <button
            type="button"
            aria-label="ล้าง"
            onClick={() => {
              setQ("");
              input.current?.focus();
            }}
            className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-mute hover:bg-muted"
          >
            <XIcon className="size-5" />
          </button>
        )}
      </div>

      {term.length >= 4 && (
        <div className="mt-3 grid gap-2" aria-live="polite">
          {matches.length === 0 ? (
            <p className="rounded-xl bg-canvas-soft-2 px-4 py-3 text-sm text-body">
              ไม่มี “{term}” ในรายการยกเลิก / ตีกลับที่รอคืน —เช็คเลขอีกที หรือค้นทุกพัสดุที่{" "}
              <Link href={`/tracking?tab=all&q=${term}`} className="font-medium text-link underline">
                หน้าติดตาม
              </Link>
            </p>
          ) : (
            <>
              {matches.length > 1 && <p className="text-xs text-warning-deep">เจอ {matches.length} ชิ้นที่เลขท้ายตรงกัน — ดูเลขเต็มแล้วกดชิ้นที่ถูก</p>}
              {matches.map((p) => {
                const tail = digitsTail(p.trackingNo);
                return (
                <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-canvas-soft px-4 py-3 ring-1 ring-hairline">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-base font-semibold break-all text-ink">
                      {p.trackingNo.slice(0, tail.length - term.length)}
                      <mark className="rounded bg-brand-soft px-0.5 text-brand-deep">{term}</mark>
                      {p.trackingNo.slice(tail.length)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-mute">
                      {p.kindLabel && <span className="rounded-full bg-canvas-soft-2 px-2 py-0.5 font-medium text-body ring-1 ring-hairline">{p.kindLabel}</span>}
                      <ParcelStatusPill status={p.status} />
                      {stockIn.result?.waiting[p.trackingNo] && (
                        <span className="rounded-full bg-warning-soft px-2 py-0.5 font-medium text-warning-deep">BigSeller: {stockIn.result.waiting[p.trackingNo]}</span>
                      )}
                      {p.shippingMethod && <span>{p.shippingMethod}</span>}
                      {p.plate && <span>รถ {p.plate}</span>}
                      {p.days != null && <span>ออก {p.days} วันแล้ว</span>}
                      {p.orderNo && <span className="font-mono">{p.orderNo}</span>}
                    </p>
                  </div>
                  <Button className="h-12 w-full px-5 text-base sm:w-auto" disabled={busy !== null} onClick={() => receive(p)}>
                    {busy === p.id ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />}
                    ได้ของคืนแล้ว
                  </Button>
                </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
