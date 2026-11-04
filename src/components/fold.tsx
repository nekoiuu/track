"use client";

import { useState } from "react";
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** กล่องพับได้ในตาราง — <details data-fold> ภายใน scope */
const folds = (scope: string) => [...document.querySelectorAll<HTMLDetailsElement>(`#${scope} details[data-fold]`)];

/** พับทั้งหมด / กางทั้งหมด — ใบเยอะ ไม่ต้องกดทีละใบ */
export function CollapseAllButton({ scope }: { scope: string }) {
  const [label, setLabel] = useState<"open" | "close">("open");
  const toggle = () => {
    const open = label === "open";
    for (const d of folds(scope)) d.open = open;
    setLabel(open ? "close" : "open");
  };
  return (
    <Button type="button" variant="ghost" size="sm" className="no-print mb-2 h-9 text-body" onClick={toggle}>
      {label === "open" ? <ChevronsUpDownIcon /> : <ChevronsDownUpIcon />}
      {label === "open" ? "กางทั้งหมด" : "พับทั้งหมด"}
    </Button>
  );
}

/** ค้นหาแล้วเจอในใบที่พับอยู่ → กางใบนั้นให้เห็น (ใช้ใน TableSearch) */
export function openFoldsWithMatches(scope: string, term: string) {
  if (!term) return;
  for (const d of folds(scope)) {
    if (d.querySelector(`[data-q*="${term.replace(/["\\]/g, "\\$&")}"]`)) d.open = true;
  }
}
