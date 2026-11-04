// เวลาทั้งหมดเก็บเป็น UTC แสดงผลเป็นเวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเซิร์ฟเวอร์
export const TZ = "Asia/Bangkok";
const OFFSET = "+07:00";

const dateTimeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" });

export const fmtDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : "—");
export const fmtTime = (d: Date | null | undefined) => (d ? timeFmt.format(d) : "—");
export const fmtDate = (d: Date | null | undefined) => (d ? dateFmt.format(d) : "—");

/** ส่วนต่างเวลาเป็น "1 ชม. 5 นาที" */
export function fmtDuration(from: Date, to: Date | null | undefined) {
  if (!to) return null;
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h} ชม. ${mins % 60} นาที` : `${mins} นาที`;
}

/** ค่า "YYYY-MM-DDTHH:mm" สำหรับ <input type="datetime-local"> ตามเวลาไทย */
export function toLocalInput(d: Date | null | undefined) {
  if (!d) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** อ่านค่าจาก datetime-local (เวลาไทย) กลับเป็น Date */
export function fromLocalInput(v: FormDataEntryValue | null): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" ของวันนี้ตามเวลาไทย */
export const todayKey = () => toLocalInput(new Date()).slice(0, 10);

/** ช่วง [เริ่มวัน, เริ่มวันถัดไป) ของวันที่ "YYYY-MM-DD" ตามเวลาไทย */
export function dayRange(key: string) {
  const start = new Date(`${key}T00:00:00${OFFSET}`);
  return { gte: start, lt: new Date(start.getTime() + 86_400_000) };
}

/** ทะเบียนรถ: ตัดช่องว่างซ้ำ */
export const normalizePlate = (s: string) => s.trim().replace(/\s+/g, " ");

/** เลข manifest / tracking: ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง */
export const normalizeCode = (s: string) => s.trim().replace(/\s+/g, "").toUpperCase();


/** น้ำหนักกรัม → อ่านง่าย: 850 ก. · 3.5 กก. · 1,250.75 กก. */
export function fmtWeight(grams: number | null | undefined) {
  if (grams == null) return "—";
  if (grams < 1000) return `${Math.round(grams).toLocaleString("th-TH")} ก.`;
  return `${(grams / 1000).toLocaleString("th-TH", { maximumFractionDigits: 2 })} กก.`;
}