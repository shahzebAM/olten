import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/modules/phase3/InsightsWorkspace.tsx', import.meta.url), 'utf8');

function reportHarness(data) {
  const effects = [];
  const writes = [];
  const converted = [];
  const ref = { current: null };
  class Element {
    isConnected = true;
    focusCalls = 0;
    focus() { this.focusCalls++; }
  }
  const opener = new Element();
  const document = { activeElement: opener, body: { style: { overflow: 'auto' } } };
  const dialog = { open: false, opens: 0, closes: 0, showModal() { this.opens++; this.open = true; }, close() { this.closes++; this.open = false; }, getBoundingClientRect() { return { left: 20, right: 620, top: 30, bottom: 530 }; } };
  ref.current = dialog;
  const dependencies = {
    react: { useRef: () => ref, useEffect: effect => effects.push(effect), useState: value => [typeof value === 'function' ? value() : value, () => {}] },
    xlsx: { utils: { book_new: () => ({}), book_append_sheet() {}, json_to_sheet: (rows, options) => { converted.push({ rows, options }); return {}; } }, writeFile: (book, filename, options) => writes.push({ book, filename, options }) },
    './FinancialReports': { default: () => null },
    '../../lib/phase3Access': {},
    './shared': { Panel: () => null, Notice: () => null, DataTable: () => null },
    './api': { secondary: 'secondary', usePhase3Data: () => ({ data, loading: !data }) },
  };
  const exports = {};
  // Export the real internal functions only inside this isolated test module.
  const code = ts.transpileModule(`${source}\nexport { ReportDialog, ReportViewer };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(code, { exports, require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), document, HTMLElement: Element, Date });
  return { ...exports, effects, writes, converted, document, dialog, opener };
}

test('management report popup opens natively and restores scrolling and focus on cleanup', () => {
  const h = reportHarness();
  const content = h.ReportDialog({ api: '/api', company: 'Company A', reportId: 'receivables-aging', onClose() {} });
  assert.equal(content.type, 'dialog');
  assert.equal(content.props['aria-labelledby'], 'management-report-title');
  const cleanup = h.effects[0]();
  assert.equal(h.dialog.opens, 1);
  assert.equal(h.dialog.open, true);
  assert.equal(h.document.body.style.overflow, 'hidden');
  cleanup();
  assert.equal(h.dialog.closes, 1);
  assert.equal(h.document.body.style.overflow, 'auto');
  assert.equal(h.opener.focusCalls, 1);
});

test('report popup closes for Escape/native close or backdrop, while content clicks remain inside', () => {
  const h = reportHarness();
  let closed = 0;
  const content = h.ReportDialog({ api: '/api', company: 'Company A', reportId: 'sales-margin', onClose() { closed++; } });
  content.props.onClick({ target: {}, currentTarget: h.dialog, clientX: 0, clientY: 0 });
  content.props.onClick({ target: h.dialog, currentTarget: h.dialog, clientX: 100, clientY: 100 });
  assert.equal(closed, 0, 'export/table interactions do not close the popup');
  content.props.onClick({ target: h.dialog, currentTarget: h.dialog, clientX: 0, clientY: 100 });
  assert.equal(closed, 1);
  content.props.onCancel();
  content.props.onClose({ currentTarget: { open: true } });
  assert.equal(closed, 2, 'a queued StrictMode cleanup close event cannot close a reopened dialog');
  content.props.onClose({ currentTarget: { open: false } });
  assert.equal(closed, 3);
  const heading = content.props.children[0];
  const closeButton = heading.props.children[1];
  assert.equal(closeButton.props.autoFocus, true);
  closeButton.props.onClick();
  assert.equal(closed, 4);
});

test('report exports retain authorized source values and escape spreadsheet formulas inside the popup', () => {
  const report = { id: 'demo-report', title: 'Source report', columns: ['description', 'amount'], rows: [{ description: '=SUM(A1)', amount: '1234.560000' }, { description: 'Normal item', amount: null }], generatedAt: '2026-10-27T00:00:00Z' };
  const before = structuredClone(report);
  const h = reportHarness(report);
  const panel = h.ReportViewer({ api: '/api', company: 'Company A', reportId: report.id });
  const buttons = panel.props.actions.props.children;
  assert.equal(buttons.length, 2);
  for (const button of buttons) { assert.equal(button.props.disabled, false); button.props.onClick(); }
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.writes.map(write => write.options.bookType), ['csv', 'xlsx']);
  assert.equal(h.converted[0].rows[0].description, "'=SUM(A1)");
  assert.equal(h.converted[0].rows[0].amount, '1234.560000');
  assert.equal(h.converted[0].rows[1].amount, '');
  assert.deepEqual(report, before);
});

test('report export controls stay disabled until backend results are available', () => {
  const h = reportHarness(undefined);
  const panel = h.ReportViewer({ api: '/api', company: 'Company A', reportId: 'pending-report' });
  for (const button of panel.props.actions.props.children) {
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  assert.equal(h.writes.length, 0);
});
