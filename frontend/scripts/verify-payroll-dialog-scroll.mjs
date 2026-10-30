import assert from 'node:assert/strict';
/**
 * Real Chromium layout check using the actual PayrollModule and Vite styles.
 * Requires an existing Playwright installation; no packages are installed.
 * Set PLAYWRIGHT_MODULE_DIR to its package directory if it is not resolvable.
 * Run: node scripts/verify-payroll-dialog-scroll.mjs --mode post
 * Reproduce baseline: add --mode pre --baseline ee8d0ac
 * Screenshots/report default to a fresh private OS Temp directory.
 * Optional output: --output-dir <path> or PAYROLL_SCROLL_OUTPUT_DIR.
 * Set PAYROLL_SCROLL_REQUIRE_GUTTER=1 to require a native scrollbar gutter.
 * All employee/API data is synthetic; all API writes are rejected.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer as createPortProbe } from 'node:net';

const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const frontend = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const workspace = dirname(frontend).replaceAll('\\', '/');
const output = option('--output-dir') ?? process.env.PAYROLL_SCROLL_OUTPUT_DIR;
const directory = output ? resolve(output) : await mkdtemp(join(tmpdir(), 'olten-payroll-scroll-'));
const mode = option('--mode') ?? 'post';
const baselineRef = option('--baseline') ?? 'ee8d0ac';
assert.ok(['pre', 'post'].includes(mode));
const require = createRequire(frontend + '/package.json');
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
let playwrightModule;
try { playwrightModule = process.env.PLAYWRIGHT_MODULE_DIR ? join(resolve(process.env.PLAYWRIGHT_MODULE_DIR), 'index.mjs') : require.resolve('playwright'); }
catch { throw new Error('Playwright was not found. Set PLAYWRIGHT_MODULE_DIR to an existing Playwright package directory.'); }
const { chromium } = await import(pathToFileURL(playwrightModule).href);
await mkdir(directory, { recursive: true });
const preCss = mode === 'pre' ? execFileSync('git', ['-C', workspace, 'show', '--end-of-options', baselineRef + ':frontend/src/modules/payroll-workspace.css'], { encoding: 'utf8' }) : null;
if (preCss !== null) await writeFile(join(directory, 'pre-fix-payroll-workspace.css'), preCss);
// Vite treats port: 0 as its default 5173; let the OS select an ephemeral
// localhost port first, then bind Vite strictly to that selected port.
const probe = createPortProbe();
await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const probeAddress = probe.address();
assert.ok(probeAddress && typeof probeAddress === 'object');
const port = probeAddress.port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
let origin;
const fixturePath = '/__payroll_scroll_fixture';
const entryPath = '/__payroll_scroll_entry.js';
const virtualEntry = '\0payroll-scroll-entry.js';
const server = await createServer({
  root: frontend, configFile: frontend + '/vite.config.ts', envDir: directory, cacheDir: join(directory, '.vite-cache'),
  appType: 'custom', clearScreen: false,
  server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [workspace] } },
  optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react-dom/client', 'jszip', 'jspdf', 'html-to-image'] },
  plugins: [{
    name: 'private-payroll-scroll-fixture', enforce: 'pre',
    resolveId(id) { if (id === entryPath) return virtualEntry; },
    load(id) {
      if (id !== virtualEntry) return;
      return `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import PayrollModule from '/src/modules/PayrollModule.tsx';
        import '/src/index.css';
        createRoot(document.getElementById('root')).render(React.createElement(PayrollModule,{selectedCompany:'Example',loginUsername:'demo',API_BASE_URL:'${origin}/__fixture_api',onBack(){},onLogout(){}}));`;
    },
    transform(code, id) {
      if (mode === 'pre' && id.split('?')[0].replaceAll('\\', '/').toLowerCase() === (frontend + '/src/modules/payroll-workspace.css').toLowerCase()) return preCss;
    },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if ((request.url ?? '').split('?')[0] !== fixturePath) return next();
        void vite.transformIndexHtml(fixturePath, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private payroll scroll fixture</title></head><body><div id="root"></div><script type="module" src="' + entryPath + '"></script></body></html>').then(html => {
          response.setHeader('Content-Type', 'text/html'); response.end(html);
        }).catch(error => { response.statusCode = 500; response.end(String(error)); });
      });
    },
  }],
});
let browser;
const report = { mode, baselineCommit: mode === 'pre' ? baselineRef : undefined, story: 'Directory → Employee Details → scroll to saved daily rate → close without saving', outputDirectory: directory, results: [] };
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  report.url = origin + fixturePath;
  process.stdout.write(`FIXTURE_READY ${origin + fixturePath} MODE=${mode}\n`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['landscape', 844, 390]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const calls = [], errors = [], blocked = [], dialogs = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) { blocked.push(request.url()); await route.abort('blockedbyclient'); return; }
      if (!url.pathname.startsWith('/__fixture_api/')) { await route.continue(); return; }
      calls.push({ method: request.method(), path: url.pathname });
      if (request.method() !== 'GET') { errors.push('Unexpected mutating fixture request: ' + request.method()); await route.fulfill({ status: 405, json: { message: 'Read-only fixture' } }); return; }
      const defaults = { version: 1, workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'CUTOFF_NET' };
      const employee = { id: 1, employeeId: 'DEMO-001', firstName: 'Demo', middleName: '', lastName: 'Employee', company: 'Example', dateOfBirth: '1990-01-01T00:00:00.000Z', address: 'Demonstration address', civilStatus: 'Single', baseRate: 0, employmentStatus: 'Regular', tin: '', sssNumber: '', philhealth: '', pagIbig: '', bankAccount: '', cashAdvanceBalance: 0, cashAdvanceInstallment: 0, loanBalance: 0, loanInstallment: 0, payrollProfile: { version: 1, basis: 'DAILY', dailyRate: 755, paidDayBasis: 'SCHEDULED', workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'CUTOFF_NET' } };
      const path = url.pathname.replace('/__fixture_api', '');
      if (!['/employees', '/employees/payroll/defaults', '/settings', '/employees/attendance/all', '/employees/payroll/all'].includes(path)) { errors.push('Unexpected fixture GET: ' + path); await route.fulfill({ status: 404, json: { message: 'Unknown fixture API' } }); return; }
      const json = path === '/employees' ? [employee] : path === '/employees/payroll/defaults' ? { company: 'Example', defaults, configured: true } : path === '/settings' ? { company: 'Example', shiftStart: '08:00', shiftEnd: '17:00', lunchStart: '12:00', lunchEnd: '13:00' } : [];
      await route.fulfill({ status: 200, json });
    });
    const result = { name, viewport: { width, height }, calls, errors, blocked, dialogs };
    try {
      await page.goto(origin + fixturePath, { waitUntil: 'networkidle', timeout: 60000 });
      if (width < 768) await page.locator('.payroll-header > div:first-child > button').click();
      await page.getByRole('button', { name: 'Directory List', exact: true }).click();
      await page.getByRole('button', { name: 'Employee Details', exact: true }).click();
      const dialog = page.locator('.payroll-edit-dialog');
      const body = dialog.locator(':scope > form > fieldset');
      await dialog.waitFor({ state: 'visible' });
      await dialog.getByRole('spinbutton', { name: 'Daily rate', exact: true }).waitFor({ state: 'visible' });
      const geometry = () => dialog.evaluate(element => {
        const form = element.querySelector(':scope > form'), body = form.querySelector(':scope > fieldset');
        const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }; };
        const rate = body.querySelector('[aria-label="Daily rate"]');
        const style = getComputedStyle(body);
        // Fieldset scrollbars live in an anonymous content box, so its native
        // gutter is excluded from offsetWidth-clientWidth in Chromium.
        const contentGutterWidth = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - body.firstElementChild.getBoundingClientRect().width;
        const nativeGutterWidth = Math.max(body.offsetWidth - body.clientWidth, contentGutterWidth);
        return { dialog: rect(element), header: rect(element.firstElementChild), footer: rect(form.lastElementChild), body: rect(body), clientHeight: body.clientHeight, clientWidth: body.clientWidth, offsetWidth: body.offsetWidth, gutterWidth: body.offsetWidth - body.clientWidth, contentGutterWidth, nativeGutterWidth, scrollHeight: body.scrollHeight, scrollTop: body.scrollTop, overflowY: style.overflowY, scrollbarGutter: style.scrollbarGutter, scrollbarWidth: style.scrollbarWidth, rate: rect(rate), advancedOpen: body.querySelector('details').open };
      });
      result.before = await geometry();
      await page.mouse.move(Math.min(width - 16, result.before.body.x + 35), Math.min(height - 30, result.before.body.y + 70));
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(250);
      result.afterWheel = await geometry();
      await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
      result.afterBottom = await geometry();
      const rate = dialog.locator('[aria-label="Daily rate"]');
      await body.evaluate(element => {
        const target = element.querySelector('[aria-label="Daily rate"]');
        element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - Math.max(8, (element.clientHeight - target.clientHeight) / 2);
      });
      result.atRate = await geometry();
      result.scrollable = result.before.scrollHeight > result.before.clientHeight + 1;
      result.rateVisible = result.atRate.rate.y >= result.atRate.body.y && result.atRate.rate.bottom <= result.atRate.body.bottom && result.atRate.rate.y >= 0 && result.atRate.rate.bottom <= height;
      await page.screenshot({ path: directory + `/${mode}-${name}-rate.png` });
      if (mode === 'post') {
        assert.ok(result.scrollable, 'Dialog body must overflow and scroll');
        assert.ok(['auto', 'scroll'].includes(result.before.overflowY));
        if (process.env.PAYROLL_SCROLL_REQUIRE_GUTTER === '1') assert.ok(result.before.nativeGutterWidth > 0, 'Native scrollbar gutter must be visible on this browser/platform');
        assert.ok(result.afterWheel.scrollTop > 0, 'Mouse wheel must move the dialog body');
        assert.ok(result.afterBottom.scrollTop > 0, 'Explicit scroll must move the dialog body');
        assert.ok(result.rateVisible, 'Daily rate must be visible within the scrolled body and viewport');
        assert.ok(result.atRate.dialog.y >= 0 && result.atRate.dialog.bottom <= height + 1, 'Dialog stays within viewport');
        assert.ok(result.atRate.footer.y >= 0 && result.atRate.footer.bottom <= height + 1, 'Footer remains visible');
        for (const part of ['header', 'footer']) assert.ok(Math.abs(result.before[part].y - result.atRate[part].y) < 1, `${part} stays stationary`);
        const advanced = dialog.locator('summary').filter({ hasText: 'Advanced employee exceptions' });
        await advanced.locator('..').evaluate(element => { element.open = false; });
        await body.evaluate(element => { const summary = element.querySelector('summary'); element.scrollTop += summary.getBoundingClientRect().top - element.getBoundingClientRect().top - 8; });
        await advanced.click();
        assert.equal(await advanced.locator('..').evaluate(element => element.open), true, 'Advanced exceptions can expand');
        const advancedGeometry = await geometry();
        assert.ok(advancedGeometry.scrollHeight > advancedGeometry.clientHeight, 'Expanded advanced fields remain scrollable');
        for (const part of ['header', 'footer']) assert.ok(Math.abs(result.before[part].y - advancedGeometry[part].y) < 1, `${part} stays stationary with advanced fields open`);
        await dialog.getByRole('button', { name: 'Save Employee & Pay Setup', exact: true }).click({ trial: true });
        result.saveTrialPass = true;
        await page.screenshot({ path: directory + `/${mode}-${name}-advanced.png` });
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        result.cancelWorked = true;
        await page.getByRole('button', { name: 'Employee Details', exact: true }).click();
        await page.getByRole('button', { name: 'Close employee details', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        result.closeWorked = true;
        assert.equal(dialogs.length, 0, 'Closing unchanged employee details needs no discard prompt');
      } else {
        assert.equal(result.scrollable && result.rateVisible && result.afterWheel.scrollTop > 0, false, 'Pre-fix must reproduce the scroll regression');
      }
      assert.equal(errors.length, 0, 'No browser/API errors');
      assert.equal(blocked.length, 0, 'No external requests');
      assert.ok(calls.every(call => call.method === 'GET'), 'All fixture APIs were read-only');
      result.pass = true;
      process.stdout.write(`${mode.toUpperCase()} ${name}: body ${result.before.clientHeight}/${result.before.scrollHeight}, wheel ${result.afterWheel.scrollTop}, bottom ${result.afterBottom.scrollTop}, rateVisible ${result.rateVisible}\n`);
    } catch (error) {
      result.pass = false; result.failure = String(error);
      await page.screenshot({ path: directory + `/${mode}-${name}-failure.png` }).catch(() => {});
      process.stdout.write(`FAIL ${mode} ${name}: ${error}\n`);
    } finally { await context.close(); report.results.push(result); }
  }
  await writeFile(join(directory, `${mode}-report.json`), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`REPORT ${join(directory, `${mode}-report.json`)}\n`);
  if (report.results.some(result => !result.pass)) process.exitCode = 1;
} finally { if (browser) await browser.close(); await server.close(); }
