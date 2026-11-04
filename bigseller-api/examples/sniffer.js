/* ============================================================
 * Network sniffer — ใช้หา endpoint ที่ยังไม่รู้ (เช่นปุ่ม stock in)
 *
 * วิธีใช้:
 *   1. เปิดหน้าที่มีปุ่มนั้น → F12 → Console → วางไฟล์นี้
 *   2. กดปุ่มบนหน้าเว็บ 1 ครั้ง (กดจริง ๆ)
 *   3. รัน:  window.__cap.filter(r => /\/api\/v1\//.test(r.url))
 *
 * จะได้ URL + method + headers + body ของทุก request ที่หน้าเว็บยิงออกไป
 * ============================================================ */

window.__cap = [];

(function installSniffer() {
  if (window.__capInstalled) { console.log('ติดตั้งไว้แล้ว'); return; }
  window.__capInstalled = true;

  // --- XHR (axios ใช้ตัวนี้) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetH = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (m, u) {
    this.__m = m; this.__u = u; this.__h = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    (this.__h = this.__h || {})[k] = v;
    return origSetH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    window.__cap.push({ via: 'xhr', url: this.__u, method: this.__m, headers: this.__h, body: b });
    return origSend.apply(this, arguments);
  };

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const headers = {};
    const h = init?.headers ?? input?.headers;
    if (h) { if (h.forEach) h.forEach((v, k) => headers[k] = v); else Object.assign(headers, h); }
    window.__cap.push({
      via: 'fetch', url,
      method: init?.method ?? input?.method ?? 'GET',
      headers, body: init?.body,
    });
    return origFetch.apply(this, arguments);
  };

  console.log('%csniffer ติดตั้งแล้ว', 'color:#0a0;font-weight:bold');
  console.log('ไปกดปุ่มบนหน้าเว็บ แล้วรัน: window.__cap.filter(r => /\\/api\\/v1\\//.test(r.url))');
})();

// helper: ดูเฉพาะ API ของ BigSeller แบบอ่านง่าย
window.showApi = () =>
  console.table(
    window.__cap
      .filter(r => /\/api\/v1\//.test(r.url || ''))
      .map(r => ({ method: r.method, url: r.url, body: String(r.body ?? '').slice(0, 200) }))
  );

// helper: ล้างที่เก็บไว้ ก่อนกดปุ่มที่สนใจ จะได้ไม่ปนกับของเก่า
window.clearCap = () => { window.__cap = []; console.log('ล้างแล้ว'); };
