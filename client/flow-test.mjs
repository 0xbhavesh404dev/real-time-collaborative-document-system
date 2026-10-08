import { chromium } from 'playwright';
const BASE = 'http://localhost:5173';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

async function shot(name){ await page.screenshot({ path: `/tmp/flow-${name}.png` }); console.log(`📸 /tmp/flow-${name}.png`); }

await page.goto(`${BASE}/register`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await shot('01-register');
const user = `flowuser_${Date.now()}`;
// Inputs have no placeholder; locate by label text
await page.locator('label >> nth=0 >> input').fill(user);
await page.locator('label >> nth=1 >> input').fill(`${user}@example.com`);
await page.locator('label >> nth=2 >> input').fill('Password123!');
await page.locator('label >> nth=3 >> input').fill('Password123!');
await page.click('.primary-button');
await page.waitForTimeout(2000);
await shot('02-after-register');
console.log('After register URL:', page.url());
console.log('After register text:', await page.evaluate(() => document.body.innerText.slice(0, 400)));

await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('03-dashboard');
console.log('Dashboard text:', await page.evaluate(() => document.body.innerText.slice(0, 400)));

await page.click('text=+ New channel');
await page.waitForTimeout(500);
await page.fill('input[placeholder="Channel name"]', 'Flow Test Channel');
await page.fill('input[placeholder="Short description"]', 'Integration test channel');
await page.click('.primary-button');
await page.waitForTimeout(1500);
await shot('04-channel-created');
console.log('After create channel URL:', page.url());
console.log('Channel list text:', await page.evaluate(() => document.body.innerText.slice(0, 400)));

await browser.close();
console.log('ERRORS:', JSON.stringify(errors));
