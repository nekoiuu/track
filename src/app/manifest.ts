import type { MetadataRoute } from "next";

/**
 * Web App Manifest — ให้ลงแอปบนมือถือได้ (เพิ่มลงหน้าจอโฮม เปิดแบบเต็มจอไม่มีแถบเบราว์เซอร์)
 * Next เสิร์ฟที่ /manifest.webmanifest · ไอคอนอยู่ public/icons (proxy ปล่อยผ่านโดยไม่ต้อง login)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TrackFlow — ติดตามพัสดุ บันทึกรถเข้ารับ",
    short_name: "TrackFlow",
    description: "บันทึกรถเข้ารับสินค้า ใบนำจ่าย และติดตามพัสดุ",
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f6f4",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // กดค้างที่ไอคอนแอป → ทางลัดไปงานที่ใช้บ่อย (Android)
    shortcuts: [
      { name: "เริ่มงานรถเข้า", url: "/pickups/new", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "รอบรถ", url: "/pickups", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "ติดตามสถานะ", url: "/tracking", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
