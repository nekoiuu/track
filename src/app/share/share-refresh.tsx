"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { refreshShare, refreshSharedParcel } from "@/app/actions/share";

/**
 * เปิดลิงก์แล้วเช็คสถานะล่าสุดกับ Flash ให้เอง (เบื้องหลัง) — หน้าขึ้นทันทีด้วยข้อมูลเดิม
 * ได้ข้อมูลใหม่ → refresh หน้า
 */
export function ShareRefresh({ slug, token }: { slug?: string; token?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    start(async () => {
      const r = slug ? await refreshShare(slug) : token ? await refreshSharedParcel(token) : null;
      if (r?.count) router.refresh();
    });
  }, [slug, token, router]);

  if (!pending) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-mute">
      <Loader2Icon className="size-3.5 animate-spin" /> กำลังเช็คสถานะล่าสุดกับ Flash…
    </p>
  );
}
