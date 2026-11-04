import { cn } from "cn";

/**
 * โลโก้ TrackFlow — สี่เหลี่ยมมุมมนสีน้ำเงิน + ลูกศรพุ่งไปข้างหน้า (Track · Transit · Deliver)
 * tone="light" ใช้บนพื้นกรมท่า (ตัวหนังสือขาว)
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="trackflow-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#trackflow-mark)" />
      {/* ลูกศรสองชั้น — ชั้นหลังจาง ให้ความรู้สึกเคลื่อนที่ */}
      <path d="M8.5 20.5 17 12h-4.2l1.6-3.2H23v8.6l-3.2 1.6V14.8l-8.5 8.5z" fill="#fff" />
      <path d="M7 15.2 11.6 10.6h3l-4.6 4.6z" fill="#fff" opacity=".55" />
    </svg>
  );
}

export function Logo({ tone = "dark", className }: { tone?: "dark" | "light"; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <LogoMark />
      <span className={cn("text-[19px] leading-none font-bold tracking-[-0.4px]", tone === "light" ? "text-white" : "text-ink")}>
        Track<span className={tone === "light" ? "text-brand-sky" : "text-brand"}>Flow</span>
      </span>
    </span>
  );
}
