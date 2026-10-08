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

// Capture API errors
const apiErrors = [];
page.on('response', r => { if (r.url().includes('/api/') && r.status() >= 400) apiErrors.push(`${r.status()} ${r.url()}`); });

await page.click('text=+ New channel');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/flow2-create-form.png' });
await page.fill('input[placeholder="Channel name"]', 'Flow Test Channel');
await page.fill('input[placeholder="Short description"]', 'Integration test channel');
await page.click('.primary-button');
await page.waitForTimeout(2000);
await page.screenshot({ path: '/tmp/flow2-after-create.png' });
console.log('After create URL:', page.url());
console.log('After create text:', await page.evaluate(() => document.body.innerText.slice(0, 500)));
console.log('API errors:', JSON.stringify(apiErrors));
console.log('CONSOLE errors:', JSON.stringify(errors));
await browser.close();
