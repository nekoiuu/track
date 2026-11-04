import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// ไม่มี "server-only" — instrumentation.ts (keep-alive) ต้อง import ได้ด้วย
// โค้ดฝั่งหน้าเว็บให้ import จาก ./db แทน

// ใช้ instance เดียวทั้งแอป — เก็บไว้ใน globalThis เสมอ: dev hot-reload สร้างใหม่ทุกครั้ง และตอน build
// หน้าเว็บกับ API route อยู่คนละ bundle → ถ้าไม่แชร์จะได้ 2 pool (connection ไป Supabase เปลืองเท่าตัว)
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * pool ต่อ instance — pooler ของ Supabase (Nano) ให้ทั้งโปรเจกต์ราว 15 ช่อง ใช้ร่วมกันทุก instance ของ Vercel + เครื่อง dev
 * ค่าเริ่มต้นของ pg = 10 ต่อ instance → 2 instance ก็เต็ม คนต่อไปรอ 15 วินาทีแล้ว ECHECKOUTTIMEOUT (เกิด 30 ต.ค. 2026)
 * ปล่อยช่องที่ว่างเกิน 30 วิ ให้ instance อื่นใช้ (สั้นกว่านี้ต่อใหม่บ่อย — ทุกครั้งที่ต่อ pooler ต้องเช็ครหัส ~0.5 วิ) · ปรับได้ด้วย DB_POOL_MAX
 * connectionTimeoutMillis นับรวมเวลารอคิวช่องว่างใน pool — 30 วิ (ไม่ใช่ 20: หน้าที่ยิงหลาย query ตอน DB ช้าพังทั้งที่แค่รอคิว)
 * แต่ต้องมี: ไม่ตั้ง = รอไม่มีกำหนด ตอน DB ล่ม function บน Vercel ค้างจนหมดเวลาและโดนนับ CPU ทั้งหมด
 */
const POOL_MAX = Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 5);

function createClient() {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}

export const prisma = (globalForPrisma.prisma ??= createClient());
