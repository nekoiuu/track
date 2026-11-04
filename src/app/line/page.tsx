import type { ReactNode } from "react";
import { connection } from "next/server";
import { headers } from "next/headers";
import { CheckCircle2Icon, CircleIcon } from "lucide-react";
import { getUser, isAdmin } from "@/lib/auth";
import { LINE_EVENTS, lineConfig, lineConfigured, type LineEvent } from "@/lib/line";
import { runStatusReportNow, runStatusReportTest, sendLineTest } from "@/app/actions/line";
import { STATUS_CAT, dailyTime, reportStatus } from "@/lib/status-report";
import { fmtDateTime } from "@/lib/format";
import { SyncButton } from "@/components/client-actions";
import { Mono, Notice, Page, PageHeader, Panel, Pill, SectionTitle } from "@/components/kit";

export const metadata = { title: "LINE" };

/** แสดงค่าลับแค่ท้าย ๆ — พอให้รู้ว่าใส่ตัวไหนไว้ */
const tail = (v: string, n = 6) => (v.length > n ? `…${v.slice(-n)}` : v);

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-teal" /> : <CircleIcon className="mt-0.5 size-4 shrink-0 text-hairline-strong" />}
      <div className="min-w-0">
        <p className="text-sm">
          <Mono>{label}</Mono>
        </p>
        {detail && <div className="text-xs break-all text-mute">{detail}</div>}
      </div>
    </li>
  );
}

export default async function LinePage() {
  await connection();
  if (!(await isAdmin(await getUser()))) {
    return (
      <Page>
        <PageHeader title="แจ้งเตือน LINE" />
        <Notice>หน้านี้สำหรับแอดมินเท่านั้น</Notice>
      </Page>
    );
  }

  const c = lineConfig();
  const ready = lineConfigured();
  const report = await reportStatus();
  const auto = dailyTime(report.dailyAt);
  // URL ของ webhook — ใช้ APP_URL ถ้าตั้งไว้ ไม่งั้นเดาจาก host ที่เปิดหน้านี้อยู่
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const webhookUrl = `${c.appUrl || `${proto}://${host}`}/api/line/webhook`;

  return (
    <Page>
      <PageHeader
        title="แจ้งเตือน LINE"
        description="ส่งสรุปรอบรถและเรื่องที่ต้องตามเข้ากลุ่ม LINE ผ่าน LINE Official Account (Messaging API)"
        actions={
          c.dryRun ? (
            <Pill tone="amber">ทดลอง — พิมพ์ลง log ไม่ส่งจริง (LINE_DRY_RUN)</Pill>
          ) : (
            <Pill tone={ready ? "green" : "neutral"}>{ready ? "พร้อมส่ง" : "ยังไม่ได้ตั้งค่า"}</Pill>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="p-6">
          <SectionTitle>ค่าใน .env</SectionTitle>
          <ul className="divide-y">
            <Check ok={Boolean(c.token)} label="LINE_CHANNEL_ACCESS_TOKEN" detail={c.token ? `ตั้งแล้ว ${tail(c.token)}` : "จำเป็น — ใช้ส่งข้อความ"} />
            <Check ok={Boolean(c.secret)} label="LINE_CHANNEL_SECRET" detail={c.secret ? "ตั้งแล้ว" : "ใช้ตรวจ webhook (หา groupId)"} />
            <Check
              ok={c.to.length > 0}
              label="LINE_TO"
              detail={c.to.length ? c.to.map((t) => tail(t, 8)).join(" · ") : "จำเป็น — groupId ที่จะส่งไป (พิมพ์ id ในกลุ่ม บอทจะตอบให้)"}
            />
            <Check ok={Boolean(c.appUrl)} label="APP_URL" detail={c.appUrl || "ไม่บังคับ — ใส่แล้วข้อความจะมีลิงก์กลับเข้าเว็บ"} />
          </ul>
          <div className="mt-4">
            {ready ? <SyncButton action={sendLineTest} label="ส่งข้อความทดสอบ" /> : <Pill>ใส่ token + LINE_TO ก่อนทดสอบ</Pill>}
          </div>
        </Panel>

        <Panel className="p-6">
          <SectionTitle>เหตุการณ์ที่ส่ง</SectionTitle>
          <p className="mb-3 text-xs text-mute">
            เลือกด้วย <Mono>LINE_NOTIFY</Mono> (คั่นด้วย ,) — ไม่ใส่ = ส่งทั้งหมด
          </p>
          <ul className="divide-y">
            {(Object.keys(LINE_EVENTS) as LineEvent[]).map((k) => (
              <Check key={k} ok={c.events.includes(k)} label={k} detail={LINE_EVENTS[k]} />
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-6 p-6">
        <SectionTitle
          aside={
            ready && (
              <div className="flex flex-wrap gap-2">
                <SyncButton action={runStatusReportTest} label="🧪 ทดสอบรายงาน" variant="outline" />
                <SyncButton action={runStatusReportNow} label="รายงานสถานะตอนนี้" />
              </div>
            )
          }
        >
          รายงานสถานะพัสดุประจำวัน
        </SectionTitle>
        <p className="mb-4 text-sm text-body">
          {auto ? (
            <>
              ส่งอัตโนมัติทุกวันเวลา <b>{auto} น.</b> (<Mono>LINE_DAILY_AT</Mono>) —
            </>
          ) : (
            <>
              ปิดส่งอัตโนมัติอยู่ (<Mono>LINE_DAILY_AT=off</Mono>) — กดส่งเองได้ ·
            </>
          )}{" "}
          ปุ่ม <b>ทดสอบ</b> ส่งการ์ดเข้า LINE ให้ดูหน้าตา แต่ยังไม่เขียน Sheets และไม่เลิกติดตามชิ้นที่จบแล้ว ·{" "}
          ดึงสถานะจาก BigSeller ของพัสดุที่ขึ้นรถไปภายใน {report.trackDays} วัน ส่งการ์ดสีเข้า LINE และอัปเดตช่อง “Update” ใน Google Sheets
          {report.sheetsReady ? "" : " (ยังไม่ได้ตั้งค่า Sheets — ข้ามส่วนนี้)"}
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["waiting", "shipped", "done", "cancel", "problem"] as const).map((k) => (
            <span key={k} className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: STATUS_CAT[k].soft, color: STATUS_CAT[k].color }}>
              {STATUS_CAT[k].emoji} {STATUS_CAT[k].label}
            </span>
          ))}
        </div>
        <ul className="space-y-1 text-sm text-body">
          <li>กำลังติดตาม <b className="tabular text-ink">{report.tracked}</b> ชิ้น · สำเร็จ/ยกเลิก รายงานครั้งเดียวแล้วเลิกติดตาม</li>
          <li>ไม่ขยับเกิน <b>{report.stuckDays} วัน</b> = ค้าง รายงานทุกวันจนกว่าสถานะจะเปลี่ยน (<Mono>STATUS_STUCK_DAYS</Mono>)</li>
          <li>
            ล่าสุด:{" "}
            {report.last ? (
              <>
                {fmtDateTime(report.last.startedAt)} · {report.last.kind === "daily-report" ? "อัตโนมัติ" : "กดเอง"} ·{" "}
                <span className={report.last.ok ? "" : "text-error"}>{report.last.message ?? (report.last.ok ? "สำเร็จ" : "ไม่สำเร็จ")}</span>
              </>
            ) : (
              "ยังไม่เคยส่ง"
            )}
          </li>
        </ul>
      </Panel>

      <Panel className="mt-6 p-6">
        <SectionTitle>วิธีตั้งค่า (ครั้งเดียว)</SectionTitle>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-body">
          <li>
            สร้าง LINE Official Account แล้วเปิด Messaging API ที่{" "}
            <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer" className="text-link hover:underline">
              LINE Developers Console
            </a>
          </li>
          <li>
            แท็บ <b>Basic settings</b> → ก๊อป <Mono>Channel secret</Mono> ใส่ <Mono>LINE_CHANNEL_SECRET</Mono>
          </li>
          <li>
            แท็บ <b>Messaging API</b> → <Mono>Channel access token (long-lived)</Mono> กด Issue → ใส่ <Mono>LINE_CHANNEL_ACCESS_TOKEN</Mono>
          </li>
          <li>
            แท็บเดียวกัน ตั้ง <b>Webhook URL</b> เป็น <Mono className="break-all">{webhookUrl}</Mono> → เปิด <b>Use webhook</b> → กด Verify
            <span className="block text-xs text-mute">ต้องเป็น https ที่ LINE เข้าถึงได้ (ตอนรันในเครื่องใช้ไม่ได้ — ใช้หลัง deploy หรือผ่าน tunnel)</span>
          </li>
          <li>
            เปิด <b>Allow bot to join group chats</b> (LINE Official Account Manager → ตั้งค่า → การตอบกลับ) แล้วเชิญบอทเข้ากลุ่ม
          </li>
          <li>
            พิมพ์ <Mono>id</Mono> ในกลุ่ม → บอทตอบรหัสกลุ่ม (ขึ้นต้นด้วย C…) → ใส่ <Mono>LINE_TO</Mono> → รีสตาร์ทเว็บ → กดส่งข้อความทดสอบ
          </li>
        </ol>
        <p className="mt-4 text-xs text-mute">
          แพ็กเกจฟรีของ LINE OA ส่งได้จำกัดต่อเดือน และข้อความเข้ากลุ่มนับตามจำนวนสมาชิกในกลุ่ม — ถ้าเกินโควตา ปิดเหตุการณ์ที่ไม่ต้องการด้วย{" "}
          <Mono>LINE_NOTIFY</Mono>
        </p>
      </Panel>
    </Page>
  );
}
