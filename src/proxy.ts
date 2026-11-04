import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionToken } from "@/lib/session-token";

/**
 * ด่านแรก (Next 16 เรียก middleware ว่า proxy) — ไม่ได้ login ห้ามเข้าทุกหน้า
 * server action ตรวจซ้ำอีกชั้นด้วย requireUser() เสมอ (Next แนะนำไม่ให้พึ่ง proxy อย่างเดียว)
 */
export function proxy(req: NextRequest) {
  const user = readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login" || pathname === "/register") {
    // login อยู่แล้ว ไม่ต้องเห็นหน้า login / สมัคร
    return user ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (user) return NextResponse.next();

  // API ตอบ 401 ไม่ redirect (cron / fetch จะได้รู้ว่าโดนปฏิเสธ)
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL("/login", req.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // ทุกหน้า ยกเว้นไฟล์ของ Next / ไฟล์ static
    // และ keepalive ของ cron (มี CRON_SECRET ตรวจเองอยู่แล้ว) · webhook ของ LINE (ตรวจลายเซ็นเอง) · รายงานประจำวัน (ตรวจกุญแจเอง)
    // · manifest ของ PWA (เบราว์เซอร์ขอโดยไม่ส่ง cookie) · API เช็คสถานะ Flash (ตรวจ login หรือ FLASH_API_KEY เอง) · webhook ของ Flash (ตรวจลายเซ็นเอง) · อัปเดตสถานะเบื้องหลัง (ตรวจกุญแจเอง) · ลิงก์สาธารณะดูสถานะ /share (ไม่ต้อง login)
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.webmanifest|sw\\.js|offline\\.html|api/bigseller/keepalive|api/line/webhook|api/line/daily|api/flash/track|api/flash/webhook|api/track/tick|api/track/health|share/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
