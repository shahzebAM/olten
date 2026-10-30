/**
 * Exercise the actual AttendanceEntryGrid in headless Chromium through Vite.
 * APIs use private in-memory synthetic records only; no database is contacted.
 * Requires an existing Playwright installation (PLAYWRIGHT_MODULE_DIR optional).
 * Run: node scripts/verify-attendance-quick-entry.mjs [--output-dir <path>]
 * Screenshots and JSON evidence default to a fresh private OS Temp directory.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createPortProbe } from 'node:net';

const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const frontend = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const workspace = dirname(frontend).replaceAll('\\', '/');
const output = option('--output-dir') ?? process.env.ATTENDANCE_QUICK_ENTRY_OUTPUT_DIR;
const directory = output ? resolve(output) : await mkdtemp(join(tmpdir(), 'olten-attendance-quick-entry-'));
await mkdir(directory, { recursive: true });
const require = createRequire(frontend + '/package.json');
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
let playwrightModule;
try { playwrightModule = process.env.PLAYWRIGHT_MODULE_DIR ? join(resolve(process.env.PLAYWRIGHT_MODULE_DIR), 'index.mjs') : require.resolve('playwright'); }
catch { throw new Error('Playwright was not found. Set PLAYWRIGHT_MODULE_DIR to an existing Playwright package directory.'); }
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const probe = createPortProbe();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const address = probe.address();
assert.ok(address && typeof address === 'object');
const port = address.port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
let origin;
const fixturePath = '/__attendance_quick_entry_fixture';
const entryPath = '/__attendance_quick_entry.js';
const virtualEntry = '\0attendance-quick-entry.js';
const server = await createServer({
  root: frontend, configFile: frontend + '/vite.config.ts', envDir: directory, cacheDir: join(directory, '.vite-cache'),
  appType: 'custom', clearScreen: false,
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [workspace] } },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react-dom/client'] },
  plugins: [{
    name: 'private-attendance-quick-entry-fixture', enforce: 'pre',
    resolveId(id) { if (id === entryPath) return virtualEntry; },
    load(id) {
      if (id !== virtualEntry) return;
      return `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import AttendanceEntryGrid from '/src/modules/AttendanceEntryGrid.tsx';
        import '/src/index.css';
        const employees=[{id:1,employeeId:'DEMO-001',firstName:'Demo',lastName:'Employee',company:'Example'}];
        const noop=()=>{};
        createRoot(document.getElementById('root')).render(React.createElement(AttendanceEntryGrid,{
          selectedCompany:'Example',API_BASE_URL:'${origin}/__fixture_api',employees,
          onRecordsChange:noop,onDirtyChange:noop,onBusyChange:noop,
          cutoffSelection:{month:'2026-10',period:'11-25'}
        }));`;
    },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if ((request.url ?? '').split('?')[0] !== fixturePath) return next();
        void vite.transformIndexHtml(fixturePath, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private attendance quick-entry fixture</title></head><body><div id="root"></div><script type="module" src="' + entryPath + '"></script></body></html>').then(html => {
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        }).catch(error => { response.statusCode = 500; response.end(String(error)); });
      });
    },
  }],
});
const report = { story: 'Manual attendance → compact time formatting → canonical save → same-day sessions', syntheticApiOnly: true, outputDirectory: directory, results: [] };
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  report.url = origin + fixturePath;
  process.stdout.write(`FIXTURE_READY ${report.url}\n`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const calls = [], errors = [], blocked = [], dialogs = [], records = [];
    let nextId = 1;
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { blocked.push(request.url()); await route.abort('blockedbyclient'); return; }
      if (!url.pathname.startsWith('/__fixture_api/')) { await route.continue(); return; }
      const path = url.pathname.replace('/__fixture_api', ''), method = request.method();
      const body = method === 'GET' ? undefined : request.postDataJSON();
      calls.push({ method, path, body });
      if (request.headers()['x-company'] !== 'Example') errors.push('Fixture request lacks company context');
      if (method === 'GET' && path === '/employees/attendance/all') { await route.fulfill({ status: 200, json: records }); return; }
      const existing = method === 'PATCH' && /^\/employees\/attendance\/\d+$/.test(path) ? records.find(record => record.id === Number(path.split('/').at(-1))) : undefined;
      if ((method === 'POST' && path === '/employees/attendance') || existing) {
        const candidate = { ...(existing ?? { id: nextId++, employeeId: 1 }), ...body };
        if (candidate.employeeId !== 1 || !/^2026-10-\d{2}$/.test(candidate.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.timeIn) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(candidate.timeOut)) {
          errors.push('Invalid canonical fixture payload'); await route.fulfill({ status: 400, json: { message: 'Invalid fixture punches' } }); return;
        }
        // These are synthetic display metrics, not an independent payroll calculation.
        const record = { ...candidate, hours: 8, metrics: { regularMinutes: 480, otMinutes: 0 } };
        if (existing) records[records.indexOf(existing)] = record; else records.push(record);
        await route.fulfill({ status: 200, json: record }); return;
      }
      errors.push(`Unexpected fixture API ${method} ${path}`);
      await route.fulfill({ status: 404, json: { message: 'Unknown fixture API' } });
    });
    const result = { name, viewport: { width, height }, calls, errors, blocked, dialogs, checks: [] };
    const input = (date, field, session = 1) => page.getByRole('textbox', { name: `2026-10-${date} session ${session} ${field}`, exact: true });
    const save = page.getByRole('button', { name: 'Save Attendance', exact: true });
    const waitSaved = async () => { await page.getByRole('status').filter({ hasText: /saved and confirmed/ }).waitFor(); await save.waitFor(); assert.equal(await save.isDisabled(), true); };
    try {
      await page.goto(report.url, { waitUntil: 'networkidle', timeout: 60000 });
      await page.getByRole('combobox', { name: 'Employee', exact: true }).click();
      await page.getByRole('option', { name: /Demo Employee/ }).click();
      await input('12', 'Time In').waitFor();

      await input('12', 'Time In').fill('820'); await input('12', 'Time In').press('Tab');
      assert.equal(await input('12', 'Time In').inputValue(), '8:20 AM');
      await input('12', 'Time Out').fill('820'); await input('12', 'Time Out').press('Enter');
      assert.equal(await input('12', 'Time Out').inputValue(), '8:20 PM');
      assert.equal(await input('13', 'Time Out').evaluate(element => document.activeElement === element), true);
      await save.click(); await waitSaved();
      assert.deepEqual([records[0].timeIn, records[0].timeOut], ['08:20', '20:20']);
      result.checks.push('Tab/Enter format 820 with column AM/PM defaults and save canonical times');

      await input('13', 'Time In').fill('820PM'); await input('13', 'Time In').press('Tab');
      await input('13', 'Time Out').fill('8:20AM'); await input('13', 'Time Out').press('Tab');
      assert.equal(await input('13', 'Time In').inputValue(), '8:20 PM');
      assert.equal(await input('13', 'Time Out').inputValue(), '8:20 AM');
      await save.click(); await waitSaved();
      assert.deepEqual([records[1].timeIn, records[1].timeOut], ['20:20', '08:20']);
      result.checks.push('Explicit compact PM and colon AM survive formatting and overnight save');

      await input('14', 'Time In').fill('800'); await input('14', 'Time In').press('Tab');
      await page.getByLabel('2026-10-14 session 1 choose Time Out', { exact: true }).fill('08:20');
      assert.equal(await input('14', 'Time Out').inputValue(), '8:20 AM');
      await save.click(); await waitSaved();
      assert.deepEqual([records[2].timeIn, records[2].timeOut], ['08:00', '08:20']);
      result.checks.push('Native time picker 08:20 preserves AM in Time Out');

      const mutationsBeforeInvalid = calls.filter(call => call.method !== 'GET').length;
      await input('15', 'Time In').fill('860'); await input('15', 'Time Out').fill('820');
      await save.click();
      await page.getByRole('status').filter({ hasText: /Correct the highlighted rows/ }).waitFor();
      assert.equal(calls.filter(call => call.method !== 'GET').length, mutationsBeforeInvalid);
      assert.equal(await input('15', 'Time In').inputValue(), '860');
      result.checks.push('Invalid 860 remains visible and blocks all writes');

      await input('15', 'Time In').fill('830'); await input('15', 'Time Out').fill('1200PM');
      await page.getByRole('button', { name: 'Add Session 2026-10-15', exact: true }).click();
      await input('15', 'Time In', 2).fill('100PM'); await input('15', 'Time Out', 2).fill('820');
      await input('15', 'Time Out', 2).press('Tab');
      assert.equal(await input('15', 'Time In', 2).inputValue(), '1:00 PM');
      assert.equal(await input('15', 'Time Out', 2).inputValue(), '8:20 PM');
      await save.click(); await waitSaved();
      assert.deepEqual(records.filter(record => record.date === '2026-10-15').map(record => [record.timeIn, record.timeOut]), [['08:30', '12:00'], ['13:00', '20:20']]);
      result.checks.push('Additional sessions support explicit afternoon IN and default evening OUT');

      await input('25', 'Time In').fill('820'); await input('25', 'Time In').press('Enter');
      assert.equal(await input('25', 'Time In').inputValue(), '8:20 AM');
      await input('25', 'Time Out').fill('820'); await input('25', 'Time Out').press('Enter');
      assert.equal(await input('25', 'Time Out').inputValue(), '8:20 PM');
      await save.click(); await waitSaved();
      result.checks.push('Enter formats the last row even without a following input');

      await input('16', 'Time In').fill('820'); await input('16', 'Time Out').fill('820');
      assert.equal(await input('16', 'Time Out').inputValue(), '820');
      await save.evaluate(element => element.click()); // Deliberately bypass blur/focus movement.
      await waitSaved();
      const savedWithoutBlur = records.find(record => record.date === '2026-10-16');
      assert.deepEqual([savedWithoutBlur.timeIn, savedWithoutBlur.timeOut], ['08:20', '20:20']);
      result.checks.push('Save without blur canonicalizes unfinished compact draft text');

      await input('12', 'Time In').fill('825'); await save.evaluate(element => element.click()); await waitSaved();
      const patch = calls.findLast(call => call.method === 'PATCH');
      assert.deepEqual(patch.body, { timeIn: '08:25' });
      assert.equal(records.find(record => record.date === '2026-10-12').timeOut, '20:20');
      result.checks.push('Editing a saved session patches only the changed canonical punch');

      const blankRows = await page.locator('tr[data-entry-date="2026-10-17"] input[data-time-field]').evaluateAll(elements => elements.map(element => element.value));
      assert.deepEqual(blankRows, ['', '']);
      result.checks.push('Untouched dates stay blank');
      await page.locator('tr[data-entry-date="2026-10-15"]').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(directory, `${name}-same-day-sessions.png`) });
      await page.locator('section[aria-label="Bulk attendance entry"]').evaluate(element => element.scrollIntoView());
      await page.screenshot({ path: join(directory, `${name}-quick-entry.png`) });
      assert.equal(errors.length, 0, 'No browser/API errors');
      assert.equal(blocked.length, 0, 'No external requests');
      assert.equal(dialogs.length, 0, 'No unexpected dialogs');
      result.savedSyntheticSessions = records.length;
      result.pass = true;
      process.stdout.write(`PASS ${name}: ${result.checks.length} checks, ${records.length} synthetic sessions\n`);
    } catch (error) {
      result.pass = false; result.failure = String(error);
      await page.screenshot({ path: join(directory, `${name}-failure.png`) }).catch(() => {});
      process.stdout.write(`FAIL ${name}: ${error}\n`);
    } finally { await context.close(); report.results.push(result); }
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`REPORT ${join(directory, 'report.json')}\n`);
  if (report.results.some(result => !result.pass)) process.exitCode = 1;
} finally { if (browser) await browser.close(); await server.close(); }
