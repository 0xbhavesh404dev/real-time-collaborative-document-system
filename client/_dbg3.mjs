import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const errors = [];
const logs = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('[DBG')) logs.push(t);
  if (m.type() === 'error') errors.push('CONSOLE: ' + t);
});

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

async function snap(label) {
  const s = await page.evaluate(() => {
    const c = document.querySelector('.canvas');
    return {
      innerText: c ? c.innerText : null,
      active: document.activeElement && document.activeElement.className,
      tag: document.activeElement && document.activeElement.tagName,
      toast: (document.querySelector('.toast-error') || {}).textContent || null,
    };
  });
  console.log(`${label} | innerText=${JSON.stringify(s.innerText)} | active=${s.tag}.${s.active} | toast=${s.toast}`);
}

await snap('before');
await page.click('.canvas');
// Type slowly, one char at a time, avoiding 'f'
const chars = ['a','b','c','d','e','g','h','i','j','k'];
for (const ch of chars) {
  await page.keyboard.press(ch);
  await page.waitForTimeout(500);
  await snap(`after '${ch}'`);
}
console.log('\n--- DBG logs ---');
for (const l of logs.slice(-40)) console.log(l);
console.log('\nERRORS:', JSON.stringify(errors));
await browser.close();