import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.__log = [];
  const P = window.Proxy;
  const wrap = (ns) => {
    const o = ns.on.bind(ns);
    ns.on = (ev, cb) => {
      if (ev === 'crdt-operation' || ev === 'error' || ev === 'formatting-update') {
        return o(ev, (p) => {
          try { window.__log.push({ ev, op: p && p.operation, msg: p && p.message, ah: !!document.activeElement, ae: document.activeElement && document.activeElement.className, ih: (document.querySelector('.canvas')||{}).innerHTML }); } catch (e) {}
          return cb(p);
        });
      }
      return o(ev, cb);
    };
  };
  try { wrap(window); } catch (e) { console.log('wrap window failed', e.message); }
  const SO = window.Socket;
  if (SO && SO.prototype) { try { wrap(SO.prototype); } catch (e) {} }
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const user = `dbg${Date.now().toString(36)}`;
await page.locator('label >> nth=0 >> input').fill(user);
await page.locator('label >> nth=1 >> input').fill(`${user}@example.com`);
await page.locator('label >> nth=2 >> input').fill('Password123!');
await page.locator('label >> nth=3 >> input').fill('Password123!');
await page.click('.primary-button');
await page.waitForTimeout(2000);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.click('text=+ New channel');
await page.waitForTimeout(400);
await page.fill('input[placeholder="Channel name"]', 'Dbg Ch');
await page.fill('input[placeholder="Short description"]', 'dbg');
await page.click('form.inline-form button.primary-button');
await page.waitForTimeout(1500);
await page.click('.channel-card');
await page.waitForTimeout(1500);
await page.click('text=+ Document');
await page.waitForTimeout(400);
await page.fill('input[placeholder="Document title"]', 'Dbg Doc');
await page.click('form.inline-form button.primary-button');
await page.waitForTimeout(1500);
await page.click('.document-row');
await page.waitForTimeout(2500);

const url = page.url();
console.log('URL:', url);

async function snap(label) {
  const s = await page.evaluate(() => {
    const c = document.querySelector('.canvas');
    return {
      innerText: c ? c.innerText : null,
      innerHTML: c ? c.innerHTML.slice(0, 220) : null,
      active: document.activeElement && document.activeElement.className,
      tag: document.activeElement && document.activeElement.tagName,
      toast: (document.querySelector('.toast-error') || {}).textContent || null,
    };
  });
  console.log(`${label} | innerText=${JSON.stringify(s.innerText)} | innerHTML=${JSON.stringify(s.innerHTML)} | active=${s.tag}.${s.active} | toast=${s.toast}`);
  return s;
}

await snap('before typing');
const ok = await page.evaluate(() => { window.__log.length = 0; return typeof window.Proxy === 'function'; });
console.log('proxy hook active:', ok);

for (const ch of 'ABCDEFGHIJ') {
  await page.click('.canvas');
  await page.keyboard.press(ch);
  await page.waitForTimeout(350);
  await snap(`after '${ch}'`);
}

console.log('\n--- socket log (tail 30) ---');
const log = await page.evaluate(() => window.__log.slice(-30));
for (const e of log) console.log(JSON.stringify(e));
console.log('\nERRORS:', JSON.stringify(errors));
await browser.close();
