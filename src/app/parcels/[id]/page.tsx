import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ScanLineIcon } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { fetchParcelOrderLog, hasCookie, type OrderLogEntry } from "@/lib/bigseller";
import { runParcelFlash, runParcelOrderLog, updateParcelStatus } from "@/app/actions/manifests";
import { flashRoutesFor, type FlashRoute } from "@/lib/flash";
import type { ParcelStatus } from "@/generated/prisma/enums";
import { FLASH_PILL, flashLabel, flashTone, isFlashParcel } from "@/lib/flash-state";
import { PrintButton, SyncButton } from "@/components/client-actions";
import { Mono, Notice, PARCEL_STATUS, Page, PageHeader, Panel, ParcelStatusPill, SectionTitle, nativeSelectClass } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export const metadata = { title: "พัสดุ" };

/** เส้นทางของพัสดุ 1 กล่อง: ใบนำจ่าย → รถที่รับ → ตีกลับ — ใช้เป็นหลักฐาน */
export default async function ParcelPage({ params }: PageProps<"/parcels/[id]">) {
  const { id } = await params;
  const cookieP = hasCookie(); // เริ่มพร้อมกัน ไม่ต้องรอคิว
  const p = await db.manifestParcel.findUnique({
    where: { id },
    include: {
      manifest: { include: { pickups: { include: { pickup: true } } } },
      returns: { orderBy: { receivedAt: "asc" } },
    },
  });
  if (!p) notFound();
  const cookie = await cookieP;

  const pickups = p.manifest.pickups.map((pm) => pm.pickup);
  const timeline = [
    p.scannedAt && { at: p.scannedAt, text: `สแกนส่งของใน BigSeller โดย ${p.scannedBy}` },
    p.manifest.printedAt && { at: p.manifest.printedAt, text: `พิมพ์ใบนำจ่าย ${p.manifest.manifestNo}` },
    ...pickups.flatMap((pk) => [
      { at: pk.arrivedAt, text: `รถ ${pk.plate}${pk.carrier ? ` (${pk.carrier})` : ""} เข้ารับ`, href: `/pickups/${pk.id}` },
      pk.departedAt && { at: pk.departedAt, text: `รถ ${pk.plate} ออกจากร้าน`, href: `/pickups/${pk.id}` },
    ]),
    ...p.returns.map((r) => ({
      at: r.receivedAt,
      text: `รับพัสดุตีกลับที่ร้าน${r.receivedBy ? ` โดย ${r.receivedBy}` : ""}${r.condition ? ` · ${r.condition}` : ""}${r.note ? ` · ${r.note}` : ""}`,
    })),
  ]
    .filter((e): e is { at: Date; text: string; href?: string } => Boolean(e))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <Page>

      <PageHeader
        crumbs={[{ href: "/manifests", label: "ใบนำจ่าย" }, { href: `/manifests/${p.manifest.id}`, label: p.manifest.manifestNo }]}
        current={p.trackingNo}
        title={<Mono className="text-[22px] sm:text-[32px]">{p.trackingNo}</Mono>}
        description={
          <>
            <ParcelStatusPill status={p.status} /> {p.orderNo && <>ออเดอร์ <Mono>{p.orderNo}</Mono></>}{" "}
            {p.platform && `· ${p.platform}`} {p.shopName && `· ${p.shopName}`}
          </>
        }
        actions={<PrintButton />}
      />

      {pickups.length === 0 && (
        <div className="mb-6">
          <Notice>ใบนำจ่ายของพัสดุนี้ยังไม่ถูกจดว่ารถคันไหนรับไป</Notice>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-10">
          <Suspense fallback={<ScanSkeleton />}>
            <FlashSection parcelId={p.id} cached={p} />
          </Suspense>

          <Suspense fallback={<ScanSkeleton />}>
            <ScanSection parcelId={p.id} cached={p} />
          </Suspense>

          <section>
            <SectionTitle>เส้นทาง</SectionTitle>
            <Panel className="p-6">
              <ol className="relative space-y-5 border-l border-hairline pl-5">
                {timeline.map((e, i) => (
                  <li key={i}>
                    <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-ink" />
                    <p className="font-mono text-xs text-mute">{fmtDateTime(e.at)}</p>
                    {e.href ? (
                      <Link href={e.href} className="hover:underline">
                        {e.text}
                      </Link>
                    ) : (
                      <p>{e.text}</p>
                    )}
                  </li>
                ))}
              </ol>
            </Panel>
          </section>
          <p className="text-sm text-body">
            อยู่ในใบนำจ่าย{" "}
            <Link href={`/manifests/${p.manifest.id}`} className="font-mono text-link hover:underline">
              {p.manifest.manifestNo}
            </Link>
          </p>
        </div>

        <Panel className="no-print h-fit p-6">
          <SectionTitle
            aside={cookie && p.orderNo && <SyncButton action={runParcelOrderLog.bind(null, p.id)} label="รีโหลด" variant="outline" />}
          >
            อัปเดตสถานะ
          </SectionTitle>
          {p.bsStatusText && (
            <p className="mb-3 text-sm text-body">
              BigSeller: <span className="font-medium text-ink">{p.bsStatusText}</span>
              {p.orderLogFetchedAt && <span className="text-mute"> · {fmtDateTime(p.orderLogFetchedAt)}</span>}
            </p>
          )}
          {p.statusBy && <p className="mb-3 text-sm text-body">แก้ล่าสุดโดย <span className="font-medium text-ink">{p.statusBy}</span></p>}
          {/* key = สถานะ → รีโหลดแล้วสถานะเปลี่ยน ฟอร์มรีเซ็ตตามค่าใหม่ */}
          <form key={p.status} action={updateParcelStatus.bind(null, p.id)} className="space-y-3">
            <select name="status" defaultValue={p.status} className={nativeSelectClass}>
              {Object.entries(PARCEL_STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
            <Textarea
              name="statusNote"
              defaultValue={p.statusNote ?? ""}
              rows={3}
              placeholder="หมายเหตุ เช่น ลูกค้าปฏิเสธรับ"
            />
            <Button type="submit" className="w-full">
              บันทึก
            </Button>
          </form>
        </Panel>
      </div>
    </Page>
  );
}

/** "james@G963010006" → ชื่อ + รหัสบัญชีย่อย */
function UserName({ user }: { user: string }) {
  const [name, account] = user.split("@");
  return (
    <>
      <span className="font-semibold text-ink">{name}</span>
      {account && <span className="text-mute">@{account}</span>}
    </>
  );
}

/**
 * ใครสแกนพัสดุนี้ใน BigSeller — ดึงครั้งแรกที่เปิดหน้า แล้วเก็บไว้ (โหลดแยก หน้าไม่ต้องรอ)
 * อ้างอิง endpoint → README.md (order/operate/log)
 */
type ScanData = { scannedBy: string | null; scannedAt: Date | null; orderLog: unknown; orderLogFetchedAt: Date | null };

async function ScanSection({ parcelId, cached }: { parcelId: string; cached: ScanData }) {
  // เคยดึงแล้ว → ใช้ที่หน้าโหลดมาเลย ไม่ยิง BigSeller/DB ซ้ำ (อยากได้ล่าสุดกด "รีโหลด")
  let p = cached;
  let res: { ok: boolean; message: string } = { ok: true, message: "" };
  if (!cached.orderLogFetchedAt) {
    res = await fetchParcelOrderLog(parcelId);
    p = await db.manifestParcel.findUniqueOrThrow({
      where: { id: parcelId },
      select: { scannedBy: true, scannedAt: true, orderLog: true, orderLogFetchedAt: true },
    });
  }
  const log = ((p.orderLog as OrderLogEntry[] | null) ?? []).slice().reverse();

  return (
    <section>
      <SectionTitle>ผู้สแกน (BigSeller)</SectionTitle>
      <Panel className="p-5 sm:p-6">
        {p.scannedBy ? (
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-teal-soft text-teal-deep">
              <ScanLineIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="text-lg break-all">
                <UserName user={p.scannedBy} />
              </p>
              <p className="text-sm text-body">
                สแกนและจัดส่งบน App · <span className="font-mono">{fmtDateTime(p.scannedAt)}</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-body">
            {p.orderLogFetchedAt
              ? "ยังไม่มีการสแกนใน BigSeller"
              : res.ok
                ? "ยังไม่ได้ดึงข้อมูล"
                : res.message}
          </p>
        )}

        {log.length > 0 && (
          <details className="group mt-5 border-t pt-4">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-sm text-body select-none">
              ประวัติทั้งหมดใน BigSeller ({log.length})
              <span className="text-mute transition-transform group-open:rotate-180">▾</span>
            </summary>
            <ol className="mt-3 space-y-3">
              {log.map((e, i) => (
                <li key={i} className="grid gap-0.5 text-sm">
                  <span className="font-mono text-xs text-mute">
                    {e.at ? fmtDateTime(new Date(e.at)) : e.raw} · {e.status}
                  </span>
                  <span className="text-ink">{e.action}</span>
                  <span className="text-xs">
                    <UserName user={e.user} />
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
        {p.orderLogFetchedAt && (
          <p className="mt-4 text-xs text-mute">ดึงจาก BigSeller {fmtDateTime(p.orderLogFetchedAt)}</p>
        )}
      </Panel>
    </section>
  );
}

function ScanSkeleton() {
  return (
    <section>
      <SectionTitle>ผู้สแกน (BigSeller)</SectionTitle>
      <Panel className="flex items-center gap-4 p-5 sm:p-6">
        <span className="size-11 shrink-0 animate-pulse rounded-full bg-muted" />
        <div className="grid flex-1 gap-2">
          <span className="h-5 w-40 animate-pulse rounded bg-muted" />
          <span className="h-4 w-56 animate-pulse rounded bg-muted" />
        </div>
      </Panel>
    </section>
  );
}

type FlashData = {
  trackingNo: string;
  status: ParcelStatus;
  shippingMethod: string | null;
  flashState: number | null;
  flashStateText: string | null;
  flashLastRoute: string | null;
  flashRoutedAt: Date | null;
  flashFetchedAt: Date | null;
  flashNotFound: boolean;
  flashPod: unknown;
  flashMarker: number | null;
};

/** ป้ายปัญหาจาก Flash (webhook markerCategory) */
const FLASH_MARKER: Record<number, string> = { 17: "ผู้รับปฏิเสธรับ", 23: "ที่อยู่ไม่ถูกต้อง", 40: "ติดต่อผู้รับไม่ได้" };

type Pod = { signer: string | null; signerType: string | null; at: string | null; photos: string[]; pod: string | null; lat: number | null; lng: number | null };

/**
 * สถานะจากเว็บ Flash + เส้นทางพัสดุ — เส้นทางถาม Flash สดทุกครั้งที่เปิด (ไม่เก็บใน DB)
 * ข้อมูลในระบบเก่าเกิน 30 นาที (และยังไม่จบ) → บันทึกสถานะล่าสุดจากคำตอบเดียวกันด้วย · โหลดแยก (Suspense) หน้าไม่ต้องรอ Flash
 */
async function FlashSection({ parcelId, cached }: { parcelId: string; cached: FlashData }) {
  let p = cached;
  if (!isFlashParcel(p)) return null;
  const finished = p.flashState != null && [5, 7, 9].includes(p.flashState);
  const stale = !p.flashFetchedAt || new Date().getTime() - p.flashFetchedAt.getTime() > 30 * 60_000;
  const save = !finished && stale;
  const live = await flashRoutesFor({ id: parcelId, trackingNo: p.trackingNo, status: p.status, flashState: p.flashState }, { save }).catch(() => null);
  if (save && live) p = (await db.manifestParcel.findUnique({ where: { id: parcelId } })) ?? p;
  // ถาม Flash ไม่ได้ → โชว์ความเคลื่อนไหวล่าสุดที่เก็บไว้
  const routes: Pick<FlashRoute, "at" | "text" | "message">[] =
    live ?? (p.flashLastRoute ? [{ at: p.flashRoutedAt?.toISOString() ?? null, text: null, message: p.flashLastRoute }] : []);
  const label = flashLabel(p);
  const pod = p.flashPod as Pod | null;

  return (
    <section>
      <SectionTitle aside={<SyncButton action={runParcelFlash.bind(null, parcelId)} label="เช็ค Flash อีกครั้ง" variant="outline" />}>สถานะ Flash</SectionTitle>
      <Panel className="p-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${FLASH_PILL[flashTone(p.flashState)]}`}>{label ?? "ยังไม่ได้เช็ค"}</span>
          {p.flashMarker != null && FLASH_MARKER[p.flashMarker] && (
            <span className="inline-flex rounded-full bg-error-soft px-3 py-1 text-sm font-medium text-error-deep">{FLASH_MARKER[p.flashMarker]}</span>
          )}
          {p.flashFetchedAt && <span className="text-xs text-mute">เช็คเมื่อ {fmtDateTime(p.flashFetchedAt)}</span>}
        </div>
        {/* หลักฐานการส่งถึง (Flash Open API) */}
        {pod && (pod.signer || pod.photos.length > 0 || pod.pod) && (
          <div className="mb-5 grid gap-3 rounded-xl bg-canvas-soft-2/60 p-4">
            <p className="text-sm">
              <span className="font-semibold">หลักฐานการส่งถึง</span>
              {pod.signer && <> · เซ็นรับโดย <b>{pod.signer}</b></>}
              {pod.signerType && <span className="text-mute"> ({pod.signerType})</span>}
              {pod.at && <span className="text-mute"> · {/^\d{4}-/.test(pod.at) ? fmtDateTime(new Date(pod.at)) : pod.at}</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {[...pod.photos, ...(pod.pod ? [pod.pod] : [])].map((src, i) => (
                <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-card">
                  {/* eslint-disable-next-line @next/next/no-img-element -- รูปจากเซิร์ฟเวอร์ Flash (โดเมนภายนอก) */}
                  <img src={src} alt={i < pod.photos.length ? `รูปตอนส่ง ${i + 1}` : "ลายเซ็นผู้รับ"} className="h-28 w-auto object-cover" loading="lazy" />
                </a>
              ))}
            </div>
            {pod.lat != null && pod.lng != null && (
              <a href={`https://www.google.com/maps?q=${pod.lat},${pod.lng}`} target="_blank" rel="noreferrer" className="text-sm text-link hover:underline">
                ดูจุดที่ส่งบนแผนที่
              </a>
            )}
          </div>
        )}
        {!live && routes.length > 0 && <p className="mb-3 text-xs text-warning-deep">ดึงเส้นทางจาก Flash ไม่ได้ตอนนี้ — แสดงความเคลื่อนไหวล่าสุดที่บันทึกไว้</p>}
        {routes.length === 0 ? (
          <p className="text-sm text-mute">{p.flashNotFound ? "Flash ยังไม่มีข้อมูลเลขนี้ (ยังไม่สแกนรับเข้าระบบ หรือไม่ใช่เลขของ Flash)" : "ยังไม่มีความเคลื่อนไหว"}</p>
        ) : (
          <ol className="relative space-y-5 border-l border-hairline pl-5">
            {routes.map((r, i) => (
              <li key={i}>
                <span className={`absolute -left-[5px] mt-1.5 size-2.5 rounded-full ${i === 0 ? "bg-link" : "bg-hairline-strong"}`} />
                <p className="font-mono text-xs text-mute">{r.at ? fmtDateTime(new Date(r.at)) : "—"}</p>
                <p className={i === 0 ? "font-medium" : ""}>{r.text ?? r.message}</p>
                {r.text && r.message && <p className="text-sm text-body">{r.message}</p>}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </section>
  );
}
