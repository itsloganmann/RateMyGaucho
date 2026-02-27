/**
 * Playwright debug test — serves mock GOLD pages via localhost,
 * manually injects extension scripts, and checks duplicate cards + NLP search.
 */
import { chromium } from 'playwright';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = __dirname;

/* ── Mock HTML ────────────────────────────────────────────────────────── */

const SCHEDULE_HTML = `<!DOCTYPE html><html><head><title>Student Schedule</title></head>
<body>
<h2>STUDENT SCHEDULE</h2>
<table border="1" cellpadding="4">
  <thead><tr><th>Course</th><th>Days</th><th>Time</th><th>Location</th><th>Instructor</th><th>Action</th></tr></thead>
  <tbody>
    <tr>
      <td>CMPSC 32</td><td>TR</td><td>2:00-3:15 PM</td><td>TD-W 1701</td>
      <td>NASIR NABEEL</td>
      <td><a href="#">Course Info</a> <a href="#">Final</a></td>
    </tr>
    <tr><td></td><td>W</td><td>5:00-5:50 PM</td><td>PHELP 1431</td><td></td><td><a href="#">Add</a></td></tr>
    <tr><td></td><td>W</td><td>6:00-6:50 PM</td><td>PHELP 1431</td><td></td><td><a href="#">Add</a></td></tr>
    <tr>
      <td>CMPSC 32</td><td>TR</td><td>3:30-4:45 PM</td><td>BUCHN 1930</td>
      <td>NASIR NABEEL</td>
      <td><a href="#">Course Info</a> <a href="#">Final</a></td>
    </tr>
    <tr><td></td><td>W</td><td>7:00-7:50 PM</td><td>PHELP 1431</td><td></td><td><a href="#">Add</a></td></tr>
    <tr>
      <td>MATH 4A</td><td>MWF</td><td>9:00-9:50 AM</td><td>IV THTR 1</td>
      <td>BIGELOW STEPHEN</td>
      <td><a href="#">Course Info</a> <a href="#">Final</a></td>
    </tr>
    <tr><td></td><td>W</td><td>3:00-3:50 PM</td><td>SH 1431</td><td></td><td><a href="#">Add</a></td></tr>
  </tbody>
</table>
</body></html>`;

const FIND_HTML = `<!DOCTYPE html><html><head><title>Find Course Results</title></head>
<body>
<div>Quarter = Spring 2026 , Subject Area = Mathematics - MATH</div>
<table border="1" cellpadding="4">
  <tr><td colspan="8"><strong>MATH 34A  - CALC FOR SOCIAL SCI</strong></td><td>Units:4.0</td></tr>
  <tr>
    <td>29215</td><td>MWF</td><td>3:00 PM</td><td>Embarcadero</td>
    <td>LIU HAOYANG</td><td>Full</td><td>100</td>
    <td><a href="#">Course Info</a> <a href="#">Final</a></td>
  </tr>
  <tr><td>29223</td><td>T</td><td>8:00 AM</td><td>ILP</td><td></td><td>Full</td><td>25</td><td></td></tr>
  <tr>
    <td>53827</td><td>TR</td><td>8:00 AM</td><td>LSB</td>
    <td>NGUYEN G</td><td>Full</td><td>150</td>
    <td><a href="#">Course Info</a> <a href="#">Final</a></td>
  </tr>
  <tr><td>53835</td><td>W</td><td>8:00 AM</td><td>ILP</td><td></td><td>Full</td><td>25</td><td></td></tr>
</table>
</body></html>`;

/* ── HTTP Server ──────────────────────────────────────────────────────── */
function startServer() {
  const csvData = fs.readFileSync(path.join(EXTENSION_PATH, 'courses_final_enrollment.csv'), 'utf8');
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.url.includes('courses_final_enrollment.csv')) {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.end(csvData);
      }
      if (req.url.includes('scores.csv')) { res.writeHead(404); return res.end(''); }
      res.setHeader('Content-Type', 'text/html');
      if (req.url.includes('StudentSchedule')) return res.end(SCHEDULE_HTML);
      if (req.url.includes('ResultsFindCourses')) return res.end(FIND_HTML);
      res.end('<html><body>OK</body></html>');
    });
    srv.listen(0, '127.0.0.1', () => {
      console.log(`Mock server → http://127.0.0.1:${srv.address().port}`);
      resolve({ srv, port: srv.address().port });
    });
  });
}

/* ── Inject extension into page ───────────────────────────────────────── */
async function injectExtension(page, baseURL) {
  const css = fs.readFileSync(path.join(EXTENSION_PATH, 'content', 'styles.css'), 'utf8');
  const papa = fs.readFileSync(path.join(EXTENSION_PATH, 'content', 'papaparse.min.js'), 'utf8');
  const contentJs = fs.readFileSync(path.join(EXTENSION_PATH, 'content', 'content.js'), 'utf8');

  await page.addStyleTag({ content: css });

  // Stub chrome API
  await page.evaluate((base) => {
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      getURL(f) {
        if (f.endsWith('.png')) return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        return base + '/' + f;
      }
    };
    window.chrome.storage = { local: { get(d, cb) { cb(d); } } };
  }, baseURL);

  await page.addScriptTag({ content: papa });
  await page.addScriptTag({ content: contentJs });
}

/* ── Main ─────────────────────────────────────────────────────────────── */
async function run() {
  const { srv, port } = await startServer();
  const BASE = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // ── Test 1: Student Schedule ──────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  TEST 1: Student Schedule Page');
  console.log('══════════════════════════════════════════');

  const sp = await context.newPage();
  const spLogs = [];
  sp.on('console', m => { if (m.text().includes('RateMyGaucho') || m.text().includes('rmg')) spLogs.push(m.text()); });
  sp.on('pageerror', e => console.log('  [PAGE ERROR]', e.message));

  await sp.goto(`${BASE}/gold/StudentSchedule.aspx`);
  await injectExtension(sp, BASE);

  // Wait for the extension scan to complete
  await sp.waitForTimeout(6000);

  let cards = await sp.$$('.rmg-card');
  let wrappers = await sp.$$('.rmg-card-wrapper');
  console.log(`  Cards rendered:    ${cards.length}`);
  console.log(`  Wrappers found:    ${wrappers.length}`);
  console.log(`  Expected max:      2 (CMPSC 32/NASIR + MATH 4A/BIGELOW)`);

  if (cards.length <= 2 && cards.length > 0) console.log('  ✅ PASS — no duplicates');
  else if (cards.length === 0) console.log('  ⚠️  No cards rendered at all');
  else console.log(`  ❌ FAIL — ${cards.length} cards (DUPLICATES!)`);

  // Dump card details
  const cardDetails = await sp.evaluate(() => {
    return [...document.querySelectorAll('.rmg-card')].map(c => {
      const header = c.querySelector('.rmg-name, .rmg-course, h3, h4');
      return header ? header.textContent.trim() : c.textContent.substring(0, 80);
    });
  });
  console.log('  Card details:', cardDetails);

  if (spLogs.length) { console.log('  Extension logs:'); spLogs.forEach(l => console.log('    ', l)); }

  // ── Test 2: Find Course Results ───────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  TEST 2: Find Courses Page');
  console.log('══════════════════════════════════════════');

  const fp = await context.newPage();
  const fpLogs = [];
  fp.on('console', m => { if (m.text().includes('RateMyGaucho') || m.text().includes('rmg')) fpLogs.push(m.text()); });
  fp.on('pageerror', e => console.log('  [PAGE ERROR]', e.message));

  await fp.goto(`${BASE}/gold/ResultsFindCourses.aspx`);
  await injectExtension(fp, BASE);
  await fp.waitForTimeout(6000);

  cards = await fp.$$('.rmg-card');
  wrappers = await fp.$$('.rmg-card-wrapper');
  console.log(`  Cards rendered:    ${cards.length}`);
  console.log(`  Wrappers found:    ${wrappers.length}`);
  console.log(`  Expected:          2 (LIU + NGUYEN)`);

  const fpDetails = await fp.evaluate(() => {
    return [...document.querySelectorAll('.rmg-card')].map(c => {
      const header = c.querySelector('.rmg-name, .rmg-course, h3, h4');
      return header ? header.textContent.trim() : c.textContent.substring(0, 80);
    });
  });
  console.log('  Card details:', fpDetails);

  if (fpLogs.length) { console.log('  Extension logs:'); fpLogs.forEach(l => console.log('    ', l)); }

  // ── Test 3: NLP Search ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  TEST 3: NLP Search');
  console.log('══════════════════════════════════════════');

  const nlpInput = await fp.$('.rmg-nlp-input');
  if (!nlpInput) {
    console.log('  ⚠️  NLP search bar not found');
    // Try to check if it exists by looking at all input elements
    const inputs = await fp.$$('input');
    console.log(`  Total inputs on page: ${inputs.length}`);
  } else {
    const queries = ['biolo', 'biology', 'BIOL', 'easy cmpsc', 'chem', 'chemistry', 'MATH', 'CMPSC 32', 'easy', 'hard', 'NASIR',
      'MWF morning', 'TR afternoon', 'after 2pm', 'MATH MWF', 'easy CMPSC morning'];
    for (const q of queries) {
      await nlpInput.fill('');
      await nlpInput.fill(q);
      await fp.waitForTimeout(500);

      await fp.waitForTimeout(500);
      const items = await fp.$$('.rmg-nlp-result-item');
      const noRes = await fp.$('.rmg-nlp-no-results');
      const hasDropdown = await fp.$('.rmg-nlp-dropdown');
      const count = items.length;
      const status = count > 0 ? `✅ ${count} results` : (noRes ? '❌ "No matching courses"' : `❌ dropdown=${!!hasDropdown}`);

      // For dept queries, verify the first result is in the right department
      let extra = '';
      if (q === 'easy cmpsc' && count > 0) {
        const firstCode = await items[0].$eval('.rmg-nlp-result-code', el => el.textContent);
        extra = firstCode.startsWith('CMPSC') ? ` (first: ${firstCode} ✅)` : ` (first: ${firstCode} ❌ NOT CMPSC!)`;
      }
      if (q === 'MATH' && count > 0) {
        const firstCode = await items[0].$eval('.rmg-nlp-result-code', el => el.textContent);
        extra = firstCode.startsWith('MATH') ? ` (first: ${firstCode} ✅)` : ` (first: ${firstCode} ❌ NOT MATH!)`;
      }
      console.log(`  "${q}" → ${status}${extra}`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  console.log('  DONE');
  console.log('══════════════════════════════════════════\n');

  await browser.close();
  srv.close();
}

run().catch(e => { console.error(e); process.exit(1); });
