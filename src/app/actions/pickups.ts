"use server";

import { audit, requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { db } from "@/lib/db";
import { fmtDateTime, fromLocalInput, normalizeCode } from "@/lib/format";
import { createManualManifest, deleteManifestsWithoutPickup, findManifestByGuesses, isFullManifestNo, manifestPrefixCandidates } from "@/lib/manifests";
import { fetchManifestTrackings, refreshManifestsIfStale } from "@/lib/bigseller";
import { notifyPickupClosed } from "@/lib/line-messages";
import { refreshPickupStatuses } from "@/lib/status-report";
import { lineConfigured } from "@/lib/line";
import { applyCageShares, moveToCage, placeInCage, renameCage, tidyCage } from "@/lib/cages";
import { canAccessPickup, requirePickupAccess, requirePickupManifestAccess } from "@/lib/pickup-access";

export type FormState = { error?: string; message?: string } | undefined;

const text = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

function readCount(v: FormDataEntryValue | null) {
  const raw = text(v);
  if (raw == null) return { value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? { value: n } : { error: "จำนวนชิ้นต้องเป็นจำนวนเต็ม" };
}

// ───────────────────────────────────────────────────────────── เริ่ม / ปิดงาน

/**
 * เริ่มงาน — เวลาเริ่ม = ตอนกดปุ่มนี้ สถานะ "กำลังทำ" จนกว่าจะกดปิดงาน
 * รถที่มีงานค้างอยู่แล้ว → พาไปงานเดิม ไม่สร้างซ้ำ
 */
export async function startPickup(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const vehicleId = text(form.get("vehicleId"));
  if (!vehicleId) return { error: "เลือกทะเบียนรถ" };

  const vehicle = await db.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return { error: "ไม่พบรถคันนี้ — ลองเลือกใหม่" };

  const open = await db.pickup.findFirst({ where: { vehicleId, status: "DOING" }, select: { id: true, recordedBy: true } });
  if (open) {
    // งานค้างของคนอื่น → เปิดดูไม่ได้ บอกว่าใครทำอยู่แทน
    if (!(await canAccessPickup(user, open.id))) return { error: `รถ ${vehicle.plate} มีงานค้างอยู่แล้ว (${open.recordedBy ?? "คนอื่น"} กำลังทำ)` };
    redirect(`/pickups/${open.id}?already=1`);
  }

  const now = new Date();
  const [pickup] = await db.$transaction([
    db.pickup.create({
      data: {
        vehicleId,
        plate: vehicle.plate,
        carrier: text(form.get("carrier")) ?? vehicle.carrier,
        driverName: vehicle.driverName,
        recordedBy: user.name, // ผู้จด = คนที่ login
        createdById: user.id, // เจ้าของงาน — staff คนอื่นไม่เห็นงานนี้ (แอดมินเห็น)
        arrivedAt: now,
        status: "DOING",
      },
    }),
    db.vehicle.update({ where: { id: vehicleId }, data: { lastUsedAt: now } }),
  ]);
  audit(user, "pickup.start", "pickup", pickup.id, vehicle.plate);

  revalidatePath("/", "layout");
  redirect(`/pickups/${pickup.id}`);
}

/** ปิดงาน — เวลาสิ้นสุด = ตอนกด */
export async function closePickup(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requirePickupAccess(id);
  const count = readCount(form.get("parcelCount"));
  if ("error" in count) return { error: count.error };

  const res = await db.pickup.updateMany({
    where: { id, status: "DOING" },
    data: {
      status: "DONE",
      departedAt: new Date(),
      ...(count.value != null ? { parcelCount: count.value } : {}),
    },
  });
  if (res.count) {
    audit(user, "pickup.close", "pickup", id, count.value != null ? `รถนับ ${count.value} ชิ้น` : null);
    // สรุปรอบรถเข้า LINE หลังตอบหน้าเว็บแล้ว — ดึงสถานะ BigSeller ของรถคันนี้ก่อน (จัดส่งแล้ว/รอรับ/ยกเลิก กี่ชิ้น)
    // ยังไม่ตั้งค่า LINE = ไม่ต้องยิง BigSeller เปล่า ๆ
    if (lineConfigured()) {
      after(async () => {
        // เช็ค Flash ก่อนสรุป แต่ไม่รอเกิน 8 วินาที — บน serverless ฟังก์ชันมีเวลาจำกัด ช้าเกินแล้ว LINE ไม่ถูกส่งเลย
        const note = await Promise.race([
          refreshPickupStatuses(id).catch((e) => (console.warn("[line] ดึงสถานะก่อนสรุปไม่สำเร็จ:", e), "ดึงสถานะไม่สำเร็จ — ใช้สถานะล่าสุดที่เคยดึง")),
          new Promise<string>((r) => setTimeout(() => r("เช็ค Flash ไม่ทัน — ใช้สถานะล่าสุดที่มี"), 8_000)),
        ]);
        const sent = await notifyPickupClosed(id, note).catch((e) => (console.warn("[line] สรุปปิดงานไม่สำเร็จ:", e), null));
        console.log(`[line] สรุปปิดงาน ${id}: ${sent ? (sent.ok ? "ส่งแล้ว" : `ไม่สำเร็จ ${sent.error ?? ""}`) : "ไม่ได้ส่ง (ปิดการแจ้งเตือน close ไว้)"}`);
      });
    }
  }
  revalidatePath("/", "layout");
  return res.count ? { message: "ปิดงานแล้ว" } : { error: "งานนี้ปิดไปแล้ว" };
}

/** เปิดงานใหม่ (กดปิดผิด) — ลบเวลาสิ้นสุด */
export async function reopenPickup(id: string) {
  const user = await requirePickupAccess(id);
  await db.pickup.update({ where: { id }, data: { status: "DOING", departedAt: null } });
  audit(user, "pickup.reopen", "pickup", id);
  revalidatePath("/", "layout");
}

/** บันทึกรายละเอียดระหว่างทำงาน (จำนวนชิ้น คนขับ ขนส่ง หมายเหตุ) */
export async function savePickupDetails(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requirePickupAccess(id);
  const count = readCount(form.get("parcelCount"));
  if ("error" in count) return { error: count.error };
  await db.pickup.update({
    where: { id },
    data: {
      parcelCount: count.value,
      carrier: text(form.get("carrier")),
      driverName: text(form.get("driverName")),
      note: text(form.get("note")),
    },
  });
  audit(user, "pickup.details", "pickup", id);
  revalidatePath("/", "layout");
  return { message: "บันทึกแล้ว" };
}

/** แก้เวลา (กรณีลืมกดเริ่ม/ปิดงาน) — ใช้ในหน้าแก้ไขเท่านั้น */
export async function correctPickupTimes(id: string, _: FormState, form: FormData): Promise<FormState> {
  const user = await requirePickupAccess(id);
  const arrivedAt = fromLocalInput(form.get("arrivedAt"));
  const departedAt = fromLocalInput(form.get("departedAt"));
  if (!arrivedAt) return { error: "กรอกเวลาเริ่ม" };
  if (departedAt && departedAt < arrivedAt) return { error: "เวลาสิ้นสุดต้องหลังเวลาเริ่ม" };

  await db.pickup.update({
    where: { id },
    data: { arrivedAt, departedAt, status: departedAt ? "DONE" : "DOING" },
  });
  audit(user, "pickup.times", "pickup", id, `${fmtDateTime(arrivedAt)} – ${departedAt ? fmtDateTime(departedAt) : "ยังไม่ปิด"}`);
  revalidatePath("/", "layout");
  redirect(`/pickups/${id}`);
}

/**
 * ลบรอบรถ — manifest ที่จดในงานนี้หายด้วย
 * ใบที่ไม่เหลือรถคันอื่นรับ → ลบใบ + เลขแทร็คกิ้งในใบด้วย (ทุกชิ้นที่ส่งออกต้องมีรถรับ)
 * ใบที่แบ่งขึ้นรถคันอื่นด้วย → ยังอยู่กับคันนั้น
 */
export async function deletePickup(id: string, redirectTo?: string) {
  const user = await requirePickupAccess(id);
  const pms = await db.pickupManifest.findMany({ where: { pickupId: id }, select: { manifestId: true, cageId: true } });
  const gone = await db.pickup.delete({ where: { id } });
  const removed = await deleteManifestsWithoutPickup(pms.map((pm) => pm.manifestId));
  // กรงที่แบ่งกับคันอื่น → คำนวณส่วนแบ่งใหม่ · กรงว่าง → ลบ
  for (const cageId of new Set(pms.map((pm) => pm.cageId).filter((x): x is string => Boolean(x)))) await tidyCage(cageId, id);
  audit(user, "pickup.delete", "pickup", id, `${gone.plate}${removed ? ` · ลบใบที่ไม่มีรถรับ ${removed} ใบ` : ""}`);
  revalidatePath("/", "layout");
  if (redirectTo) redirect(redirectTo);
}

// ──────────────────────────────────────────────────────────── manifest ในงาน

/** จด manifest เพิ่มเข้างาน — 4 หลักท้ายหรือเลขเต็ม */
export async function addPickupManifest(pickupId: string, raw: string) {
  const user = await requirePickupAccess(pickupId);
  const input = normalizeCode(raw);
  if (!input) return { error: "ใส่เลข manifest" };
  // 4 หลักท้าย → ลองทุกเลขต้นที่เป็นไปได้ (MANIFEST_PREFIX / ใบล่าสุดในระบบ) ไม่เดาตัวเดียว
  // เคยเดาเลขต้นใหม่สุดตัวเดียว → ใบ MFG96310… กลายเป็น MFG96311… แล้วสร้างใบปลอมขึ้นมา
  const short = /^\d{4}$/.test(input);
  const prefixes = short ? await manifestPrefixCandidates() : [];
  const guesses = prefixes.length ? prefixes.map((p) => p + input) : [input];
  let code = guesses[0];

  const pickup = await db.pickup.findUnique({ where: { id: pickupId }, select: { arrivedAt: true, departedAt: true } });
  if (!pickup) return { error: "ไม่พบงานนี้" };

  const exists = await db.pickupManifest.findFirst({ where: { pickupId, code: { in: [...new Set([input, ...guesses])] } } });
  if (exists) return { error: `${exists.code} จดไว้แล้ว` };

  // ในเครื่องเก็บเฉพาะใบที่ขึ้นรถแล้ว (เช่น ใบที่แบ่งกับรถคันอื่น) — ไม่เจอ → ถาม BigSeller
  let m = await findManifestByGuesses(guesses, pickup, pickupId);
  if (m) {
    code = m.manifestNo;
    // ใบเดียวกันจดซ้ำในงานเดียวกัน (เช่น พิมพ์ 8665 แล้วยิงเลขเต็มอีก) → ไม่รับ
    const same = await db.pickupManifest.findFirst({ where: { pickupId, manifestId: m.id } });
    if (same) return { error: `${m.manifestNo} จดในงานนี้แล้ว (เป็น “${same.code}”)` };
  }
  // ไม่เจอ → จดเป็นเลขเต็มด้วยเลขต้นใหม่สุดไว้ก่อน (โชว์เลขเต็มได้เลย) · ตอนจับคู่ยังลองทุกเลขต้นด้วย 4 หลักท้าย
  // แล้วแก้เป็นเลขจริงของใบที่เจอ (linkPendingPickupManifests)

  // จดเลขไว้ก่อน (ยังไม่มีใบ) → BigSeller เจอใบแล้วจะเก็บเฉพาะใบที่ตรงกับเลขที่จดไว้
  const pm = await db.pickupManifest.create({ data: { pickupId, code, manifestId: m?.id ?? null, addedBy: user.name } });
  let refreshed: Awaited<ReturnType<typeof refreshManifestsIfStale>> | null = null;
  if (!m) {
    refreshed = await refreshManifestsIfStale();
    const linked = await db.pickupManifest.findUnique({ where: { id: pm.id }, select: { manifest: true } });
    m = linked?.manifest ?? null;
    if (short) {
      // จดเป็น 4 หลัก → เลือกใบตามลำดับเลขต้น แล้วเก็บเลขเต็มของใบที่เจอจริง
      // BigSeller จับคู่ด้วยเลขท้ายไปแล้ว (m) — ใช้ตามนั้น ถ้าไม่ได้ ค่อยลองตามเลขต้น
      if (!m) m = await findManifestByGuesses(guesses, pickup, pickupId);
      if (m) {
        code = m.manifestNo;
        const clash = await db.pickupManifest.findFirst({ where: { pickupId, code, id: { not: pm.id } } });
        await db.pickupManifest.update({ where: { id: pm.id }, data: { manifestId: m.id, ...(clash ? {} : { code }) } });
      }
    }
    // เลขเต็มที่พิมพ์มาเองแต่ BigSeller ไม่มี → สร้างใบเอง (ผูกกับรถคันนี้ทันที)
    // 4 หลักท้ายไม่สร้าง — ไม่รู้ว่าเลขต้นตัวไหนถูก (สร้างผิดตัว = ได้ใบปลอม) · รอ sync จับคู่ให้
    if (!m && !short && isFullManifestNo(code)) {
      m = await createManualManifest(code);
      await db.pickupManifest.update({ where: { id: pm.id }, data: { manifestId: m.id } });
    }
    if (m) {
      const same = await db.pickupManifest.findFirst({ where: { pickupId, manifestId: m.id, id: { not: pm.id } } });
      if (same) {
        await db.pickupManifest.delete({ where: { id: pm.id } });
        return { error: `${m.manifestNo} จดในงานนี้แล้ว (เป็น “${same.code}”)` };
      }
    }
  }
  audit(user, "manifest.add", "pickup", pickupId, m?.manifestNo ?? code);

  revalidatePath(`/pickups/${pickupId}`);
  revalidatePath("/", "layout");

  if (!m) {
    // ยังไม่มีใบ → ลงกรงที่เปิดอยู่ไว้ก่อน
    await placeInCage(pm.id, pickupId, null, user.name);
    if (refreshed?.ran && !refreshed.ok) return { error: `${code} — ดึงจาก BigSeller ไม่ได้: ${refreshed.message.split("\n")[0]}` };
    return { ok: `${code} — ยังไม่พบใบใน BigSeller จะจับคู่ให้เมื่อพบ` };
  }

  // เลขแทร็คกิ้งทั้งใบ: เคยดึงแล้วใช้ของเดิม ไม่เคยก็ยิง 1 request
  const t = await fetchManifestTrackings(m.id);
  // ลงกรง: ใบนี้อยู่ในกรงของรถคันอื่น → เข้ากรงนั้น (คันนี้ได้ "ที่เหลือ") · ไม่งั้นกรงที่เปิดอยู่ของคันนี้
  // ใบเก่าที่แบ่งแบบรายใบ (ไม่มีกรง) → แบ่งแบบเดิม คันนี้ได้ "ที่เหลือ"
  const legacy = await db.pickupManifest.count({ where: { manifestId: m.id, id: { not: pm.id }, cageId: null } });
  const split = legacy ? await defaultSplit(m.id, pm.id) : await placeInCage(pm.id, pickupId, m.id, user.name);
  const warnings = await duplicateWarnings(pickupId, m.id, t.duplicates, !legacy);
  if (split) warnings.unshift(split);

  const size = t.expected != null && t.expected !== t.count ? `${t.count}/${t.expected} ชิ้น` : `${t.count} ชิ้น`;
  const ok = `${input} → ${m.manifestNo} · ${size}${t.fetched ? "" : " (ข้อมูลที่เก็บไว้)"}`;
  if (!t.ok) return { ok: `${input} → ${m.manifestNo}`, warn: `ดึงเลขแทร็คกิ้งไม่ได้: ${t.message.split("\n")[0]}` };
  return warnings.length ? { ok, warn: warnings.join(" · ") } : { ok };
}

/** จำนวนชิ้นในใบ — ตามเลขแทร็คที่ดึงมา ไม่มีใช้จำนวนตาม BigSeller */
async function manifestSize(manifestId: string) {
  const m = await db.manifest.findUnique({ where: { id: manifestId }, select: { parcelCount: true, _count: { select: { parcels: true } } } });
  return m ? m._count.parcels || m.parcelCount || 0 : 0;
}

/**
 * ส่วนของคันอื่นที่ยังไม่ได้ใส่จำนวน — เดาจาก "จำนวนที่รถนับ" ตอนปิดงาน
 * (รถนับ − ใบอื่นบนคันเดียวกัน) · เดาไม่ได้ = null
 */
async function inferShare(pickupId: string, manifestId: string, size: number) {
  const p = await db.pickup.findUnique({
    where: { id: pickupId },
    select: { parcelCount: true, manifests: { select: { manifestId: true, parcelCount: true, manifest: { select: { _count: { select: { parcels: true } } } } } } },
  });
  if (p?.parcelCount == null) return null;
  const otherManifests = p.manifests.filter((x) => x.manifestId !== manifestId).reduce((n, x) => n + (x.parcelCount ?? x.manifest?._count.parcels ?? 0), 0);
  return Math.min(size, Math.max(0, p.parcelCount - otherManifests));
}

/**
 * จดใบที่อยู่กับรถคันอื่นแล้ว → คันใหม่ได้ "ที่เหลือ" = ทั้งใบ − ที่คันอื่นรับไป
 * คันอื่นไม่ได้ใส่จำนวน → เดาจากจำนวนที่รถนับตอนปิดงาน (แล้วบันทึกให้) · เดาไม่ได้ → ให้คนใส่เอง
 * @returns ข้อความแจ้ง (null = ใบนี้ไม่ได้แบ่ง)
 */
async function defaultSplit(manifestId: string, newPmId: string): Promise<string | null> {
  const others = await db.pickupManifest.findMany({
    where: { manifestId, id: { not: newPmId } },
    select: { id: true, pickupId: true, parcelCount: true, pickup: { select: { plate: true } } },
  });
  if (!others.length) return null;
  const size = await manifestSize(manifestId);
  const plates = others.map((o) => o.pickup.plate).join(", ");
  if (!size) return `ใบนี้แบ่งกับรถ ${plates} — กด “แบ่งคัน” ใส่จำนวนที่คันนี้รับ`;

  let known = 0;
  for (const o of others) {
    let share = o.parcelCount;
    if (share == null) {
      share = await inferShare(o.pickupId, manifestId, size);
      if (share == null) return `ใบนี้แบ่งกับรถ ${plates} — ยังไม่รู้ว่าคันนั้นรับไปเท่าไหร่ กด “แบ่งคัน” ใส่จำนวนที่คันนี้รับ`;
      await db.pickupManifest.update({ where: { id: o.id }, data: { parcelCount: share } });
    }
    known += share;
  }
  const rest = Math.max(0, size - known);
  await db.pickupManifest.update({ where: { id: newPmId }, data: { parcelCount: rest } });
  return `ใบนี้แบ่งกับรถ ${plates} (${known} ชิ้น) — คันนี้ได้ที่เหลือ ${rest} ชิ้น · แก้ได้ที่ “แบ่งคัน”`;
}

/**
 * ใบเดียวขึ้นได้หลายคัน (กรงใหญ่ แบ่งรถ) — ไม่ใช่ความผิดพลาดแล้ว แค่บอกว่าแบ่งกับคันไหน
 * ให้ใส่จำนวนที่คันนี้รับ (setPickupManifestCount) ยอดรวมของรถจะได้ไม่นับซ้ำ
 */
async function duplicateWarnings(pickupId: string, manifestId: string, dupTrackings: { trackingNo: string; manifestNo: string }[], inCage = false) {
  const others = await db.pickupManifest.findMany({
    where: { manifestId, pickupId: { not: pickupId } },
    select: { parcelCount: true, pickup: { select: { plate: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out: string[] = [];
  if (others.length && !inCage) {
    const list = others.map((o) => `${o.pickup.plate}${o.parcelCount != null ? ` ${o.parcelCount} ชิ้น` : ""}`).join(", ");
    out.push(`ใบนี้แบ่งกับรถ ${list} — กด “แบ่งคัน” ใส่จำนวนที่คันนี้รับ`);
  }
  if (dupTrackings.length) {
    const byManifest = [...new Set(dupTrackings.map((d) => d.manifestNo))];
    out.push(`มี ${dupTrackings.length} ชิ้นซ้ำกับใบ ${byManifest.join(", ")}`);
  }
  return out;
}

/**
 * ใบเดียวแบ่งขึ้นหลายคัน — จำนวนกล่องที่คันนี้รับไปจากใบนี้
 * ว่าง/null = คันนี้รับทั้งใบ (ใบไม่ได้แบ่ง)
 */
export async function setPickupManifestCount(id: string, raw: string | number | null): Promise<{ ok?: string; error?: string; warn?: string }> {
  const user = await requirePickupManifestAccess(id);
  const text = raw == null ? "" : String(raw).trim();
  const value = text === "" ? null : Number(text);
  if (value != null && (!Number.isInteger(value) || value < 0)) return { error: "จำนวนต้องเป็นจำนวนเต็ม 0 ขึ้นไป" };

  const pm = await db.pickupManifest.update({
    where: { id },
    data: { parcelCount: value },
    select: { pickupId: true, code: true, manifestId: true, manifest: { select: { manifestNo: true, parcelCount: true, _count: { select: { parcels: true } } } } },
  });
  audit(user, "manifest.split", "pickup", pm.pickupId, `${pm.manifest?.manifestNo ?? pm.code}: ${value ?? "ทั้งใบ"}`);
  revalidatePath("/", "layout");

  let warn: string | undefined;
  let filled: string | undefined;
  if (pm.manifestId && pm.manifest) {
    const size = pm.manifest._count.parcels || pm.manifest.parcelCount || 0;
    const all = await db.pickupManifest.findMany({
      where: { manifestId: pm.manifestId },
      select: { id: true, parcelCount: true, pickup: { select: { plate: true } } },
    });
    // แบ่ง 2 คัน (หรือเหลือคันเดียวที่ยังไม่ใส่) → คันนั้นได้ที่เหลืออัตโนมัติ
    const blank = all.filter((a) => a.id !== id && a.parcelCount == null);
    if (value != null && size && blank.length === 1) {
      const explicit = all.filter((a) => a.id !== blank[0].id).reduce((n, a) => n + (a.parcelCount ?? 0), 0);
      const rest = Math.max(0, size - explicit);
      await db.pickupManifest.update({ where: { id: blank[0].id }, data: { parcelCount: rest } });
      filled = `รถ ${blank[0].pickup.plate} ได้ที่เหลือ ${rest} ชิ้น`;
    }
    // รวมทุกคันแล้วเกินจำนวนในใบไหม
    const after = await db.pickupManifest.findMany({ where: { manifestId: pm.manifestId }, select: { parcelCount: true } });
    const sum = after.reduce((n, a) => n + (a.parcelCount ?? size), 0);
    if (size && sum > size) warn = `รวมทุกคัน ${sum} ชิ้น เกินจำนวนในใบ (${size})`;
  }
  const ok = value == null ? "คันนี้รับทั้งใบ" : `คันนี้รับ ${value} ชิ้นจากใบนี้`;
  return { ok: filled ? `${ok} · ${filled}` : ok, warn };
}

/** หมายเหตุของ manifest ในงาน — ว่าง = ลบหมายเหตุ */
export async function savePickupManifestNote(id: string, raw: string) {
  const user = await requirePickupManifestAccess(id);
  const note = raw.trim().slice(0, 500);
  const pm = await db.pickupManifest.update({ where: { id }, data: { note: note || null } });
  audit(user, "manifest.note", "pickup", pm.pickupId, `${pm.code}: ${note || "(ลบหมายเหตุ)"}`);
  revalidatePath(`/pickups/${pm.pickupId}`);
}

type ManifestActionResult = { ok?: string; error?: string; warn?: string };

/**
 * แก้เลข manifest ที่จดผิด / จับคู่ผิดใบ (เช่น ได้ MFG96308… แทน MFG96309…)
 * - เลขเดิม → ค้นใหม่ (ปลดใบเดิมแล้วจับคู่กับ BigSeller อีกรอบ)
 * - เลขใหม่ → หาใบใหม่ก่อน สำเร็จแล้วค่อยเอาอันเดิมออก (พลาด = อันเดิมยังอยู่ครบ) · หมายเหตุย้ายตามไปด้วย
 */
export async function replacePickupManifest(id: string, raw: string): Promise<ManifestActionResult> {
  const user = await requirePickupManifestAccess(id).catch(() => null);
  if (!user) return { error: "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว) หรือเป็นงานของคนอื่น" };
  const old = await db.pickupManifest.findUnique({ where: { id }, include: { manifest: { select: { manifestNo: true } } } });
  if (!old) return { error: "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)" };
  const code = normalizeCode(raw);
  if (!code) return { error: "ใส่เลข manifest" };
  const oldLabel = old.manifest?.manifestNo ?? old.code;
  // 4 หลักท้ายเดียวกับเลขเดิมที่ระบบต่อเลขต้นให้ (เช่น เดิม MFG963112678 พิมพ์ 2678) → ค้นใหม่ทุกเลขต้น
  const sameLast4 =
    /^\d{4}$/.test(code) && old.code.endsWith(code) && (old.code === code || (await manifestPrefixCandidates()).some((p) => old.code === p + code));

  // เลขเดิม (หรือเลขเต็มของใบเดิม) → ค้นใหม่
  if (code === old.code || code === old.manifest?.manifestNo || sameLast4) {
    await db.pickupManifest.delete({ where: { id } });
    await tidyCage(old.cageId, old.pickupId);
    await deleteManifestsWithoutPickup([old.manifestId]);
    const res = (await addPickupManifest(old.pickupId, code)) as ManifestActionResult;
    if (old.note) await db.pickupManifest.updateMany({ where: { pickupId: old.pickupId, code: { endsWith: code.slice(-4) }, note: null, createdAt: { gte: old.createdAt } }, data: { note: old.note } });
    audit(user, "manifest.resync", "pickup", old.pickupId, `${oldLabel} → ค้นใหม่`);
    return res;
  }

  const res = (await addPickupManifest(old.pickupId, code)) as ManifestActionResult;
  if (res.error) return { error: `แก้ไม่สำเร็จ (${oldLabel} ยังอยู่เหมือนเดิม): ${res.error}` };

  await db.pickupManifest.delete({ where: { id } });
  await tidyCage(old.cageId, old.pickupId);
  await deleteManifestsWithoutPickup([old.manifestId]);
  if (old.note) await db.pickupManifest.updateMany({ where: { pickupId: old.pickupId, code: { endsWith: code.slice(-4) }, note: null, createdAt: { gte: old.createdAt } }, data: { note: old.note } });
  audit(user, "manifest.replace", "pickup", old.pickupId, `${oldLabel} → ${code}`);
  revalidatePath("/", "layout");
  return { ...res, ok: `แก้ ${oldLabel} แล้ว · ${res.ok ?? code}` };
}

export async function removePickupManifest(id: string) {
  const user = await requirePickupManifestAccess(id);
  const pm = await db.pickupManifest.delete({ where: { id } });
  await tidyCage(pm.cageId, pm.pickupId);
  // ใบนี้ไม่เหลือรถคันไหนรับ → ลบใบ + เลขแทร็คกิ้ง (จดใหม่ได้ ระบบดึงให้ใหม่)
  const removed = await deleteManifestsWithoutPickup([pm.manifestId]);
  audit(user, "manifest.remove", "pickup", pm.pickupId, `${pm.code}${removed ? " · ลบใบ (ไม่มีรถรับ)" : ""}`);
  revalidatePath("/", "layout");
}

// ───────────────────────────────────────────────────────────────────── กรง

/** ปิดกรงที่เปิดอยู่ของรถคันนี้ → ใบถัดไปขึ้นกรงใหม่ */
export async function closeCage(pickupId: string): Promise<ManifestActionResult> {
  const user = await requirePickupAccess(pickupId);
  const open = await db.cage.findFirst({ where: { originPickupId: pickupId, closedAt: null }, select: { id: true, label: true, _count: { select: { manifests: true } } } });
  if (!open) return { ok: "ใบถัดไปจะขึ้นกรงใหม่" };
  if (!open._count.manifests) return { error: `กรง ${open.label} ยังว่างอยู่ — ยิงใบลงก่อน` };
  await db.cage.update({ where: { id: open.id }, data: { closedAt: new Date() } });
  audit(user, "cage.close", "pickup", pickupId, open.label);
  revalidatePath(`/pickups/${pickupId}`);
  return { ok: `ปิดกรง ${open.label} แล้ว · ใบถัดไปขึ้นกรงใหม่` };
}

/** เปิดกรงเดิมต่อ (ปิดผิด) — กรงที่เปิดอยู่อีกอันถูกปิดแทน */
export async function reopenCage(pickupId: string, cageId: string): Promise<ManifestActionResult> {
  const user = await requirePickupAccess(pickupId);
  const cage = await db.cage.findUnique({ where: { id: cageId }, select: { label: true, originPickupId: true } });
  if (!cage || cage.originPickupId !== pickupId) return { error: "เปิดได้เฉพาะกรงที่เริ่มในรถคันนี้" };
  await db.cage.updateMany({ where: { originPickupId: pickupId, closedAt: null, id: { not: cageId } }, data: { closedAt: new Date() } });
  await db.cage.update({ where: { id: cageId }, data: { closedAt: null } });
  audit(user, "cage.reopen", "pickup", pickupId, cage.label);
  revalidatePath(`/pickups/${pickupId}`);
  return { ok: `ยิงต่อลงกรง ${cage.label}` };
}

/**
 * คันนี้เอาไปจากกรงเท่าไหร่
 * - fraction: 0–1 (1 = ทั้งกรง, 0.5 = ครึ่งกรง) · count: นับได้กี่ชิ้น · ไม่ใส่ทั้งคู่ = "ที่เหลือ"
 */
export async function setCageShare(pickupId: string, cageId: string, pick: { fraction?: number; count?: number }): Promise<ManifestActionResult> {
  const user = await requirePickupAccess(pickupId);
  const fraction = pick.fraction != null && Number.isFinite(pick.fraction) ? Math.min(1, Math.max(0, pick.fraction)) : null;
  const count = pick.count != null ? Number(pick.count) : null;
  if (count != null && (!Number.isInteger(count) || count < 0)) return { error: "จำนวนต้องเป็นจำนวนเต็ม 0 ขึ้นไป" };

  const share = await db.pickupCage.findUnique({ where: { pickupId_cageId: { pickupId, cageId } }, select: { id: true, cage: { select: { label: true } } } });
  if (!share) return { error: "รถคันนี้ไม่ได้อยู่ในกรงนี้" };
  await db.pickupCage.update({ where: { id: share.id }, data: { share: count != null ? null : fraction, count } });
  await applyCageShares(cageId);

  const label = count != null ? `${count} ชิ้น` : fraction == null ? "ที่เหลือ" : fraction === 1 ? "ทั้งกรง" : `${Math.round(fraction * 100)}%`;
  audit(user, "cage.share", "pickup", pickupId, `กรง ${share.cage.label}: ${label}`);
  revalidatePath("/", "layout");

  // รวมทุกคันเกินกรงไหม
  const all = await db.pickupCage.findMany({ where: { cageId }, select: { share: true, count: true } });
  const explicitFrac = all.reduce((n, s) => n + (s.share ?? 0), 0);
  const warn = all.length > 1 && all.every((s) => s.share != null || s.count != null) && explicitFrac > 1.001 ? "รวมทุกคันเกินทั้งกรง — เช็คอีกที" : undefined;
  return { ok: `กรง ${share.cage.label}: คันนี้เอา${label}`, warn };
}

/** ย้ายใบไปกรงอื่น (ยิงหลายกรงพร้อมกันแล้วลงผิดกรง) · target = cageId หรือ "new" = กรงใหม่ */
export async function movePickupManifestCage(pmId: string, target: string): Promise<ManifestActionResult> {
  const user = await requirePickupManifestAccess(pmId);
  const res = await moveToCage(pmId, target, user.name);
  if (res.ok) {
    const pm = await db.pickupManifest.findUnique({ where: { id: pmId }, select: { pickupId: true } });
    audit(user, "cage.move", "pickup", pm?.pickupId ?? null, res.ok);
    revalidatePath("/", "layout");
  }
  return res;
}

/** ตั้งชื่อกรงเอง */
export async function renamePickupCage(pickupId: string, cageId: string, label: string): Promise<ManifestActionResult> {
  const user = await requirePickupAccess(pickupId);
  // กรงต้องอยู่ในรอบรถคันนี้ — ไม่งั้นส่ง cageId ของงานคนอื่นมาเปลี่ยนชื่อได้ (เหมือน setCageShare)
  const inPickup = await db.pickupCage.findUnique({ where: { pickupId_cageId: { pickupId, cageId } }, select: { id: true } });
  if (!inPickup) return { error: "รถคันนี้ไม่ได้อยู่ในกรงนั้น" };
  const res = await renameCage(cageId, label);
  if (res.ok) {
    audit(user, "cage.rename", "pickup", pickupId, res.ok);
    revalidatePath("/", "layout");
  }
  return res;
}

// ──────────────────────────────────────────────── ดึงเลขแทร็คกิ้งใหม่ทั้งหมด

type RefetchSummary = { pickups: number; manifests: number; fixed: string[]; failed: string[]; parcels: number };

/**
 * ทำทีละใบในรถคันเดียว: ยังไม่มีใบ / จับคู่ผิด → ค้นใหม่ · ใบถูกอยู่แล้ว → ดึงเลขแทร็คกิ้งจาก BigSeller ใหม่ (ทับของเดิม)
 * ใบที่ผูกกับเลขตรงตัวแล้วไม่แตะ — เลขต้นเก่า (MFG96310…) ยังใช้จริงได้ ห้ามเปลี่ยนเป็นเลขต้นใหม่เอง
 */
async function refetchOne(pickupId: string, prefixes: string[], sum: RefetchSummary) {
  const pms = await db.pickupManifest.findMany({
    where: { pickupId },
    orderBy: { createdAt: "asc" },
    select: { id: true, code: true, manifestId: true, manifest: { select: { manifestNo: true } } },
  });
  sum.pickups++;
  for (const pm of pms) {
    sum.manifests++;
    // จดเลขเต็มแต่ผูกกับใบเลขอื่น (จับคู่ผิด) → จับคู่ใหม่ด้วย
    const mismatched = isFullManifestNo(pm.code) && pm.manifest && pm.manifest.manifestNo !== pm.code;
    if (!pm.manifestId || mismatched) {
      // เลขเต็มที่ระบบต่อเลขต้นให้ → ค้นด้วย 4 หลักท้าย (ลองทุกเลขต้น) · เลขที่พิมพ์มาเอง → ค้นตามเดิม
      const last4 = pm.code.slice(-4);
      const target = prefixes.some((p) => pm.code === p + last4) ? last4 : pm.code;
      const r = await replacePickupManifest(pm.id, target);
      if (r.error) sum.failed.push(`${pm.code}: ${r.error}`);
      else if (pm.manifest) sum.fixed.push(`${pm.manifest.manifestNo} → ${pm.code}`);
      continue;
    }
    const t = await fetchManifestTrackings(pm.manifestId, { force: true });
    if (!t.ok) sum.failed.push(`${pm.code}: ${t.message.split("\n")[0]}`);
    else sum.parcels += t.count;
  }
}

const summaryText = (s: RefetchSummary) =>
  [
    `ดึงใหม่ ${s.manifests} ใบ${s.pickups > 1 ? ` จาก ${s.pickups} รอบรถ` : ""}${s.parcels ? ` · ${s.parcels} ชิ้น` : ""}`,
    s.fixed.length && `จับคู่ใหม่ ${s.fixed.length} ใบ (${s.fixed.slice(0, 5).join(", ")}${s.fixed.length > 5 ? "…" : ""})`,
    s.failed.length && `ไม่สำเร็จ ${s.failed.length}: ${s.failed[0]}`,
  ]
    .filter(Boolean)
    .join(" · ");

/** ปุ่ม "ดึงเลขแทร็คใหม่ทั้งหมด" ในหน้ารอบรถ */
export async function refetchPickupManifests(pickupId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requirePickupAccess(pickupId);
  const sum: RefetchSummary = { pickups: 0, manifests: 0, fixed: [], failed: [], parcels: 0 };
  await refetchOne(pickupId, await manifestPrefixCandidates(), sum);
  const message = summaryText(sum);
  audit(user, "manifest.refetch", "pickup", pickupId, message);
  revalidatePath("/", "layout");
  return { ok: sum.failed.length === 0, message };
}

/** ปุ่ม "ดึงใหม่ทั้งหมด" ในหน้าใบนำจ่าย — ทุกรอบรถที่เข้ารับภายใน N วัน */
export async function refetchRecentManifests(days: number): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 14) * 86_400_000);
  const pickups = await db.pickup.findMany({ where: { arrivedAt: { gte: since } }, orderBy: { arrivedAt: "asc" }, select: { id: true } });
  const prefixes = await manifestPrefixCandidates();
  const sum: RefetchSummary = { pickups: 0, manifests: 0, fixed: [], failed: [], parcels: 0 };
  for (const p of pickups) await refetchOne(p.id, prefixes, sum);
  const message = pickups.length ? summaryText(sum) : "ไม่มีรอบรถในช่วงนี้";
  audit(user, "manifest.refetch", "manifest", null, `${days} วัน · ${message}`);
  revalidatePath("/", "layout");
  return { ok: sum.failed.length === 0, message };
}
