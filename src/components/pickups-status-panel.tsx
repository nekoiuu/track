"use client";

import Link from "next/link";
import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { cn } from "cn";
import type { FlashRoundState } from "@/app/actions/manifests";
import type { SheetsUpdateState } from "@/app/actions/sheets";
import { CARRIER_FAMILIES, FLASH_PILL, TONE_LABEL, type CarrierFamily, type FlashTone } from "@/lib/flash-state";
import { Button } from "@/components/ui/button";
import { FlashRunningBar, useFlashRounds } from "./flash-rounds";
import { ChunkedSheetsButton } from "./sheets-update-button";

/**
 * แผงสถานะพัสดุทั้งวันในหน้ารอบรถ
 * - ชิปนับจำนวน กดเลือกกลุ่มที่จะส่ง Sheets (ไม่เลือก = ทุกชิ้น)
 * - ดึงสถานะ Flash ทีละรอบ (~400 ชิ้น) พักระหว่างรอบตามที่ server บอก — กันโดน Flash บล็อก · กดหยุดได้
 * - ส่ง Sheets ทีละคัน (เคยส่ง = อัปเดตแถวเดิม)
 */
export function PickupsStatusPanel({
  tones,
  sheets,
  refresh,
  exportRows,
  ship,
  shipCounts,
  shipHrefs,
}: {
  tones: [FlashTone, number][];
  /** ขนส่งที่กรองอยู่ (ค่าเริ่มต้น Flash) */
  ship: CarrierFamily | "all";
  /** จำนวนชิ้นของแต่ละขนส่ง — โชว์บนปุ่มกรอง */
  shipCounts: Record<CarrierFamily, number>;
  /** ลิงก์ของแต่ละตัวกรอง (all / flash / spx / other) */
  shipHrefs: Record<string, string>;
  sheets: boolean;
  /** refreshPickupsFlash ที่ bind รายการรถแล้ว — (before, tones) */
  refresh: (before: number, tones: FlashTone[] | null) => Promise<FlashRoundState>;
  /** exportPickupsToSheets ที่ bind รายการรถ + ขนส่งแล้ว — (tones, from) */
  exportRows: (tones: FlashTone[] | null, from?: number) => Promise<SheetsUpdateState>;
}) {
  const [picked, setPicked] = useState<FlashTone[]>([]);
  const rounds = useFlashRounds();
  const running = rounds.running;
  const total = tones.reduce((n, [, c]) => n + c, 0);
  const pickedCount = picked.length ? tones.filter(([t]) => picked.includes(t)).reduce((n, [, c]) => n + c, 0) : total;

  const shipLabel = ship === "all" ? "ทุกขนส่ง" : CARRIER_FAMILIES.find((f) => f.key === ship)!.label;
  const toggle = (t: FlashTone) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  /**
   * วนดึง Flash จนครบ — before = 0 เฉพาะที่ยังไม่เคยเช็ค · เวลา = ดึงใหม่ทุกชิ้นที่เช็คก่อนเวลานี้
   * tones = เฉพาะกลุ่มสถานะที่เลือก (เช่น "กำลังส่ง" — อยากรู้ว่าขยับหรือยัง)
   */
  const pull = (label: string, before: number, tones: FlashTone[] | null = null) => rounds.pull(label, () => refresh(before, tones));

  return (
    <div className="mb-4 grid gap-3 rounded-2xl border bg-card p-3 sm:p-4">
      {/* ตัวกรองขนส่ง — ชิปสถานะ จำนวน ตาราง และการส่ง Sheets ใช้ตามที่เลือก */}
      <nav aria-label="กรองขนส่ง" className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-mute">ขนส่ง</span>
        {[...CARRIER_FAMILIES, { key: "all" as const, label: "ทั้งหมด" }]
          .filter((f) => f.key === "all" || f.key === ship || shipCounts[f.key] > 0)
          .map((f) => {
            const n = f.key === "all" ? shipCounts.flash + shipCounts.spx + shipCounts.other : shipCounts[f.key];
            const on = f.key === ship;
            return (
              <Link
                key={f.key}
                href={shipHrefs[f.key]}
                scroll={false}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors",
                  on ? "border-brand bg-brand font-medium text-white" : "bg-card text-body hover:bg-muted",
                )}
              >
                {f.label}
                <span className={cn("tabular text-xs", on ? "text-white/80" : "text-mute")}>{n}</span>
              </Link>
            );
          })}
      </nav>

      <div className="flex flex-wrap items-center gap-1.5">
        {tones.map(([t, n]) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            aria-pressed={picked.includes(t)}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-3 text-xs font-medium tabular transition",
              FLASH_PILL[t],
              picked.length && !picked.includes(t) && "opacity-40",
              picked.includes(t) && "ring-2 ring-ink/60",
            )}
          >
            {TONE_LABEL[t]} {n}
          </button>
        ))}
        {picked.length > 0 && (
          <button type="button" onClick={() => setPicked([])} className="h-9 px-2 text-xs text-mute hover:text-ink">
            ล้างที่เลือก
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <FlashRunningBar running={running} onStop={rounds.stop} />
        ) : (
          <>
            {/* เลือกชิปแล้ว → เช็คใหม่เฉพาะกลุ่มนั้น */}
            {picked.length > 0 && (
              <Button type="button" onClick={() => pull(`เช็ค ${picked.map((t) => TONE_LABEL[t]).join(", ")}`, Date.now(), picked)}>
                <RefreshCwIcon /> เช็คสถานะที่เลือก ({pickedCount})
              </Button>
            )}
            {/* ปุ่มถาม Flash — เฉพาะตอนดู Flash / ทั้งหมด (ขนส่งอื่นถาม Flash ไม่ได้) */}
            {(ship === "flash" || ship === "all") && (
              <>
                <Button type="button" variant="outline" onClick={() => pull("ดึงสถานะที่ยังไม่มี", 0)}>
                  <RefreshCwIcon /> ดึงสถานะที่ยังไม่มี
                </Button>
                <Button type="button" variant="ghost" onClick={() => pull("ดึงใหม่ทั้งหมด", Date.now())}>
                  ดึงใหม่ทั้งหมด
                </Button>
              </>
            )}
            {ship === "spx" && <span className="text-sm text-mute">SPX ใช้สถานะจาก BigSeller</span>}
            {ship === "other" && <span className="text-sm text-mute">ขนส่งอื่นใช้สถานะจาก BigSeller</span>}
          </>
        )}
        {sheets && (
          <span className="ml-auto">
            <ChunkedSheetsButton
              run={(from) => exportRows(picked.length ? picked : null, from)}
              label={picked.length ? `ส่งที่เลือก (${pickedCount}) ไป Sheets` : `ส่ง ${shipLabel} (${total}) ไป Sheets`}
              unit="คัน"
              icon="sheet"
              variant="default"
              confirmText={`ส่งพัสดุ ${shipLabel} ${picked.length ? `เฉพาะ ${picked.map((t) => TONE_LABEL[t]).join(", ")}` : "ทุกชิ้น"} (${pickedCount} ชิ้น) ไป Google Sheets?\nเคยส่งแล้ว = อัปเดตสถานะแถวเดิม · ยังไม่เคย = ต่อท้าย`}
            />
          </span>
        )}
      </div>
      <p className="text-xs text-mute">
        กดชิปเพื่อเลือกกลุ่ม → เช็คกับ Flash ใหม่เฉพาะกลุ่มนั้น หรือส่งเฉพาะกลุ่มนั้นไป Sheets · ดึงสถานะจาก Flash ได้ ~400 ชิ้นต่อนาที (เกินแล้ว Flash บล็อก) — เปิดหน้านี้ค้างไว้จนเสร็จ · ขนส่งอื่น (SPX, J&T) ใช้สถานะ BigSeller
      </p>
    </div>
  );
}
