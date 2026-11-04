import "server-only";
import { createSign } from "node:crypto";
import { SHEET_COLUMNS } from "./sheets-columns";

/**
 * เขียนลง Google Sheets ด้วย Service Account — ไม่ต้องลง package (เซ็น JWT ด้วย node:crypto แล้วยิง REST API ตรง)
 * ตั้งค่าใน .env (ดู .env.example):
 *   GOOGLE_SHEETS_ID                 รหัสชีต (ใน URL …/spreadsheets/d/<ID>/edit) — แท็บรายวัน (8OCT26) สร้างให้เอง
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL     อีเมล service account (ต้องกดแชร์ชีตให้อีเมลนี้เป็น "ผู้แก้ไข")
 *   GOOGLE_SERVICE_ACCOUNT_KEY       private key จากไฟล์ JSON (บรรทัดเดียว ใช้ \n แทนขึ้นบรรทัดใหม่)
 * อ่านค่าใหม่ทุกครั้ง — แก้ .env แล้วใช้ได้เลยไม่ต้องรีสตาร์ท (dev)
 */
function config() {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "");
  return {
    sheetId: clean(process.env.GOOGLE_SHEETS_ID),
    email: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: clean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY).replace(/\\n/g, "\n"),
  };
}

/** ตั้งค่าครบไหม — ไม่ครบไม่ต้องโชว์ปุ่ม */
export function sheetsConfigured() {
  const c = config();
  return Boolean(c.sheetId && c.email && c.key.includes("PRIVATE KEY"));
}

/** ลิงก์เปิดชีต (โชว์ในข้อความหลังส่ง) */
export const sheetsUrl = () => `https://docs.google.com/spreadsheets/d/${config().sheetId}/edit`;

let cached: { token: string; exp: number } | null = null;

/** access token ของ service account — เก็บไว้ใช้ซ้ำจนใกล้หมดอายุ (1 ชม.) */
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const { email, key } = config();
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(body).sign(key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${signature}` }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new SheetsError("auth", json.error_description ?? `HTTP ${res.status}`);
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export class SheetsError extends Error {
  constructor(
    public kind: "auth" | "permission" | "not-found" | "quota" | "other",
    detail: string,
  ) {
    super(detail);
  }
}

/** ข้อความที่คนอ่านเข้าใจ — ไม่ส่ง error ดิบไปหน้าเว็บ */
export const SHEETS_HINT: Record<SheetsError["kind"], string> = {
  auth: "ยืนยันตัวกับ Google ไม่ผ่าน — เช็ค GOOGLE_SERVICE_ACCOUNT_EMAIL / KEY ใน .env",
  permission: "ไม่มีสิทธิ์เขียนชีต — แชร์ชีตให้อีเมล service account เป็น \"ผู้แก้ไข\"",
  "not-found": "ไม่พบชีต — เช็ค GOOGLE_SHEETS_ID ใน .env",
  quota: "Google Sheets ใช้เกินโควตาชั่วคราว (60 ครั้ง/นาที) — รอ 1 นาทีแล้วกดอีกครั้ง",
  other: "ส่งไป Google Sheets ไม่สำเร็จ — ลองใหม่อีกครั้ง",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * เรียก Sheets API — กันล่ม:
 * - timeout 30 วิ ต่อครั้ง (Google ค้าง ไม่ให้ปุ่มหมุนค้างจน server ตัด)
 * - 429 (เกินโควตา 60 ครั้ง/นาที) / 5xx / เน็ตหลุด → รอแล้วลองใหม่ สูงสุด 4 ครั้ง (1 → 2 → 4 → 8 วิ)
 */
async function call(path: string, init?: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${config().sheetId}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new SheetsError("other", `เชื่อม Google Sheets ไม่ได้: ${e instanceof Error ? e.message : e}`);
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt + Math.random() * 500);
      continue;
    }
    const detail = await res.text();
    throw new SheetsError(
      res.status === 403 ? "permission" : res.status === 404 || res.status === 400 ? "not-found" : res.status === 429 ? "quota" : "other",
      detail.slice(0, 500),
    );
  }
}

/** range ของแท็บใน A1 notation — ครอบ ' เผื่อชื่อมีช่องว่าง/ภาษาไทย */
const tabRange = (tab: string, range: string) => `'${tab.replace(/'/g, "''")}'!${range}`;

export { dailyTabName } from "./sheets-columns";

/** แท็บที่มีอยู่แล้วในชีต — ชื่อ → sheetId */
async function listTabs() {
  const res = (await call(`?fields=${encodeURIComponent("sheets.properties(sheetId,title)")}`)) as {
    sheets?: { properties: { sheetId: number; title: string } }[];
  };
  return new Map((res.sheets ?? []).map((s) => [s.properties.title, s.properties.sheetId]));
}

/** หัวตารางแถว 1: ตัวหนา พื้นฟ้าอ่อน ตัดคำ ตรึงไว้ */
const headerFormat = (sheetId: number) => [
  {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          wrapStrategy: "WRAP",
          verticalAlignment: "MIDDLE",
          backgroundColor: { red: 0.86, green: 0.92, blue: 1 },
        },
      },
      fields: "userEnteredFormat(textFormat,wrapStrategy,verticalAlignment,backgroundColor)",
    },
  },
  { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
];

const writeHeader = (title: string, header: string[]) =>
  call(`/values/${encodeURIComponent(tabRange(title, "A1"))}?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values: [header] }) });

/** สร้างแท็บใหม่พร้อมหัวตาราง (ตัวหนา ตรึงแถวบน ตัดคำในหัว) */
async function createTab(title: string, header: string[]) {
  const res = (await call(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }),
  })) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
  const sheetId = res.replies[0].addSheet.properties.sheetId;
  await writeHeader(title, header);
  await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: headerFormat(sheetId) }) });
  return sheetId;
}

/**
 * แท็บที่มีอยู่แล้ว — แถว 1 ต้องเป็นหัวตาราง (ชื่อคอลัมน์)
 * หัวเก่า (ขึ้นต้นเหมือนกัน แต่ขาดคอลัมน์ใหม่) → เขียนทับแถว 1 · ไม่มีหัวเลย (แถว 1 เป็นข้อมูล) → แทรกแถวบนสุดแล้วใส่หัว
 */
/**
 * คอลัมน์ที่เลิกใช้แล้ว — เจอในแท็บเดิมจะลบทั้งคอลัมน์ (ข้อมูลช่องอื่นเลื่อนตามให้ตรงหัวใหม่)
 * (สแกนลงกรงย้ายไปรวมกับ "ผู้สแกน (BigSeller)" + "เวลาสแกน")
 */
const RETIRED_COLUMNS = new Set(["สินค้าลงกรง (จาก พนักงานบ้านไท)\nสแกนและจัดส่งบน App และย้ายไปที่รอรับสินค้า"].map((h) => h.trim()));

/**
 * คอลัมน์ที่เปลี่ยนชื่อ (ชื่อเดิม → ชื่อใหม่) — แท็บเก่าแค่เปลี่ยนหัว ไม่แทรก/ลบคอลัมน์ (ค่าในแถวเดิมเปลี่ยนตอนอัปเดตแถวนั้น)
 */
const RENAMED_COLUMNS = new Map([["เลขตระก้า", "Manifest"]]);

/**
 * แถว 1 ต้องเป็นหัวตารางตาม header — ปรับโครงแท็บเดิมให้ตรงตาม "ชื่อคอลัมน์" ไม่ใช่ตำแหน่ง:
 * - คอลัมน์ที่เปลี่ยนชื่อ (RENAMED_COLUMNS) → ถือเป็นคอลัมน์เดิม แค่เขียนหัวใหม่
 * - คอลัมน์ที่เลิกใช้ (RETIRED_COLUMNS) → ลบทั้งคอลัมน์
 * - คอลัมน์ใหม่ที่แท็บเดิมยังไม่มี → แทรกคอลัมน์ว่างตรงตำแหน่งของมัน (ข้อมูลเดิมเลื่อนตาม ไม่ทับกัน)
 * - ไม่มีหัวเลย (แถว 1 เป็นข้อมูล) → แทรกแถวบนสุดแล้วใส่หัว
 */
async function ensureHeader(title: string, sheetId: number, header: string[]) {
  const res = (await call(`/values/${encodeURIComponent(tabRange(title, "1:1"))}`)) as { values?: string[][] };
  const want = header.map((h) => h.trim());
  let row = (res.values?.[0] ?? []).map((v) => String(v).trim()).map((v) => RENAMED_COLUMNS.get(v) ?? v);
  const renamed = (res.values?.[0] ?? []).some((v) => RENAMED_COLUMNS.has(String(v).trim()));
  if (!renamed && row.length === want.length && row.every((v, i) => v === want[i])) return;

  if (row.length && row[0] !== want[0]) {
    // แถว 1 ไม่ใช่หัวตาราง — แทรกแถวว่างไว้ใส่หัว
    await call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, inheritFromBefore: false } }] }),
    });
    row = [];
  }

  if (row.length) {
    const requests: object[] = [];
    // 1) ลบคอลัมน์ที่เลิกใช้ — จากขวาไปซ้าย ตำแหน่งที่เหลือจะได้ไม่เพี้ยน
    for (let i = row.length - 1; i >= 0; i--) {
      if (RETIRED_COLUMNS.has(row[i])) {
        requests.push({ deleteDimension: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 } } });
        row.splice(i, 1);
      }
    }
    // 2) แทรกคอลัมน์ใหม่ที่ยังไม่มี ตรงตำแหน่งตามหัวใหม่ (ซ้าย → ขวา) — ชื่อที่ซ้ำกันได้ (ตอนขึ้น/ปิด รถ) นับตามจำนวน
    want.forEach((name, i) => {
      const haveCount = row.filter((v) => v === name).length;
      const needCount = want.slice(0, i + 1).filter((v) => v === name).length;
      if (row[i] !== name && haveCount < needCount && i <= row.length) {
        requests.push({ insertDimension: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, inheritFromBefore: false } });
        row.splice(i, 0, name);
      }
    });
    if (requests.length) await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  }

  await writeHeader(title, header);
  await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: headerFormat(sheetId) }) });
}

/** ให้แท็บรายวันมีหัวตาราง/โครงคอลัมน์ล่าสุดก่อนอ่านตำแหน่งคอลัมน์ (เช่น หาเลข tracking) */
export async function ensureDailyHeader(tab: string) {
  const sheetId = (await listTabs()).get(tab);
  if (sheetId != null) await ensureHeader(tab, sheetId, SHEET_COLUMNS);
}

/**
 * แท็บ "ภาพรวม ณ ตอนนี้" (เช่น ติดตาม-ยกเลิก ยังไม่คืน) — ล้างทั้งแท็บแล้วเขียนหัว + ทุกแถวใหม่
 * ยังไม่มีแท็บ → สร้างให้
 */
export async function writeSnapshotTab(title: string, header: string[], rows: SheetRow[]) {
  const tabs = await listTabs();
  let sheetId = tabs.get(title);
  const created = sheetId == null;
  if (sheetId == null) sheetId = await createTab(title, header);
  else await call(`/values/${encodeURIComponent(tabRange(title, "A:Z"))}:clear`, { method: "POST", body: "{}" });
  await call(`/values/${encodeURIComponent(tabRange(title, "A1"))}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [header, ...rows.map((r) => r.values)] }),
  });
  // ล้างสีเก่าทั้งแท็บ (แถวเดิมอาจมากกว่ารอบนี้) แล้วระบายสีตามสถานะใหม่
  const reset = {
    repeatCell: {
      range: { sheetId, startRowIndex: 1 },
      cell: { userEnteredFormat: { backgroundColor: WHITE, textFormat: { bold: false } } },
      fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
    },
  };
  const requests = [...(created ? [] : headerFormat(sheetId)), reset, ...rowFormats(sheetId, 2, header.length, rows)];
  await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  return { total: rows.length, created };
}

export type Rgb = { red: number; green: number; blue: number };

/** 1 แถวที่จะเขียน + สี: tint = พื้นทั้งแถว (อ่อน) · strong = ช่องสถานะ (เข้ม ตัวหนา) */
export type SheetRow = { values: (string | number)[]; tint?: Rgb; strong?: { cols: number[]; color: Rgb } };

const WHITE: Rgb = { red: 1, green: 1, blue: 1 };

/**
 * คำสั่งระบายสีแถวที่เพิ่งเขียน (เริ่มที่แถว firstRow ของชีต)
 * ทุกแถวกำหนดพื้นเสมอ (ไม่มีสถานะ = ขาว) — กันแถวใหม่รับสีจากแถวข้างบน · ตัดคำ ชิดบน (สินค้าหลายบรรทัดอ่านง่าย)
 * แถวติดกันที่สีเหมือนกันรวมเป็นคำสั่งเดียว
 */
function rowFormats(sheetId: number, firstRow: number, width: number, rows: SheetRow[]) {
  const requests: object[] = [];
  const same = (a?: Rgb, b?: Rgb) => JSON.stringify(a ?? WHITE) === JSON.stringify(b ?? WHITE);
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && same(rows[j].tint, rows[i].tint)) j++;
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: firstRow - 1 + i, endRowIndex: firstRow - 1 + j, startColumnIndex: 0, endColumnIndex: width },
        cell: { userEnteredFormat: { backgroundColor: rows[i].tint ?? WHITE, textFormat: { bold: false }, wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold,wrapStrategy,verticalAlignment)",
      },
    });
    i = j;
  }
  rows.forEach((r, i) => {
    for (const col of r.strong?.cols ?? []) {
      if (col < 0) continue;
      requests.push({
        repeatCell: {
          range: { sheetId, startRowIndex: firstRow - 1 + i, endRowIndex: firstRow + i, startColumnIndex: col, endColumnIndex: col + 1 },
          cell: { userEnteredFormat: { backgroundColor: r.strong!.color, textFormat: { bold: true } } },
          fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
        },
      });
    }
  });
  return requests;
}

/** 1 แถวของแท็บรายวัน + เลข tracking (ใช้หาแถวเดิม) */
export type KeyedRow = { key: string; row: SheetRow };

const normNo = (v: unknown) => String(v ?? "").replace(/^'/, "").trim().toUpperCase();

/** แท็บรายวัน (8OCT26 …) ที่มีอยู่ในชีต — ใหม่ → เก่า */
export async function listDailyTabs() {
  const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dateOf = (t: string) => {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(t);
    return m ? Date.UTC(2000 + Number(m[3]), MONTHS.indexOf(m[2]), Number(m[1])) : NaN;
  };
  return [...(await listTabs()).keys()].filter((t) => !Number.isNaN(dateOf(t))).sort((a, b) => dateOf(b) - dateOf(a));
}

/** เลข tracking ในแท็บ → แถว (เลขเดียวกันอาจมีหลายแถว — ส่งซ้ำก่อนมีระบบอัปเดต) */
export async function trackingRowsOf(tab: string) {
  const col = (await call(`/values/${encodeURIComponent(tabRange(tab, `${TRACKING_COL}:${TRACKING_COL}`))}`)) as { values?: string[][] };
  const rowsOf = new Map<string, number[]>();
  (col.values ?? []).forEach((r, i) => {
    const t = normNo(r[0]);
    if (t && i > 0) rowsOf.set(t, [...(rowsOf.get(t) ?? []), i + 1]);
  });
  return rowsOf;
}

/**
 * ทั้งแท็บ (A ถึงคอลัมน์สุดท้ายของเรา) แบบสูตร — ลิงก์ =HYPERLINK(...) ได้กลับมาเป็นสูตร เขียนคืนแล้วยังเป็นลิงก์
 * @returns rowsOf = เลข tracking → แถว · values[i] = ค่าแถวที่ i+1
 */
async function currentRows(tab: string, lastCol: string) {
  const res = (await call(`/values/${encodeURIComponent(tabRange(tab, `A1:${lastCol}`))}?valueRenderOption=FORMULA`)) as { values?: unknown[][] };
  const values = res.values ?? [];
  const col = SHEET_COLUMNS.indexOf("หมายเลข tracking");
  const rowsOf = new Map<string, number[]>();
  values.forEach((r, i) => {
    const t = normNo(r[col]);
    if (t && i > 0) rowsOf.set(t, [...(rowsOf.get(t) ?? []), i + 1]);
  });
  return { rowsOf, values };
}

/**
 * ค่าใหม่ทับค่าเดิม ยกเว้นช่องที่ค่าใหม่ว่าง → ใช้ค่าเดิมในชีต (ข้อมูลที่เคยมีไม่หายเพราะรอบนี้ดึงไม่ได้)
 * ค่าเดิมที่เป็นตัวเลขยาว (เลขออเดอร์/แทร็ค) ใส่ ' นำหน้า — เขียนกลับแบบ USER_ENTERED แล้วไม่กลายเป็น 3.29E+18
 */
function keepOld(next: (string | number)[], old: unknown[] | undefined) {
  if (!old) return next;
  return next.map((v, i) => {
    if (v !== "" && v != null) return v;
    const o = old[i];
    if (o == null || o === "") return v;
    if (typeof o === "number") return o;
    const s = String(o);
    return /^\d{6,}$/.test(s) ? `'${s}` : s;
  });
}

/**
 * ส่งลงแท็บรายวัน — เคยส่งแล้ว (เจอเลข tracking ในแท็บนั้น) = เขียนทับแถวเดิม (ช่องที่ไม่มีข้อมูลรอบนี้ใช้ค่าเดิม) · ยังไม่เคย = ต่อท้าย
 * ยังไม่มีแท็บวันนั้น สร้างให้พร้อมหัวตาราง · appendNew=false = อัปเดตอย่างเดียว ไม่เพิ่มแถว (ปุ่มอัปเดตทั้งหมด)
 * ทีละแท็บ — แท็บไหนพัง แท็บอื่นยังไปต่อ (errors บอกว่าแท็บไหน)
 */
export async function upsertDailyTabs(header: string[], byTab: Map<string, KeyedRow[]>, { appendNew = true } = {}) {
  const tabs = await listTabs();
  const lastCol = colLetter(header.length - 1);
  const result = { appended: 0, updated: 0, tabs: [] as string[], created: [] as string[], errors: [] as string[] };

  for (const [tab, items] of byTab) {
    if (!items.length) continue;
    try {
      let sheetId = tabs.get(tab);
      let existing = new Map<string, number[]>();
      let oldValues: unknown[][] = [];
      if (sheetId == null) {
        if (!appendNew) continue;
        sheetId = await createTab(tab, header);
        tabs.set(tab, sheetId);
        result.created.push(tab);
      } else {
        // แท็บเดิม — แถว 1 ต้องเป็นหัวตารางครบทุกคอลัมน์ (รวมคอลัมน์ที่เพิ่มทีหลัง)
        await ensureHeader(tab, sheetId, header);
        // อ่านทั้งแถว (ไม่ใช่แค่ช่อง tracking) — ไว้เก็บค่าเดิมของช่องที่รอบนี้ไม่มีข้อมูล
        const sheet = await currentRows(tab, lastCol);
        existing = sheet.rowsOf;
        oldValues = sheet.values;
      }

      const updates: { rowNo: number; row: SheetRow }[] = [];
      const fresh: SheetRow[] = [];
      for (const { key, row } of items) {
        const rows = existing.get(normNo(key));
        // ช่องที่รอบนี้ว่าง แต่ในชีตมีค่าอยู่ (เช่น คนสแกน / สินค้า ที่ดึงไม่ได้รอบนี้) → เก็บค่าเดิม ไม่ลบทิ้ง
        if (rows) for (const rowNo of rows) updates.push({ rowNo, row: { ...row, values: keepOld(row.values, oldValues[rowNo - 1]) } });
        else if (appendNew) fresh.push(row);
      }

      const formats: object[] = [];
      // เขียนทับแถวเดิม — ค่า 1 request ทั้งแท็บ
      if (updates.length) {
        await call("/values:batchUpdate", {
          method: "POST",
          body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: updates.map((u) => ({ range: tabRange(tab, `A${u.rowNo}:${lastCol}${u.rowNo}`), values: [u.row.values] })),
          }),
        });
        for (const u of updates) formats.push(...rowFormats(sheetId, u.rowNo, header.length, [u.row]));
      }
      // ต่อท้ายแถวใหม่ — OVERWRITE = เขียนในแถวว่างต่อท้าย (INSERT_ROWS แทรกแถว → แถวตรึงขยายเองได้ จอเล็กเกินดูไม่ได้)
      if (fresh.length) {
        const res = (await call(`/values/${encodeURIComponent(tabRange(tab, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=OVERWRITE`, {
          method: "POST",
          body: JSON.stringify({ values: fresh.map((r) => r.values) }),
        })) as { updates?: { updatedRange?: string } };
        // แถวแรกที่เพิ่งเขียน (เช่น 'x'!A120:O150 → 120)
        const first = Number(/![A-Z]+(\d+)/.exec(res.updates?.updatedRange ?? "")?.[1]);
        if (first) formats.push(...rowFormats(sheetId, first, header.length, fresh));
      }
      // สีทั้งแท็บ 1 request
      if (formats.length) await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: formats }) });

      result.updated += updates.length;
      result.appended += fresh.length;
      result.tabs.push(tab);
    } catch (e) {
      console.warn(`[sheets] แท็บ ${tab} ไม่สำเร็จ:`, e);
      result.errors.push(`${tab}: ${e instanceof SheetsError ? SHEETS_HINT[e.kind] : "ไม่สำเร็จ"}`);
      // สิทธิ์ / ชีตไม่มี / login ไม่ผ่าน = แท็บอื่นก็พังเหมือนกัน หยุดเลย
      if (e instanceof SheetsError && e.kind !== "other" && e.kind !== "quota") throw e;
    }
  }
  return result;
}

// ─────────────────────────────────────────────── อัปเดตช่องสถานะ (รายงานประจำวัน)

export type StatusCell = { tab: string; trackingNo: string; value: string; color?: Rgb };

const colLetter = (i: number) => String.fromCharCode(65 + i);
/** ช่อง "Update" = สถานะล่าสุดใน BigSeller · หาแถวด้วยช่อง "หมายเลข tracking" (ตาม SHEET_COLUMNS) */
const STATUS_COL = colLetter(SHEET_COLUMNS.indexOf("Update"));
const TRACKING_COL = colLetter(SHEET_COLUMNS.indexOf("หมายเลข tracking"));

/**
 * เขียนสถานะ BigSeller ลงช่อง "Update" ของแถวที่เคยส่งไปแล้ว — แก้แค่ช่องนั้น ไม่เพิ่มแถว ไม่แตะช่องอื่น
 * แถวที่ยังไม่เคยส่ง (หาเลขแทร็คกิ้งไม่เจอในแท็บ) ข้ามไป · เลขเดียวกันส่งซ้ำหลายแถว อัปเดตทุกแถว
 * dryRun = หาแถวอย่างเดียว ไม่เขียน (ปุ่มทดสอบ) — นับได้ว่าจะอัปเดตกี่แถว
 */
export async function updateStatusCells(cells: StatusCell[], { dryRun = false }: { dryRun?: boolean } = {}) {
  const result = { updated: 0, notFound: 0, tabs: [] as string[] };
  if (!cells.length) return result;
  const tabs = await listTabs();
  const valueData: { range: string; values: string[][] }[] = [];
  const formatRequests: object[] = [];
  const colIndex = STATUS_COL.charCodeAt(0) - 65;

  const byTab = new Map<string, StatusCell[]>();
  for (const c of cells) byTab.set(c.tab, [...(byTab.get(c.tab) ?? []), c]);

  for (const [tab, list] of byTab) {
    const sheetId = tabs.get(tab);
    if (sheetId == null) {
      result.notFound += list.length;
      continue;
    }
    // แท็บเก่าโครงคอลัมน์เดิม → ปรับให้ตรงหัวล่าสุดก่อน ไม่งั้นช่อง tracking/สถานะ อยู่ผิดตำแหน่ง (ทดสอบ dryRun ไม่แก้ชีต)
    if (!dryRun) await ensureHeader(tab, sheetId, SHEET_COLUMNS);
    const col = (await call(`/values/${encodeURIComponent(tabRange(tab, `${TRACKING_COL}:${TRACKING_COL}`))}`)) as { values?: string[][] };
    // เลขในชีตอาจมี ' นำหน้า (กันแปลงเป็นตัวเลข) — ตัดออกก่อนเทียบ
    const rowsOf = new Map<string, number[]>();
    (col.values ?? []).forEach((r, i) => {
      const t = String(r[0] ?? "").replace(/^'/, "").trim().toUpperCase();
      if (t && i > 0) rowsOf.set(t, [...(rowsOf.get(t) ?? []), i + 1]);
    });

    let touched = false;
    for (const c of list) {
      const rows = rowsOf.get(c.trackingNo.toUpperCase());
      if (!rows) {
        result.notFound++;
        continue;
      }
      for (const row of rows) {
        valueData.push({ range: tabRange(tab, `${STATUS_COL}${row}`), values: [[c.value]] });
        if (c.color) {
          formatRequests.push({
            repeatCell: {
              range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
              cell: { userEnteredFormat: { backgroundColor: c.color, textFormat: { bold: true } } },
              fields: "userEnteredFormat(backgroundColor,textFormat.bold)",
            },
          });
        }
      }
      result.updated++;
      touched = true;
    }
    if (touched) result.tabs.push(tab);
  }

  if (dryRun) return result;
  // ยิงรวมทีเดียว: ค่า 1 request + สี 1 request
  if (valueData.length) await call("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: valueData }) });
  if (formatRequests.length) await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: formatRequests }) });
  return result;
}
