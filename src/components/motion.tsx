"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { toast } from "sonner";

const EASE = [0.22, 1, 0.36, 1] as const;

/** ตัวเลขนับขึ้นตอนโผล่บนจอ */
export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) {
      el.textContent = value.toLocaleString();
      return;
    }
    const controls = animate(0, value, {
      duration: Math.min(0.9, 0.3 + value / 400),
      ease: EASE,
      onUpdate: (v) => (el.textContent = Math.round(v).toLocaleString()),
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  return <span ref={ref}>0</span>;
}

/** รายการที่ค่อย ๆ โผล่ทีละอัน */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 6 },
        show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** เวลาที่ผ่านไปตั้งแต่เริ่มงาน เดินทุกวินาที */
export function LiveTimer({ since, className }: { since: string; className?: string }) {
  const start = new Date(since).getTime();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    // เริ่มนับฝั่ง client เท่านั้น — กัน hydration ไม่ตรงกับเวลาที่ server render
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (now == null) return <span className={className}>--:--:--</span>;
  const s = Math.max(0, Math.floor((now - start) / 1000));
  return (
    <span className={className} suppressHydrationWarning>
      {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}
    </span>
  );
}

/** โชว์ผลของ server action เป็น toast — state เปลี่ยนเมื่อไหร่ เด้งเมื่อนั้น */
export function useActionToast(state: { error?: string; message?: string; ok?: string | boolean } | undefined) {
  useEffect(() => {
    if (!state) return;
    if (state.error) toast.error(state.error);
    else if (typeof state.ok === "string") toast.success(state.ok);
    else if (state.message) toast.success(state.message);
  }, [state]);
}
