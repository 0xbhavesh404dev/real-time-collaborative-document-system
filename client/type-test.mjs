import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const user = `flowuser_${Date.now()}`;
await page.locator('label >> nth=0 >> input').fill(user);
await page.locator('label >> nth=1 >> input').fill(`${user}@example.com`);
await page.locator('label >> nth=2 >> input').fill('Password123!');
await page.locator('label >> nth=3 >> input').fill('Password123!');
await page.click('.primary-button');
await page.waitForTimeout(2000);
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

await page.click('text=+ New channel');
await page.waitForTimeout(500);
await page.fill('input[placeholder="Channel name"]', 'Flow Test Channel');
await page.fill('input[placeholder="Short description"]', 'Integration test channel');
await page.click('form.inline-form button.primary-button');
await page.waitForTimeout(2000);
await page.click('.channel-card');
await page.waitForTimeout(2000);
await page.click('text=+ Document');
await page.waitForTimeout(500);
await page.fill('input[placeholder="Document title"]', 'Type Test Doc');
await page.click('form.inline-form button.primary-button');
await page.waitForTimeout(2000);
await page.click('.document-row');
await page.waitForTimeout(2000);

// Focus editor and type one char at a time
await page.click('.canvas');
await page.waitForTimeout(500);
const chars = 'ABCDEFGHIJ';
for (const ch of chars) {
  await page.keyboard.type(ch);
  await page.waitForTimeout(300);
  const txt = await page.evaluate(() => document.querySelector('.canvas').innerText);
  console.log(`After typing '${ch}': "${txt}"`);
}
await browser.close();
console.log('ERRORS:', JSON.stringify(errors));
