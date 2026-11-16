/*
 * e2e.js — drives the real app in Chromium.
 * Serves the repo over http, walks the core workflow, and fails on any
 * console error or uncaught exception.
 *
 *   node tests/e2e.js            headless
 *   SHOTS=1 node tests/e2e.js    also writes screenshots to /tmp
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.json':'application/json', '.webmanifest':'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/tests/blank') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>host</title>'); return; }
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const problems = [];
let step = 0;
function ok(msg) { step++; console.log('  ok   ' + msg); }
function bad(msg) { problems.push(msg); console.log('  FAIL ' + msg); }

(async () => {
  await new Promise(r => server.listen(0, r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

  page.on('console', m => {
    if (m.type() === 'error') bad('console error: ' + m.text());
  });
  page.on('pageerror', e => bad('uncaught exception: ' + e.message));

  const shot = async name => {
    if (process.env.SHOTS) {
      await page.screenshot({ path: '/tmp/cl-' + name + '.png', fullPage: true });
    }
  };

  try {
    /* ---- load ---- */
    await page.goto(base + '/index.html');
    await page.waitForSelector('#view .empty, #view .stats', { timeout: 8000 });
    ok('app loads and renders the dashboard');

    const regCount = await page.evaluate(() => window.TEST_REGISTRY.length);
    if (regCount === 35) ok('registry exposes 35 tests in the browser');
    else bad('registry has ' + regCount + ' tests, expected 35');

    /* ---- settings ---- */
    await page.goto(base + '/index.html#/settings');
    await page.waitForSelector('[data-scope="settings"]');
    await page.fill('[data-k="labName"]', 'Ayussha Materials Testing Laboratory');
    await page.fill('[data-k="address"]', 'Bengaluru, Karnataka');
    await page.fill('[data-k="signatory"]', 'B. R. Bharathi');
    await page.click('button:has-text("Save settings")');
    await page.waitForSelector('.toast.show');
    ok('settings save');

    /* ---- create a job ---- */
    await page.goto(base + '/index.html#/job/new');
    await page.waitForSelector('[data-scope="job"]');
    await page.fill('[data-k="jobNo"]', 'JOB-2026-001');
    await page.fill('[data-k="clientName"]', 'BMRCL');
    await page.fill('[data-k="project"]', 'Metro viaduct pier');
    await page.fill('[data-k="element"]', 'Pier P12');
    await page.selectOption('[data-k="grade"]', 'M30');
    await page.selectOption('[data-k="exposure"]', 'Severe');
    await page.fill('[data-k="volume"]', '120');

    const hint = await page.textContent('.card p.muted');
    if (/at least 26 N\/mm/.test(hint) && /at least 34 N\/mm/.test(hint)) {
      ok('live IS 456 hint shows the M30 limits (26 and 34 N/mm2)');
    } else bad('job hint wrong: ' + hint);
    if (/at least 6 sample/.test(hint)) ok('sampling frequency for 120 m3 is 6 samples');
    else bad('sampling hint wrong: ' + hint);

    await page.click('button:has-text("Save job")');
    await page.waitForSelector('h1:has-text("JOB-2026-001")');
    ok('job saves and the detail page opens');
    await shot('job');

    const jobUrl = page.url();
    const jobId = jobUrl.split('#/job/')[1];
    /* set below once tests exist: the job table must show the strength,
       not an incidental figure such as the specimen count */
    var checkKeyColumn = async () => {
      const cells = await page.$$eval(
        '.card:has-text("Tests") table.results tbody tr td:nth-child(5)',
        tds => tds.map(t => t.textContent.trim()));
      if (cells.length && cells.every(c => /^3[0-9](\.\d)? N\/mm/.test(c))) {
        ok('job table key result shows the compressive strength (' + cells[0] + ')');
      } else bad('key result column shows: ' + JSON.stringify(cells));
    };

    /* durability check for severe exposure vs M30 */
    const durVerdict = await page.textContent('.card:has-text("Durability requirements") .verdict');
    if (/PASS/.test(durVerdict)) ok('M30 passes the severe-exposure minimum grade check');
    else bad('durability verdict: ' + durVerdict);

    /* ---- record four 28-day cube tests ---- */
    const sets = [
      { date: '2026-10-01', loads: [780, 790, 785] },   /* ~34.5 */
      { date: '2026-10-02', loads: [800, 795, 805] },   /* ~35.5 */
      { date: '2026-10-03', loads: [770, 775, 780] },   /* ~34.5 */
      { date: '2026-10-04', loads: [810, 800, 815] }    /* ~36.0 */
    ];
    for (let i = 0; i < sets.length; i++) {
      await page.goto(base + '/index.html#/test/new/' + jobId + '/cube-compressive');
      await page.waitForSelector('.specimens .specimen');
      await page.fill('[data-scope="meta"] [data-k="date"]', sets[i].date);
      await page.fill('[data-k="age"]', '28');
      const cards = await page.$$('.specimens .specimen');
      for (let c = 0; c < cards.length; c++) {
        await cards[c].$eval('[data-k="load"]', (n, v) => { n.value = v; }, String(sets[i].loads[c]));
      }
      await page.click('button:has-text("Save test")');
      await page.waitForSelector('h1:has-text("JOB-2026-001")');
    }
    ok('four 28-day cube tests recorded');

    await checkKeyColumn();

    /* ---- acceptance summary ---- */
    await page.goto(jobUrl);
    await page.waitForSelector('.card:has-text("IS 456 acceptance")');
    const accText = await page.textContent('.card:has-text("IS 456 acceptance")');
    if (/Samples 1–4/.test(accText)) ok('acceptance groups the four samples');
    else bad('no group of four found in acceptance block');
    if (/COMPLIES/.test(accText)) ok('verdict is COMPLIES for a compliant set');
    else bad('acceptance verdict unexpected: ' + accText.slice(0, 200));
    await shot('acceptance');

    /* ---- a failing individual result ---- */
    await page.goto(base + '/index.html#/test/new/' + jobId + '/cube-compressive');
    await page.waitForSelector('.specimens .specimen');
    await page.fill('[data-scope="meta"] [data-k="date"]', '2026-10-05');
    await page.fill('[data-k="age"]', '28');
    let cards = await page.$$('.specimens .specimen');
    for (const c of cards) await c.$eval('[data-k="load"]', n => { n.value = '520'; }); /* ~23 */
    await page.click('button:has-text("Calculate")');
    await page.waitForSelector('.preview .verdict');
    const failV = await page.textContent('.preview .verdict');
    if (/FAIL/.test(failV) && /26/.test(failV)) ok('a 23 N/mm2 result fails the M30 individual criterion');
    else bad('expected FAIL against 26 N/mm2, got: ' + failV);

    /* ---- 15 percent scatter rule ---- */
    cards = await page.$$('.specimens .specimen');
    const scatter = ['780', '790', '500'];
    for (let c = 0; c < cards.length; c++) {
      await cards[c].$eval('[data-k="load"]', (n, v) => { n.value = v; }, scatter[c]);
    }
    await page.click('button:has-text("Calculate")');
    await page.waitForTimeout(150);
    const scatterV = await page.textContent('.preview .verdict');
    if (/REVIEW/.test(scatterV)) ok('specimen scatter over 15 percent is flagged for review');
    else bad('expected REVIEW on scatter, got: ' + scatterV);

    /* ---- a non-cube test with a fixed-row table ---- */
    await page.goto(base + '/index.html#/test/new/' + jobId + '/sieve-analysis-fine');
    await page.waitForSelector('table.data-entry');
    const masses = [0, 20, 80, 150, 250, 300, 150, 50];
    const inputs = await page.$$('table.data-entry tbody input');
    for (let i = 0; i < inputs.length; i++) {
      await inputs[i].fill(String(masses[i]));
    }
    await page.click('button:has-text("Calculate")');
    await page.waitForSelector('.preview .verdict');
    const sieveText = await page.textContent('.preview');
    if (/Zone II/.test(sieveText)) ok('sieve analysis classifies the sand as Zone II');
    else bad('sieve zone unexpected: ' + sieveText.slice(0, 300));
    await page.click('button:has-text("Save test")');
    await page.waitForSelector('h1:has-text("JOB-2026-001")');
    ok('sieve analysis saves');

    /* ---- a list-input test ---- */
    await page.goto(base + '/index.html#/test/new/' + jobId + '/rcpt');
    await page.waitForSelector('.list-field');
    const li = await page.$$('.list-field input[data-list]');
    for (const inp of li) await inp.fill('100');
    await page.click('button:has-text("Calculate")');
    await page.waitForSelector('.preview .verdict');
    const rcptText = await page.textContent('.preview');
    if (/2160/.test(rcptText)) ok('RCPT integrates 100 mA over 6 h to 2160 coulombs');
    else bad('RCPT charge unexpected: ' + rcptText.slice(0, 300));
    await page.click('button:has-text("Save test")');
    await page.waitForSelector('h1:has-text("JOB-2026-001")');

    /* ---- register ---- */
    await page.goto(base + '/index.html#/register');
    await page.waitForSelector('table.results');
    const rows = await page.$$eval('table.results tbody tr', r => r.length);
    if (rows === 6) ok('register lists all six saved tests');
    else bad('register shows ' + rows + ' rows, expected 6');
    const stats = await page.textContent('.card p.muted');
    if (/standard deviation/.test(stats)) ok('register shows running mean and standard deviation');
    else bad('register stats line missing: ' + stats);
    await shot('register');

    /* filter by verdict */
    await page.selectOption('.filters select >> nth=1', 'PASS');
    await page.waitForTimeout(200);
    ok('verdict filter applies without error');

    /* ---- certificate ---- */
    await page.goto(base + '/index.html#/certificate/' + jobId);
    await page.waitForSelector('.certificate');
    await page.click('button:has-text("Assign next number")');
    await page.waitForFunction(() => {
      const i = document.querySelector('.no-print input[type=text]');
      return i && i.value.length > 0;
    }, null, { timeout: 5000 });
    const issuedRef = await page.inputValue('.no-print input[type=text]');
    if (/^[A-Za-z]+\/20\d\d\/\d{4}$/.test(issuedRef)) {
      ok('certificate number has the prefix/year/sequence form (' + issuedRef + ')');
    } else bad('certificate number malformed: ' + issuedRef);

    const certText = await page.textContent('.certificate');
    if (certText.indexOf(issuedRef) > -1) ok('the issued number appears on the certificate');
    else bad('issued number ' + issuedRef + ' is missing from the document');

    /* the counter must advance and never reissue the same number */
    await page.click('button:has-text("Assign next number")');
    await page.waitForFunction(prev => {
      const i = document.querySelector('.no-print input[type=text]');
      return i && i.value && i.value !== prev;
    }, issuedRef, { timeout: 5000 });
    const secondRef = await page.inputValue('.no-print input[type=text]');
    const seq = r => parseInt(r.split('/').pop(), 10);
    if (seq(secondRef) === seq(issuedRef) + 1) ok('certificate numbers increment and are not reused');
    else bad('second number ' + secondRef + ' does not follow ' + issuedRef);
    if (/Ayussha Materials Testing Laboratory/.test(certText)) ok('letterhead appears on the certificate');
    else bad('letterhead missing from certificate');
    if (/Acceptance criteria/.test(certText)) ok('certificate includes the IS 456 acceptance block');
    else bad('acceptance block missing from certificate');
    await shot('certificate');

    /* print stylesheet actually hides the chrome */
    await page.emulateMedia({ media: 'print' });
    const barVisible = await page.isVisible('.app-bar');
    if (!barVisible) ok('print stylesheet hides the app chrome');
    else bad('app bar still visible when printing');
    await page.emulateMedia({ media: 'screen' });

    /* ---- standards page ---- */
    await page.goto(base + '/index.html#/standards');
    await page.waitForSelector('dl.summary');
    await page.selectOption('.card select', 'M20');
    await page.waitForTimeout(150);
    const stdText = await page.textContent('.card');
    if (/24 N\/mm/.test(stdText)) ok('standards calculator recomputes for M20 (mean limit 24)');
    else bad('standards calculator wrong for M20');

    /* ---- backup round trip ---- */
    const backup = await page.evaluate(() => DB.exportAll().then(d => JSON.stringify(d)));
    const parsed = JSON.parse(backup);
    if (parsed.jobs.length === 1 && parsed.tests.length === 6) ok('backup contains the job and all six tests');
    else bad('backup contents wrong: ' + parsed.jobs.length + ' jobs, ' + parsed.tests.length + ' tests');

    const restored = await page.evaluate(b =>
      DB.wipe().then(() => DB.importAll(JSON.parse(b), true))
        .then(() => DB.all('tests')).then(t => t.length), backup);
    if (restored === 6) ok('wipe then restore returns all six tests');
    else bad('after restore there are ' + restored + ' tests');

    /* ---- unknown route ---- */
    await page.goto(base + '/index.html#/nonsense');
    await page.waitForSelector('.empty');
    const nf = await page.textContent('.empty');
    if (/not found/i.test(nf)) ok('unknown routes show a not-found state');
    else bad('unknown route did not render the not-found state');

    /* ---- opened as a local file, the way a double-click opens it ---- */
    const os = require('os');
    const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-lone-'));
    fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(lone, 'index.html'));
    for (const [label, file] of [
      ['in the project folder', path.join(ROOT, 'index.html')],
      ['alone, with no css/ or js/ folders beside it', path.join(lone, 'index.html')]
    ]) {
      const fp = await browser.newPage();
      const errs = [];
      fp.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      fp.on('pageerror', e => errs.push(e.message));
      await fp.goto('file://' + file);
      try {
        await fp.waitForSelector('#view .empty, #view .stats', { timeout: 8000 });
        const styled = await fp.evaluate(() =>
          getComputedStyle(document.querySelector('.app-bar')).position === 'sticky');
        if (styled && !errs.length) ok('double-clicked index.html works ' + label);
        else bad('index.html ' + label + ': styled=' + styled + ', errors=' + JSON.stringify(errs));
      } catch (e) {
        bad('index.html ' + label + ' did not start: ' + e.message + ' ' + JSON.stringify(errs));
      }
      await fp.close();
    }
    fs.rmSync(lone, { recursive: true, force: true });

    /* ---- inside a sandboxed preview frame (no storage allowed) ---- */
    {
      const sp = await browser.newPage();
      const errs = [];
      sp.on('pageerror', e => errs.push(e.message));
      sp.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await sp.goto(base + '/tests/blank');           /* any http page as host */
      await sp.setContent('<iframe id="f" sandbox="allow-scripts" ' +
        'style="width:1200px;height:900px"></iframe>');
      await sp.evaluate(html => { document.getElementById('f').srcdoc = html; },
        fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
      const fr = sp.frameLocator('#f');
      try {
        await fr.locator('#view .empty, #view .stats').first().waitFor({ timeout: 8000 });
        if (await fr.locator('.storage-warning').count()) ok('sandboxed preview: app opens and warns that nothing is saved');
        else bad('sandboxed preview: no storage warning shown');
        await fr.locator('nav a', { hasText: 'Jobs' }).click();
        await fr.locator('h1', { hasText: 'Jobs' }).waitFor({ timeout: 5000 });
        ok('sandboxed preview: navigation links work');
        await fr.locator('a', { hasText: 'New job' }).first().click();
        await fr.locator('[data-k="jobNo"]').fill('PREVIEW-1');
        await fr.locator('[data-k="clientName"]').fill('Test');
        await fr.locator('button', { hasText: 'Save job' }).click();
        await fr.locator('h1', { hasText: 'PREVIEW-1' }).waitFor({ timeout: 5000 });
        ok('sandboxed preview: a job can be created on the temporary copy');
        if (!errs.length) ok('sandboxed preview: no script errors');
        else bad('sandboxed preview errors: ' + JSON.stringify(errs));
      } catch (e) {
        bad('sandboxed preview failed: ' + e.message + ' ' + JSON.stringify(errs));
      }
      await sp.close();
    }

    /* the development page, which loads the separate files, still works */
    const dp = await browser.newPage();
    const derrs = [];
    dp.on('pageerror', e => derrs.push(e.message));
    await dp.goto(base + '/dev.html');
    await dp.waitForSelector('#view .empty, #view .stats', { timeout: 8000 });
    if (!derrs.length) ok('dev.html still runs from the separate source files');
    else bad('dev.html errors: ' + derrs.join('; '));
    await dp.close();

  } catch (e) {
    bad('threw during the walkthrough: ' + e.message);
  }

  await browser.close();
  server.close();

  console.log('\n============================');
  console.log('checks passed: ' + (step) + '   problems: ' + problems.length);
  if (problems.length) { problems.forEach(p => console.log(' - ' + p)); process.exit(1); }
})();
