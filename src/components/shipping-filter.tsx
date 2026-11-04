"use client";

import { useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { SHIP_UNKNOWN, bsTone } from "@/lib/shipping";
import { openFoldsWithMatches } from "./fold";

/** สีชิปของสถานะ (ข้อความจาก Flash หรือ BigSeller) */
function statusChip(m: string): "cancel" | "fail" | "done" | null {
  if (/ยกเลิก|cancel/i.test(m)) return "cancel";
  if (/ตีกลับ|ปัญหา|ตกค้าง|ผิดปกติ|ไม่สำเร็จ|fail/i.test(m)) return "fail";
  if (/เซ็นรับ|สำเร็จ|delivered/i.test(m)) return "done";
  return bsTone({ bsStatusText: m });
}

const cssString = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;

/** คำค้นหลายเลข — คั่นด้วยเว้นวรรค / ขึ้นบรรทัด / จุลภาค (ไม่เกิน 200 เลข) */
const termsOf = (q: string) => [...new Set(q.toUpperCase().split(/[\s,;]+/).filter(Boolean))].slice(0, 200);

/**
 * วางหลายบรรทัด (เช่น ก๊อปคอลัมน์จาก Sheets) ลงช่องบรรทัดเดียว — เบราว์เซอร์ตัดตัวขึ้นบรรทัดทิ้ง เลขติดกันหมด
 * → แปลงเป็นเว้นวรรคเองแล้วแทรกตรงเคอร์เซอร์
 */
export function pasteAsSpaces(e: React.ClipboardEvent<HTMLInputElement>, set: (v: string) => void) {
  const text = e.clipboardData.getData("text");
  if (!/[\r\n\t]/.test(text)) return;
  e.preventDefault();
  const el = e.currentTarget;
  const clean = text.trim().split(/[\r\n\t]+/).map((s) => s.trim()).filter(Boolean).join(" ");
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  set(`${before}${before && !/\s$/.test(before) ? " " : ""}${clean}${el.value.slice(end)}`);
}

/** ช่องค้นหาแบบฟอร์ม GET (หน้าตามสถานะ) — เหมือน input ธรรมดา แต่วางหลายบรรทัดแล้วได้เว้นวรรค */
export function MultiSearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      onPaste={(e) => {
        const el = e.currentTarget;
        pasteAsSpaces(e, (v) => {
          el.value = v;
        });
      }}
    />
  );
}

/**
 * ช่องค้นหาในตาราง — ค้นในเครื่องทันที (เลขแทร็คกิ้ง / ออเดอร์ บางส่วนก็ได้)
 * แถวใส่ data-q={searchKey(...)} · กลุ่มใส่ data-ship-group → ซ่อนกลุ่มที่ไม่มีแถวตรง
 */
export function TableSearch({ scope, placeholder = "ค้นหาเลขแทร็คกิ้ง / ออเดอร์" }: { scope: string; placeholder?: string }) {
  const [q, setQ] = useState("");
  // หลายเลขพร้อมกัน: คั่นด้วยเว้นวรรค (track1 track2) — แถวที่ตรงเลขใดเลขหนึ่งก็แสดง
  const terms = termsOf(q);
  const has = terms.map((t) => `[data-q*=${cssString(t)}]`);
  return (
    <div className="no-print relative mb-3 sm:max-w-sm">
      {terms.length > 0 && (
        <style>{`#${scope} [data-q]${has.map((h) => `:not(${h})`).join("")},#${scope} [data-ship-group]:not(:has(${has.join(",")})){display:none}`}</style>
      )}
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          // เจอในใบที่พับอยู่ → กางให้เห็น
          for (const t of termsOf(e.target.value)) openFoldsWithMatches(scope, t);
        }}
        onPaste={(e) =>
          pasteAsSpaces(e, (v) => {
            setQ(v);
            for (const t of termsOf(v)) openFoldsWithMatches(scope, t);
          })
        }
        placeholder={`${placeholder} (หลายเลขเว้นวรรค)`}
        autoComplete="off"
        // text-base กัน iOS ซูมตอนแตะช่อง
        className="h-11 w-full rounded-lg border bg-card pr-10 pl-9 font-mono text-base outline-none focus-visible:ring-2 focus-visible:ring-ink/20 sm:text-sm"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ("")}
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-full text-mute hover:bg-muted"
          aria-label="ล้างคำค้น"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * ชิปกรองตาราง — ทำในเครื่องทันที ไม่ต้องโหลดหน้าใหม่ · จำค่าไว้ใน ?{by}= ส่งลิงก์ต่อได้
 * by="ship" (ขนส่ง): แถวใส่ data-ship · ส่วนน้อยขึ้นสีเหลือง = น่าจะสแกนปนมา
 * by="bs" (สถานะ BigSeller): แถวใส่ data-bs
 * กลุ่ม (เช่น ทีละใบ) ใส่ data-ship-group → ซ่อนกลุ่มที่ไม่มีแถวตรง
 */
export function ShippingFilter({
  groups,
  total,
  scope,
  initial,
  by = "ship",
  title,
  always = false,
}: {
  groups: [string, number][];
  total: number;
  /** id ของกล่องที่ครอบตาราง */
  scope: string;
  initial?: string;
  /** กรองด้วย attribute ไหน (data-ship / data-bs) — ใช้เป็นชื่อ ?query ด้วย */
  by?: "ship" | "bs";
  /** ข้อความหัวชิป · ไม่ใส่ = เตือนขนส่งปน */
  title?: string;
  /** โชว์แม้มีกลุ่มเดียว */
  always?: boolean;
}) {
  const [active, setActive] = useState(initial && groups.some(([m]) => m === initial) ? initial : undefined);
  if (groups.length === 0 || (groups.length < 2 && !always)) return null;
  const top = groups[0][1];
  const attr = `data-${by}`;

  const pick = (m?: string) => {
    setActive(m);
    const url = new URL(window.location.href);
    if (m) url.searchParams.set(by, m);
    else url.searchParams.delete(by);
    window.history.replaceState(window.history.state, "", url);
  };

  const chip = "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors sm:h-9 sm:px-3";
  return (
    <div className="no-print mb-4">
      {active && (
        <style>{`#${scope} [${attr}]:not([${attr}=${cssString(active)}]),#${scope} [data-ship-group]:not(:has([${attr}=${cssString(active)}])){display:none}`}</style>
      )}
      {title ? (
        <p className="mb-2 text-sm text-body">{title}</p>
      ) : (
        <p className="mb-2 text-sm text-warning-deep">มีพัสดุ {groups.length} ขนส่งปนกัน</p>
      )}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
        <button type="button" onClick={() => pick()} className={cn(chip, !active ? "border-brand bg-brand text-white" : "bg-card text-body hover:bg-muted")}>
          ทั้งหมด <span className="tabular opacity-70">{total}</span>
        </button>
        {groups.map(([m, n]) => (
          <button
            key={m}
            type="button"
            onClick={() => pick(active === m ? undefined : m)}
            className={cn(
              chip,
              active === m
                ? "border-brand bg-brand text-white"
                : by === "bs" && statusChip(m) === "cancel"
                  ? "border-error/40 bg-error-soft text-error-deep"
                  : by === "bs" && statusChip(m) === "fail"
                    ? "border-orange-300 bg-orange-100 text-orange-800"
                    : by === "bs" && statusChip(m) === "done"
                      ? "border-teal/40 bg-teal-soft text-teal-deep"
                    : by === "ship" && n < top
                      ? "border-warning/60 bg-warning-soft text-warning-deep"
                      : "bg-card text-body hover:bg-muted",
            )}
          >
            {m === SHIP_UNKNOWN ? (by === "ship" ? "ไม่ระบุขนส่ง" : "ยังไม่ได้เช็ค") : m}
            <span className="tabular opacity-70">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
