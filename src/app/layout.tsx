import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist_Mono, Inter, Sarabun } from "next/font/google";
import { Nav } from "@/components/nav";
import { NavProgress } from "@/components/nav-progress";
import { InstallHint } from "@/components/install-hint";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { db } from "@/lib/db";
import { getUser, isAdmin } from "@/lib/auth";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Inter ไม่มีอักษรไทย — ไทยใช้ Sarabun
const thai = Sarabun({ variable: "--font-thai", subsets: ["thai", "latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "TrackFlow", template: "%s · TrackFlow" },
  description: "บันทึกรถเข้ารับสินค้า ใบนำจ่าย และติดตามพัสดุ",
  applicationName: "TrackFlow",
  // iPhone: ลงหน้าจอโฮมแล้วเปิดเต็มจอ ไอคอน/ชื่อของเราเอง (manifest อยู่ที่ app/manifest.ts)
  appleWebApp: { capable: true, title: "TrackFlow", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
};

// cover = ใช้พื้นที่ใต้แถบ home ของ iPhone ได้ (เว้นด้วย safe-area-inset-bottom)
// themeColor = สีแถบสถานะ/แถบบนตอนเปิดเป็นแอป
export const viewport: Viewport = { viewportFit: "cover", themeColor: "#ffffff" };

/** nav รู้ว่ามีงานไหนกำลังทำอยู่ (สลับคันได้จากทุกหน้า) — โหลดแยก ไม่ให้หน้าค้างรอ */
async function NavWithCount() {
  const user = await getUser();
  // ยังไม่ login (หน้า login) — ไม่ต้องถาม DB
  if (!user) return <Nav doing={0} />;
  // ยิงพร้อมกันรอบเดียว — งานที่กำลังทำมีไม่กี่คัน ดึงทุกคันแล้วกรองเจ้าของทีหลัง (ไม่ต้องรอรู้ว่าเป็นแอดมินก่อน)
  const [doing, pendingUsers, admin] = await Promise.all([
    db.pickup
      .findMany({
        where: { status: "DOING" },
        orderBy: { arrivedAt: "asc" },
        select: { id: true, plate: true, arrivedAt: true, createdById: true, _count: { select: { manifests: true } } },
      })
      .catch(() => []),
    // คนสมัครเองที่รออนุมัติ (แสดงเฉพาะแอดมิน)
    db.user.count({ where: { approvedAt: null } }).catch(() => 0),
    isAdmin(user).catch(() => false),
  ]);
  // staff เห็นเฉพาะงานของตัวเอง (src/lib/pickup-access.ts)
  const active = admin ? doing : doing.filter((p) => p.createdById === user.id);
  return (
    <Nav
      doing={active.length}
      pendingUsers={admin ? pendingUsers : 0}
      user={{ name: user.name, username: user.username, admin }}
      active={active.map((p) => ({ id: p.id, plate: p.plate, since: p.arrivedAt.toISOString(), manifests: p._count.manifests }))}
    />
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${inter.variable} ${geistMono.variable} ${thai.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>
          <NavProgress />
          <InstallHint />
          <Suspense fallback={<Nav doing={0} />}>
            <NavWithCount />
          </Suspense>
          {/* มือถือ: เว้นที่ด้านล่างให้แถบเมนูล่างจอ */}
          {/* จอใหญ่: เว้นซ้ายให้แถบเมนูกรมท่า */}
          <div className="flex flex-1 flex-col lg:pl-[var(--sidebar-w)]">
            <main className="mx-auto w-full max-w-6xl flex-1 2xl:max-w-[90rem] px-4 pt-5 pb-[calc(env(safe-area-inset-bottom)+var(--tabbar-h)+2rem)] sm:px-6 sm:py-8">
              {children}
            </main>
          </div>
          <Toaster
            position="bottom-center"
            richColors
            closeButton
            // ลอยเหนือแถบเมนูล่าง (--tabbar-h ใน globals.css)
            mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + var(--tabbar-h) + 0.5rem)" }}
          />
        </TooltipProvider>
      </body>
    </html>
  );
}
