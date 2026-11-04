import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// CLI (migrate / studio) ต้องต่อตรง ไม่ผ่าน pooler — Supabase ใช้ DIRECT_URL (port 5432)
// ตัวแอปตอนรันใช้ DATABASE_URL (pooler port 6543) → src/lib/db.ts
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
