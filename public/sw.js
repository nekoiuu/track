/* TrackFlow service worker — ให้ติดตั้งเป็นแอปได้ + หน้าแจ้งเตือนตอนไม่มีเน็ต
 * ไม่แคชข้อมูล (ข้อมูลต้องสดเสมอ) — แคชแค่หน้า offline กับไอคอน */
const CACHE = "shipped-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

// เปิดหน้าเว็บ: ไปเน็ตก่อนเสมอ · เน็ตหลุด → หน้า offline
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
