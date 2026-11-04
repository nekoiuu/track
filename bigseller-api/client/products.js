/**
 * UI ค้นหา/แก้ไข data/products.json — เพราะเปิดดูใน editor แล้วมันเยอะเกินไป
 *
 *   node client/products.js              เปิดที่ http://localhost:5173
 *   node client/products.js --port 8080  เปลี่ยนพอร์ต
 *   node client/products.js --no-open    ไม่ต้องเปิดเบราว์เซอร์ให้
 *
 * กด Save ในหน้าเว็บ = เขียนทับ data/products.json จริง (สำรองไว้ที่ data/products.backup.json ก่อนทุกครั้ง)
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT     = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA     = path.join(ROOT, 'data', 'products.json');
const BACKUP   = path.join(ROOT, 'data', 'products.backup.json');
const PAGE     = path.join(ROOT, 'client', 'products.html');

const argv    = process.argv.slice(2);
const flagVal = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };
const port    = Number(flagVal('--port', process.env.PORT ?? 5173));
const autoOpen = !argv.includes('--no-open');

// ------------------------------------------------------------------ ตรวจข้อมูล

/** โยน error ถ้ารูปร่างไม่ใช่ { products: [{ name, skus: [{ name, qty }] }] } */
function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.products))
    throw new Error('ต้องเป็น object ที่มี key "products" เป็น array');

  data.products.forEach((p, i) => {
    if (typeof p?.name !== 'string')   throw new Error(`products[${i}].name ต้องเป็น string`);
    if (!Array.isArray(p.skus))        throw new Error(`products[${i}].skus ต้องเป็น array`);
    p.skus.forEach((s, j) => {
      if (typeof s?.name !== 'string') throw new Error(`products[${i}].skus[${j}].name ต้องเป็น string`);
      // qty = null แปลว่า "ยังไม่ระบุจำนวน" — ต้องเก็บเป็น null ไว้เหมือนเดิม ห้ามกลายเป็น 0
      if (s.qty !== null && !Number.isFinite(Number(s.qty)))
        throw new Error(`products[${i}].skus[${j}].qty ต้องเป็นตัวเลข หรือ null`);
    });
  });

  // normalize: เก็บเฉพาะ field ที่ใช้จริง
  return {
    products: data.products.map(p => ({
      name: p.name,
      skus: p.skus.map(s => ({ name: s.name, qty: s.qty === null ? null : Number(s.qty) })),
    })),
  };
}

// --------------------------------------------------------------------- server

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(PAGE, 'utf8'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/api/products') {
      return send(res, 200, fs.readFileSync(DATA, 'utf8'));
    }

    if (req.method === 'PUT' && url.pathname === '/api/products') {
      // ต้องต่อเป็น Buffer ก่อนค่อย decode — ถ้า `raw += chunk` ตัวอักษรไทยที่คร่อมรอยต่อ chunk จะเพี้ยน
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString('utf8');

      let clean;
      try {
        clean = validate(JSON.parse(raw));
      } catch (e) {
        return send(res, 400, JSON.stringify({ error: e.message }));
      }

      if (fs.existsSync(DATA)) fs.copyFileSync(DATA, BACKUP);           // กันพลาด
      fs.writeFileSync(DATA, JSON.stringify(clean, null, 2) + '\n', 'utf8');

      const skus = clean.products.reduce((a, p) => a + p.skus.length, 0);
      console.log(`✔ เซฟแล้ว — ${clean.products.length} สินค้า / ${skus} SKU (สำรอง: data/products.backup.json)`);
      return send(res, 200, JSON.stringify({ ok: true, products: clean.products.length, skus }));
    }

    send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  ค้นหา/แก้ไขสินค้า → ${url}`);
  console.log(`  ไฟล์: data/products.json   (Ctrl+C เพื่อปิด)\n`);
  if (autoOpen) {
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
              : process.platform === 'darwin' ? ['open', [url]]
              : ['xdg-open', [url]];
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  }
});
