import { cn } from "cn";

/**
 * น้อง Claude — มาสคอตพิกเซลตอนโหลด (ตาราง 12×8 ช่อง): ย่ำขาอยู่กับที่ ตัวเด้งขึ้นลง กะพริบตา
 * CSS ล้วน (globals.css: .buddy-*) ใช้ได้ทั้ง server / client component · ปิดการขยับเองเมื่อเครื่องตั้งลดการเคลื่อนไหว
 * ขึ้นช้านิดนึง (buddy-in) — หน้าที่โหลดเร็วจะไม่เห็นมาสคอตแวบไปมา
 */
const ORANGE = "#d97757";

export function LoadingBuddy({ size = 72, label = "กำลังโหลด", className }: { size?: number; label?: string | null; className?: string }) {
  return (
    <div role="status" className={cn("buddy-in flex flex-col items-center gap-2.5", className)}>
      {/* viewBox เผื่อขอบบน 1 ช่องให้ตัวเด้ง · ล่าง 1 ช่องให้เงา */}
      <svg width={size} height={(size * 10) / 12} viewBox="0 -1 12 10" aria-hidden="true" shapeRendering="crispEdges">
        <rect className="buddy-shadow" x="2" y="8.4" width="8" height="0.6" fill="#0f172a" opacity="0.12" />
        {/* ขา 2 คู่ ย่ำสลับกัน */}
        <g className="buddy-leg-a" fill={ORANGE}>
          <rect x="2" y="6" width="1" height="2" />
          <rect x="7" y="6" width="1" height="2" />
        </g>
        <g className="buddy-leg-b" fill={ORANGE}>
          <rect x="4" y="6" width="1" height="2" />
          <rect x="9" y="6" width="1" height="2" />
        </g>
        <g className="buddy-body">
          <rect x="2" y="0" width="8" height="6.05" fill={ORANGE} />
          <rect x="0" y="2" width="12" height="2" fill={ORANGE} />
          <g className="buddy-blink" fill="#000">
            <rect x="3" y="1" width="1" height="1" />
            <rect x="8" y="1" width="1" height="1" />
          </g>
        </g>
      </svg>
      {label && (
        <p className="text-sm font-medium text-ink">
          {label}
          <span className="buddy-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      )}
    </div>
  );
}
