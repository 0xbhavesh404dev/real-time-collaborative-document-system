import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const results = await page.evaluate(() => {
  const r = {};
  r.title = document.title;
  r.hasRoot = !!document.getElementById('root');
  r.bodyText = document.body.innerText.slice(0, 200);
  r.missingFonts = Array.from(document.fonts).filter(f => f.status !== 'loaded').map(f => f.family);
  return r;
});
console.log(JSON.stringify(results, null, 2));
console.log('CONSOLE_ERRORS:', JSON.stringify(errors.slice(0, 10)));
await browser.close();
