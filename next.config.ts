import type { NextConfig } from "next";

// เปิดจากมือถือผ่าน Wi-Fi (เช่น http://10.131.128.160:3000) ตอน npm run dev
// Next 16 บล็อกไฟล์ของ dev server จากเครื่องอื่นโดยปริยาย → มือถือได้หน้าเก่า/ไม่อัปเดต
// เพิ่ม IP ได้ใน .env:  DEV_ORIGINS=10.131.128.160,192.168.1.20
const devOrigins = (process.env.DEV_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // *.trycloudflare.com = ลิงก์ https ชั่วคราวจาก npm run share (ไว้ลงแอปบนมือถือ)
  allowedDevOrigins: ["10.131.128.160", "*.trycloudflare.com", ...devOrigins],
  experimental: {
    // เก็บหน้าที่เคยเปิด/prefetch ไว้ในเครื่อง 5 นาที — สลับรถไปมาไม่ต้องโหลดใหม่
    // มีการแก้ข้อมูล (server action เรียก revalidatePath) แคชถูกล้างเอง → เห็นค่าใหม่ทันที
    staleTimes: { dynamic: 300, static: 300 },
  },
};

export default nextConfig;
