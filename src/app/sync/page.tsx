import { connection } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { ERROR_HINT } from "@/lib/bigseller";
import { KEEPALIVE_MINUTES, getSession } from "@/lib/bigseller-session";
import { runLinkPending, runManifestSync } from "@/app/actions/manifests";
import { testCookie, updateCookie } from "@/app/actions/session";
import {
  runFlashPods,
  setFlashWebhook,
  testFlashOpenApi,
} from "@/app/actions/flash";
import { flashOpenConfig, flashOpenConfigured } from "@/lib/flash-open";
import { CookieForm, SyncButton } from "@/components/client-actions";
import { Page, PageHeader, Panel, Pill, SectionTitle } from "@/components/kit";

export const metadata = { title: "BigSeller" };

export default async function SyncPage() {
  await connection();
  const [pending, manifests, session] = await Promise.all([
    db.pickupManifest.count({ where: { manifestId: null } }),
    db.manifest.count({ where: { pickups: { some: {} } } }),
    getSession(),
  ]);
  const cookie = Boolean(session?.cookie);
  const dead = Boolean(session && session.deadCookie === session.cookie);

  const facts: [string, string][] = session
    ? [
        ["ยิงผ่านล่าสุด", fmtDateTime(session.lastOkAt)],
        [
          "BigSeller หมุน cookie ล่าสุด",
          `${fmtDateTime(session.rotatedAt)} (${session.rotations} ครั้ง)`,
        ],
        ["ต่ออายุล่าสุด", fmtDateTime(session.lastKeepAliveAt)],
        [
          "ต่ออายุทุก",
          KEEPALIVE_MINUTES
            ? `${KEEPALIVE_MINUTES} นาที (ข้ามถ้าเพิ่งยิง)`
            : "ปิดอยู่",
        ],
      ]
    : [];

  return (
    <Page>
      <PageHeader title="เชื่อมต่อ BigSeller" />

      <SectionTitle
        aside={
          !cookie ? (
            <Pill>ยังไม่มี cookie</Pill>
          ) : dead ? (
            <Pill tone="red">cookie ใช้ไม่ได้</Pill>
          ) : (
            <Pill tone="green">พร้อมใช้</Pill>
          )
        }
      >
        Session
      </SectionTitle>
      <Panel className="mb-10 grid gap-8 p-6 lg:grid-cols-2">
        <div className="space-y-4">
          {dead && session?.lastErrorKind && (
            <p className="text-sm text-error">
              {ERROR_HINT[session.lastErrorKind] ??
                "เชื่อม BigSeller ไม่สำเร็จ"}{" "}
              — แปะ cookie ใหม่ด้านขวา ({fmtDateTime(session.lastErrorAt)})
            </p>
          )}
          {facts.length ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-mute">{k}</dt>
                  <dd className="tabular">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-body">ยังไม่ได้ตั้ง cookie</p>
          )}
          <p className="text-xs text-mute">
            BigSeller เปลี่ยน cookie ใหม่ไปเรื่อย ๆ
            ระบบเก็บค่าใหม่ให้เองทุกครั้ง แปะครั้งเดียวพอ
            จนกว่าจะขึ้นว่าใช้ไม่ได้
          </p>
          {cookie && (
            <SyncButton
              action={testCookie}
              label="ทดสอบ cookie ตอนนี้"
              variant="outline"
            />
          )}
        </div>
        <CookieForm action={updateCookie} />
      </Panel>

      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        <Panel className="p-6">
          <p className="mb-1 font-medium">หาใบให้เลขที่จดค้าง</p>
          <p className="mb-4 text-sm text-body">
            เก็บเฉพาะใบที่ขึ้นรถ ({manifests.toLocaleString()} ใบ) ·
            ปกติระบบหาให้เองตอนจด — กดเมื่อมีเลขค้าง {pending} รายการ
          </p>
          {cookie ? (
            <SyncButton action={runManifestSync} label="หาใบจาก BigSeller" />
          ) : (
            <Pill>ต้องตั้ง cookie ก่อน</Pill>
          )}
        </Panel>
        <Panel className="p-6">
          <p className="mb-1 font-medium">จับคู่ manifest ที่ค้าง</p>
          <p className="mb-4 text-sm text-body">
            เลขที่จดแต่ยังไม่รู้ว่าเป็นใบไหน: {pending} รายการ
          </p>
          <SyncButton
            action={runLinkPending}
            label="จับคู่ใหม่"
            variant="outline"
          />
        </Panel>
      </div>

      {/* Flash Open API — ทางการ (ต้องขอ mchId + key จาก Flash)
          ซ่อนไว้จนกว่าจะใส่ FLASH_OPEN_MCH_ID + FLASH_OPEN_KEY ใน .env · ระหว่างนี้ใช้หน้าเว็บเช็คสถานะแบบเดิม */}
      {flashOpenConfigured() && (
        <>
          <SectionTitle aside={<Pill tone="green">ตั้งค่าแล้ว</Pill>}>
            Flash Open API
          </SectionTitle>
          <Panel className="mb-10 grid gap-4 p-6 text-sm">
            <p className="text-body">
              เชื่อมที่{" "}
              <span className="font-mono">
                {flashOpenConfig().base.replace("https://", "")}
              </span>
              {flashOpenConfig().base.includes("-tra.") &&
                " (Training — ทดสอบ)"}{" "}
              · เช็คสถานะผ่าน API ก่อน เลขที่ API ไม่ตอบจะถามหน้าเว็บแทน
            </p>
            <div className="flex flex-wrap gap-2">
              <SyncButton
                action={testFlashOpenApi}
                label="ทดสอบกับเลขของร้าน"
              />
              <SyncButton
                action={runFlashPods}
                label="ดึงหลักฐานส่งถึง"
                variant="outline"
              />
              <SyncButton
                action={setFlashWebhook.bind(null, true)}
                label="ตั้ง webhook"
                variant="outline"
              />
              <SyncButton
                action={setFlashWebhook.bind(null, false)}
                label="ปิด webhook"
                variant="ghost"
              />
            </div>
            <p className="text-xs text-mute">
              webhook: Flash ส่งความเคลื่อนไหวมาที่ /api/flash/webhook เอง
              ไม่ต้องกดเช็ค — ต้องเปิดเว็บเป็น https ที่เข้าจากข้างนอกได้ (ตั้ง
              PUBLIC_URL ใน .env)
            </p>
          </Panel>
        </>
      )}
    </Page>
  );
}
