"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CarIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MessageCircleIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TruckIcon,
  UsersIcon,
  BanIcon,
  ActivityIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { logout } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LiveTimer } from "./motion";
import { Logo } from "./logo";

type NavLink = { href: string; label: string; icon: LucideIcon; short?: string };

/** เมนูหลักแบ่ง 3 กลุ่มตามงาน — งานวันนี้ / ติดตาม / ตั้งค่า (ไม่ต้องไล่อ่าน 8 อันเรียงกัน) */
const GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: "งานวันนี้",
    links: [
      { href: "/", label: "หน้าแรก", icon: LayoutDashboardIcon },
      { href: "/pickups", label: "รอบรถ", icon: TruckIcon },
      { href: "/manifests", label: "ใบนำจ่าย", icon: FileTextIcon },
    ],
  },
  {
    title: "ติดตาม",
    links: [
      { href: "/tracking", label: "ติดตามพัสดุ", short: "ติดตาม", icon: ActivityIcon },
      { href: "/cancelled", label: "ยกเลิก / ตีกลับ", icon: BanIcon },
      { href: "/search", label: "ค้นหา", icon: SearchIcon },
    ],
  },
  {
    title: "ตั้งค่า",
    links: [
      { href: "/vehicles", label: "รถและขนส่ง", icon: CarIcon },
      { href: "/sync", label: "เชื่อมต่อ BigSeller", icon: RefreshCwIcon },
    ],
  },
];
const LINKS: NavLink[] = GROUPS.flatMap((g) => g.links);

// มือถือ: แถบล่างโชว์เมนูหลัก ที่เหลือเก็บใน "เพิ่มเติม"
const MAIN = ["/", "/pickups", "/tracking"];
const MORE = LINKS.filter((l) => !MAIN.includes(l.href));

// เมนูบัญชี (มุมขวาบนบนจอใหญ่ / ใน "เพิ่มเติม" บนมือถือ)
const ACCOUNT: NavLink[] = [
  { href: "/activity", label: "ประวัติการใช้งาน", icon: HistoryIcon },
  { href: "/users", label: "ผู้ใช้", icon: UsersIcon },
  { href: "/line", label: "แจ้งเตือน LINE", icon: MessageCircleIcon },
];

/** เมนูที่เฉพาะแอดมินเห็น */
const ADMIN_LINKS = ["/users", "/line"];

export type NavUser = { name: string; username: string; admin: boolean } | null;

/** เมนูบัญชีที่คนนี้เห็น — หน้าผู้ใช้เฉพาะแอดมิน · คนทั่วไปเห็นประวัติของตัวเอง */
const accountLinks = (user: NonNullable<NavUser>) =>
  ACCOUNT.filter((l) => !ADMIN_LINKS.includes(l.href) || user.admin).map((l) =>
    l.href === "/activity" && !user.admin ? { ...l, label: "ประวัติของฉัน" } : l,
  );

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path.startsWith(href));

function DoingBadge({ doing, className }: { doing: number; className?: string }) {
  if (doing <= 0) return null;
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white tabular",
        className,
      )}
    >
      {doing}
    </span>
  );
}

export type ActivePickup = { id: string; plate: string; since: string; manifests: number };

export function Nav({
  doing,
  active: activePickups = [],
  user = null,
  pendingUsers = 0,
}: {
  doing: number;
  active?: ActivePickup[];
  user?: NavUser;
  /** คนสมัครเองที่รออนุมัติ — ขึ้นตัวเลขที่เมนูผู้ใช้ */
  pendingUsers?: number;
}) {
  const path = usePathname();
  useRefreshOnReturn();
  const active = (href: string) => isActive(path, href);
  // อยู่ในหน้างานรถที่กำลังรับของ → โหมดโฟกัส: ซ่อนแถบเมนูล่าง เหลือแถบสลับคัน + ปุ่มปิดงาน
  const focusIndex = activePickups.findIndex((p) => path === `/pickups/${p.id}`);
  const focus = focusIndex >= 0;
  useSwipeBetween(focus ? activePickups.map((p) => `/pickups/${p.id}`) : [], focusIndex);
  // หน้า login / สมัคร / ลิงก์สาธารณะ (/share) ไม่มีเมนู
  if (path === "/login" || path === "/register" || path.startsWith("/share")) return null;

  return (
    <>
      {/* โหมดโฟกัส: ไม่มีแถบเมนูล่าง → ปุ่มลอย (ปิดงาน) / toast / ระยะเว้นท้ายหน้า ชิดล่างจอแทน */}
      {focus && <style>{`@media (max-width: 39.99rem) { :root { --tabbar-h: 0rem; } }`}</style>}
      <Sidebar path={path} doing={doing} user={user} pendingUsers={pendingUsers} active={activePickups} />
      <header className="no-print sticky top-0 z-30 border-b bg-card/90 backdrop-blur-md lg:pl-[var(--sidebar-w)]">
        <div className="mx-auto flex h-13 max-w-6xl items-center gap-4 px-4 sm:h-14 sm:px-6">
          <Link href="/" className="shrink-0 lg:hidden" aria-label="TrackFlow หน้าแรก">
            <Logo />
          </Link>
          {/* จอใหญ่: ช่องค้นหาแทนโลโก้ (โลโก้อยู่ในแถบซ้าย) */}
          <form action="/search" className="relative hidden max-w-xl flex-1 lg:block">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
            <input
              name="q"
              type="search"
              placeholder="ค้นหาเลขพัสดุ · ออเดอร์ · manifest · ทะเบียน"
              className="h-10 w-full rounded-xl border bg-canvas-soft pr-24 pl-10 text-sm outline-none focus-visible:border-brand-sky focus-visible:ring-3 focus-visible:ring-brand-sky/30"
            />
            <button type="submit" className="absolute top-1 right-1 h-8 rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-brand-deep">
              ค้นหา
            </button>
          </form>
          <nav className="-mx-1 hidden flex-1 gap-0.5 overflow-x-auto scrollbar-none sm:flex lg:hidden">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="relative shrink-0 rounded-full px-3 py-1.5 text-sm text-body transition-colors hover:text-ink data-[active=true]:font-medium data-[active=true]:text-brand-deep"
                data-active={active(l.href)}
              >
                {active(l.href) && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-brand-soft"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="relative flex items-center gap-1.5">
                  {l.label}
                  {l.href === "/pickups" && <DoingBadge doing={doing} />}
                </span>
              </Link>
            ))}
          </nav>
          <div className="flex-1 sm:hidden lg:block" />
          {/* มือถือ: ค้นหาอยู่มุมขวาบน กดได้ตลอด */}
          <Link
            href="/search"
            aria-label="ค้นหา"
            className="-mr-2 grid size-11 place-items-center rounded-full text-body active:bg-muted sm:hidden"
          >
            <SearchIcon className="size-5" />
          </Link>
          <Button asChild size="sm" className="hidden sm:inline-flex lg:hidden">
            <Link href="/pickups/new">
              <PlayIcon />
              เริ่มงานรถเข้า
            </Link>
          </Button>
          {user && (
            <span className="contents lg:hidden">
              <UserMenu user={user} pendingUsers={pendingUsers} />
            </span>
          )}
        </div>
        <ActiveStrip pickups={activePickups} path={path} />
      </header>
      {!focus && <MobileTabBar path={path} doing={doing} user={user} pendingUsers={pendingUsers} />}
    </>
  );
}

/**
 * แถบสลับคัน (ใต้เมนูบน ทุกหน้า · มือถือ/แท็บเล็ต) — รถเข้าพร้อมกัน 2-3 คัน แตะแท็บเดียวสลับได้ทันที
 * แท็บสูง 56px กดง่ายด้วยนิ้วโป้ง · คันที่เปิดอยู่มีขีดฟ้าด้านล่าง · ในหน้างานปัดซ้าย/ขวาก็สลับได้
 */
function ActiveStrip({ pickups, path }: { pickups: ActivePickup[]; path: string }) {
  const current = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // ห้าม return ค่าจาก scrollIntoView — เบราว์เซอร์ใหม่คืน Promise แล้ว React ถือว่าเป็น cleanup ผิดรูป
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  if (pickups.length === 0) return null;

  return (
    <nav aria-label="สลับรถที่กำลังรับของ" className="border-t lg:hidden">
      <div className="mx-auto flex max-w-6xl overflow-x-auto px-2 scrollbar-none sm:px-4">
        {pickups.map((p) => {
          const on = path === `/pickups/${p.id}` || path.startsWith(`/pickups/${p.id}/`);
          return (
            <Link
              key={p.id}
              ref={on ? current : undefined}
              href={`/pickups/${p.id}`}
              // โหลดรถทุกคันที่กำลังทำไว้ล่วงหน้า → กดสลับแล้วขึ้นทันที
              prefetch={true}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex h-14 min-w-[7.5rem] flex-1 shrink-0 flex-col items-center justify-center gap-0.5 border-b-[3px] px-3 transition-colors active:bg-muted",
                on ? "border-brand text-brand-deep" : "border-transparent text-ink",
              )}
            >
              <span className="flex items-center gap-1.5 text-[15px] leading-tight font-semibold whitespace-nowrap">
                <span className={cn("size-1.5 rounded-full", on ? "live-dot bg-brand" : "bg-brand/50")} />
                {p.plate}
              </span>
              <span className={cn("font-mono text-xs whitespace-nowrap tabular", on ? "text-brand-deep/80" : "text-mute")}>
                <LiveTimer since={p.since} /> · {p.manifests} ใบ
              </span>
            </Link>
          );
        })}
        <Link
          href="/pickups/new"
          aria-label="รับรถคันใหม่"
          className="grid h-14 w-12 shrink-0 place-items-center border-b-[3px] border-transparent text-mute hover:text-ink active:bg-muted"
        >
          <PlusIcon className="size-5" />
        </Link>
      </div>
    </nav>
  );
}

/**
 * ปัดซ้าย/ขวาในหน้างาน = ไปคันถัดไป/ก่อนหน้า
 * ไม่ทำงานตอนแตะช่องกรอก ตาราง เมนูเด้ง หรือแถบที่เลื่อนแนวนอนได้ (กันปัดผิด)
 */
function useSwipeBetween(hrefs: string[], index: number) {
  const router = useRouter();
  const key = hrefs.join("|");
  useEffect(() => {
    if (hrefs.length < 2 || index < 0) return;
    let start: { x: number; y: number } | null = null;
    const blocked = (t: EventTarget | null) =>
      t instanceof Element &&
      !!t.closest("input, textarea, select, table, [role=dialog], [data-radix-popper-content-wrapper], .overflow-x-auto, [data-no-swipe]");
    const onStart = (e: TouchEvent) => {
      start = e.touches.length === 1 && !blocked(e.target) ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
      const next = (index + (dx < 0 ? 1 : -1) + hrefs.length) % hrefs.length;
      router.push(hrefs[next]);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, index, router]);
}

/** แถบเมนูล่างจอ (มือถือเท่านั้น) — นิ้วโป้งเอื้อมถึง */
function MobileTabBar({ path, doing, user, pendingUsers }: { path: string; doing: number; user: NavUser; pendingUsers: number }) {
  // จำหน้าที่เปิดเมนูไว้ — เปลี่ยนหน้าแล้วเมนูปิดเอง
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const moreOpen = openedAt === path;
  const setMoreOpen = (open: boolean | ((o: boolean) => boolean)) =>
    setOpenedAt((typeof open === "function" ? open(moreOpen) : open) ? path : null);
  const moreActive = [...MORE, ...ACCOUNT].some((l) => isActive(path, l.href));

  const tab = (l: NavLink) => {
    const on = isActive(path, l.href);
    const Icon = l.icon;
    return (
      <Link
        key={l.href}
        href={l.href}
        className={cn("flex flex-col items-center justify-center gap-1 text-[11px]", on ? "font-semibold text-brand" : "text-mute")}
        aria-current={on ? "page" : undefined}
      >
        <span className="relative">
          <Icon className={cn("size-6", on && "stroke-[2.25]")} />
          {l.href === "/pickups" && <DoingBadge doing={doing} className="absolute -top-1.5 -right-2.5" />}
        </span>
        {l.short ?? l.label}
      </Link>
    );
  };
  const link = (href: string) => LINKS.find((l) => l.href === href)!;

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              className="no-print fixed inset-0 z-40 bg-black/30 sm:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              className="no-print fixed inset-x-0 bottom-0 z-50 rounded-t-2xl bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-card sm:hidden"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              role="dialog"
              aria-label="เมนูเพิ่มเติม"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-mute">เมนู</span>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="-mr-2 grid size-11 place-items-center rounded-full text-mute active:bg-muted"
                  aria-label="ปิด"
                >
                  <XIcon className="size-5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MORE.map((l) => {
                  const Icon = l.icon;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className={cn(
                        "flex h-14 items-center gap-3 rounded-xl px-4 text-base active:bg-muted",
                        isActive(path, l.href) ? "bg-brand-soft font-medium text-brand-deep" : "text-body",
                      )}
                    >
                      <Icon className="size-5" />
                      {l.label}
                    </Link>
                  );
                })}
              </div>
              {user && (
                <div className="mt-3 border-t pt-3">
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    {accountLinks(user).map((l) => {
                      const Icon = l.icon;
                      return (
                        <Link
                          key={l.href}
                          href={l.href}
                          className={cn(
                            "flex h-12 items-center gap-3 rounded-xl px-4 text-sm active:bg-muted",
                            isActive(path, l.href) ? "bg-canvas-soft-2 font-medium text-ink" : "text-body",
                          )}
                        >
                          <Icon className="size-5" />
                          {l.label}
                          {l.href === "/users" && <DoingBadge doing={pendingUsers} className="bg-warning" />}
                        </Link>
                      );
                    })}
                  </div>
                  <form action={logout} className="flex items-center justify-between gap-3 px-1">
                    <span className="min-w-0 truncate text-sm text-body">
                      <span className="font-medium text-ink">{user.name}</span> @{user.username}
                    </span>
                    <Button type="submit" variant="outline" className="h-11 shrink-0">
                      <LogOutIcon />
                      ออกจากระบบ
                    </Button>
                  </form>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden"
        aria-label="เมนูหลัก"
      >
        <div className="grid h-[var(--tabbar-h)] grid-cols-5 px-1.5">
          {tab(link("/"))}
          {tab(link("/pickups"))}
          {/* ปุ่มกลาง: เริ่มงานรถเข้า — งานที่ทำบ่อยที่สุด */}
          <Link href="/pickups/new" aria-label="เริ่มงานรถเข้า" className="flex flex-col items-center justify-start">
            <span className="grid size-12 -translate-y-3 place-items-center rounded-2xl bg-brand text-white shadow-[0_8px_18px_-8px_rgba(37,99,235,0.7)] transition-transform active:scale-95">
              <PlusIcon className="size-6 stroke-[2.25]" />
            </span>
            <span className="-mt-2 text-[11px] font-medium text-brand">รับรถ</span>
          </Link>
          {tab(link("/tracking"))}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={cn("flex flex-col items-center justify-center gap-0.5 text-[11px]", moreActive || moreOpen ? "text-ink" : "text-mute")}
            aria-expanded={moreOpen}
          >
            <span className="relative">
              <EllipsisIcon className="size-6" />
              {pendingUsers > 0 && <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-warning" />}
            </span>
            เพิ่มเติม
          </button>
        </div>
      </nav>
    </>
  );
}

/** ไม่ได้ดูหน้าจอนานเท่านี้ กลับมาแล้วโหลดข้อมูลใหม่ (เผื่อเครื่องอื่นแก้ระหว่างนั้น) */
const RETURN_REFRESH_MS = 60_000;

/**
 * หน้าที่เปิดไว้ถูกเก็บแคชในเครื่อง (staleTimes ใน next.config) — แก้จากเครื่องนี้แคชล้างเอง
 * แต่ถ้าเครื่องอื่นแก้ จะไม่รู้ → สลับแอป/พับจอไปนานกว่า 1 นาที กลับมาแล้วดึงใหม่
 */
function useRefreshOnReturn() {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > RETURN_REFRESH_MS) {
        hiddenAt.current = null;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [router]);
}

/** มุมขวาบน (จอใหญ่) — ชื่อคนที่ login + เมนูบัญชี + ออกจากระบบ */
function UserMenu({ user, pendingUsers }: { user: NonNullable<NavUser>; pendingUsers: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="hidden h-9 max-w-40 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm text-body hover:bg-muted sm:inline-flex"
        >
          <span className="truncate font-medium text-ink">{user.name}</span>
          {pendingUsers > 0 && <span className="size-2 shrink-0 rounded-full bg-warning" aria-label={`รออนุมัติ ${pendingUsers} คน`} />}
          <ChevronDownIcon className="size-3.5 shrink-0 text-mute" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1.5">
        <p className="px-2.5 pt-1.5 pb-2 text-xs text-mute">@{user.username}</p>
        {accountLinks(user).map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.href} href={l.href} className="flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-body hover:bg-muted hover:text-ink">
              <Icon className="size-4" />
              {l.label}
              {l.href === "/users" && <DoingBadge doing={pendingUsers} className="ml-auto bg-warning" />}
            </Link>
          );
        })}
        <form action={logout} className="mt-1 border-t pt-1">
          <button type="submit" className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-error-deep hover:bg-muted">
            <LogOutIcon className="size-4" />
            ออกจากระบบ
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** แถบเมนูซ้ายสีกรมท่า (จอใหญ่ ≥ lg) — เมนู · ปุ่มเริ่มงาน · รถที่กำลังรับของ · ผู้ใช้ */
function Sidebar({
  path,
  doing,
  user,
  pendingUsers,
  active,
}: {
  path: string;
  doing: number;
  user: NavUser;
  pendingUsers: number;
  active: ActivePickup[];
}) {
  const item = (l: NavLink) => {
    const on = isActive(path, l.href);
    const Icon = l.icon;
    return (
      <Link
        key={l.href}
        href={l.href}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
          on ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
        )}
      >
        <Icon className="size-[18px]" />
        <span className="flex-1">{l.label}</span>
        {l.href === "/pickups" && <DoingBadge doing={doing} className="bg-brand" />}
        {l.href === "/users" && <DoingBadge doing={pendingUsers} className="bg-error" />}
      </Link>
    );
  };

  return (
    <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-w)] flex-col bg-navy text-white lg:flex">
      <Link href="/" className="flex h-16 items-center px-5" aria-label="TrackFlow หน้าแรก">
        <Logo tone="light" />
      </Link>
      <div className="px-3 pb-3">
        <Link
          href="/pickups/new"
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white transition-colors hover:bg-brand-deep"
        >
          <PlusIcon className="size-4" />
          เริ่มงานรถเข้า
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 scrollbar-none" aria-label="เมนูหลัก">
        {GROUPS.map((g, i) => (
          <div key={g.title} className="space-y-0.5">
            <p className={cn("px-3 pb-1.5 text-xs font-medium text-slate-400", i > 0 && "pt-5")}>{g.title}</p>
            {g.links.map(item)}
          </div>
        ))}
        {user && (
          <>
            <p className="px-3 pt-5 pb-1.5 text-xs font-medium text-slate-400">บัญชี</p>
            {accountLinks(user).map(item)}
          </>
        )}
        {active.length > 0 && (
          <>
            <p className="flex items-center gap-1.5 px-3 pt-5 pb-1.5 text-xs font-medium text-slate-400">
              <span className="size-1.5 animate-pulse rounded-full bg-warning" />
              กำลังรับของ
            </p>
            {active.map((p) => {
              const on = path.startsWith(`/pickups/${p.id}`);
              return (
                <Link
                  key={p.id}
                  href={`/pickups/${p.id}`}
                  prefetch={true}
                  className={cn("flex h-10 items-center gap-2 rounded-xl px-3 text-sm", on ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white")}
                >
                  <span className="flex-1 truncate font-medium">{p.plate}</span>
                  <LiveTimer since={p.since} className="font-mono text-xs text-slate-400 tabular" />
                </Link>
              );
            })}
          </>
        )}
      </nav>
      {user && (
        <form action={logout} className="flex items-center gap-3 border-t border-white/10 p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold">{user.name.slice(0, 1)}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-slate-400">@{user.username}</span>
          </span>
          <button type="submit" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white" aria-label="ออกจากระบบ" title="ออกจากระบบ">
            <LogOutIcon className="size-4" />
          </button>
        </form>
      )}
    </aside>
  );
}
