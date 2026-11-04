"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * แถบโหลดบนสุดของจอ — ขึ้นทันทีที่กดลิงก์ (ก่อน server ตอบ) ให้รู้ว่ากดติดแล้ว
 * หายเองเมื่อเปลี่ยนหน้าสำเร็จ
 */
export function NavProgress() {
  const path = usePathname();
  // จำหน้าที่กดออกไป — path เปลี่ยนเมื่อไหร่ แถบหายเอง (ไม่ต้อง setState ใน effect)
  const [leaving, setLeaving] = useState<string | null>(null);
  const on = leaving !== null && leaving === path;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      // ลิงก์ออกนอกเว็บ หรือหน้าเดิม (เปลี่ยนแค่ ?query) → ไม่ต้องโชว์
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      setLeaving(window.location.pathname);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <AnimatePresence>
      {on && (
        <motion.div
          key="bar"
          className="no-print pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] origin-left bg-brand"
          initial={{ scaleX: 0, opacity: 1 }}
          // พุ่งไป 40% ทันที (รู้ว่ากดติด) แล้วค่อย ๆ คลาน — ไม่เต็มจนกว่าหน้าใหม่มา
          animate={{ scaleX: [0, 0.4, 0.9], transition: { duration: 5, times: [0, 0.03, 1], ease: "easeOut" } }}
          exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.18 } }}
        />
      )}
    </AnimatePresence>
  );
}
