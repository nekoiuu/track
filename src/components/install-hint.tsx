"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";

const KEY = "shipped:install-hint-dismissed";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * ลงแอปบนมือถือ
 * - Android (Chrome/Edge/Samsung): ปุ่ม "ติดตั้งแอป" — กดแล้วขึ้นหน้าต่างติดตั้งของระบบ
 * - iPhone: ไม่มีปุ่มติดตั้งอัตโนมัติ — บอกวิธี แชร์ → เพิ่มไปยังหน้าจอโฮม
 * ไม่ขึ้นถ้า: เปิดจากไอคอนแอปอยู่แล้ว / เคยกดปิด
 * ต้องเปิดผ่าน https (หรือ localhost) — http://IP ในวง LAN เบราว์เซอร์ไม่ยอมให้ติดตั้ง
 */
export function InstallHint() {
  const [mode, setMode] = useState<"ios" | "android" | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    // service worker — เงื่อนไขติดตั้งแอปของบางเบราว์เซอร์ + หน้า offline
    if ("serviceWorker" in navigator && window.isSecureContext) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {}
    if (standalone || dismissed) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setMode("ios");

    // Android: เบราว์เซอร์บอกว่าติดตั้งได้ → เก็บไว้ให้ปุ่มเรียก
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
      setMode("android");
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!mode) return null;
  const close = () => {
    setMode(null);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setMode(null);
  };

  return (
    <div className="no-print fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+var(--tabbar-h)+0.75rem)] z-40 flex items-center gap-3 rounded-2xl bg-ink p-3.5 text-sm text-white shadow-float sm:right-auto sm:bottom-6 sm:left-6 sm:max-w-sm">
      <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-xl" />
      {mode === "android" ? (
        <>
          <p className="flex-1">
            <b>ติดตั้ง TrackFlow</b>
            <span className="block text-white/70">เปิดจากหน้าจอโฮมได้เลย เต็มจอเหมือนแอป</span>
          </p>
          <button type="button" onClick={install} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3.5 font-semibold text-ink">
            <DownloadIcon className="size-4" />
            ติดตั้ง
          </button>
        </>
      ) : (
        <p className="flex-1">
          ลงแอปไว้ใช้ง่าย ๆ: แตะ <ShareIcon className="inline size-4 align-[-3px]" /> <b>แชร์</b> ใน Safari แล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b>
        </p>
      )}
      <button type="button" onClick={close} className="-m-1.5 grid size-9 shrink-0 place-items-center rounded-full text-white/70" aria-label="ปิด">
        <XIcon className="size-4" />
      </button>
    </div>
  );
}
