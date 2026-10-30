import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/modules/BiometricsAttendanceImport.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const incoming = { personnelId: '007', employeeId: 7, date: '2026-10-12', timeIn: '08:00', timeOut: '18:00', rowNumbers: [2, 3], complete: true, status: 'new' };
const replacementDay = { employeeId: 7, personnelId: '007', date: incoming.date, status: 'replace', before: [{ id: 10, timeIn: '09:00', timeOut: '17:00' }], incoming: [incoming], keepIds: [], removeIds: [10] };
const replacementPlan = { sessions: [incoming], issues: [], replacementDays: [replacementDay], summary: { employeeCount: 1, newSessions: 0, duplicateSessions: 0, conflictSessions: 0, incompleteSessions: 0, unmatchedPunches: 0, invalidPunches: 0, blockedPunches: 0, outsideRangePunches: 0, duplicatePunches: 0, replacementDays: 1, replacedSessions: 1, removedSessions: 1 } };
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(respond) {
  const slots = []; let cursor = 0, keys = 0;
  const calls = [], exports = {};
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect() {},
  };
  runInNewContext(code, { exports, AbortController, crypto: { randomUUID: () => `submission-${++keys}` }, fetch: async (_url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (respond) return await respond(body, calls.length);
    return { ok: true, status: 200, json: async () => ({ plan: replacementPlan, previewFingerprint: 'a'.repeat(64), imported: body.dryRun ? 0 : 1, replacedDays: body.dryRun ? 0 : 1, removed: body.dryRun ? 0 : 1, dryRun: body.dryRun }) };
  }, require: name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name === '../lib/apiSession') return { getApiAuthHeaders: () => ({ Authorization: 'Bearer synthetic' }) };
    if (name === '../lib/biometricsWorkbook') return { readBiometricsFile: async () => ({ rows: [{ personnelId: '007', date: incoming.date, time: incoming.timeIn, direction: 'IN' }, { personnelId: '007', date: incoming.date, time: incoming.timeOut, direction: 'OUT' }], startDate: incoming.date, endDate: incoming.date }) };
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  const props = { selectedCompany: 'Example', API_BASE_URL: 'http://example.invalid', disabled: false, onBusyChange() {}, async onImported() {} };
  const render = (overrides = {}) => { cursor = 0; return exports.default({ ...props, ...overrides }); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return undefined;
    if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
  };
  const byLabel = label => find(render(), node => node.props?.['aria-label'] === label);
  const button = text => find(render(), node => node.type === 'button' && String(node.props.children).includes(text));
  const upload = async () => { byLabel('Choose biometrics file').props.onChange({ target: { files: [{ name: 'synthetic.xls' }], value: '' } }); await settle(); };
  return { render, byLabel, button, upload, calls };
}

test('overwrite is the visible default and preview shows exact before/after changes before applying', async () => {
  const ui = harness();
  assert.equal(ui.byLabel('Import behavior').props.value, 'replace');
  await ui.upload();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].dryRun, true); assert.equal(ui.calls[0].mode, 'replace');
  const html = renderToStaticMarkup(ui.render());
  for (const text of ['Review before/after changes', '09:00', '17:00', '08:00', '18:00', '1 old sessions will be removed', 'Saved payrolls stay unchanged']) assert.ok(html.includes(text), text);
  const apply = ui.button('Apply import:'); assert.ok(apply); assert.equal(apply.props.disabled, false);
  apply.props.onClick(); await settle();
  assert.equal(ui.calls[1].submissionKey, ui.calls[0].submissionKey);
  assert.equal(ui.calls[1].previewFingerprint, 'a'.repeat(64)); assert.equal(ui.calls[1].dryRun, false);
  assert.equal(ui.button('Apply import:').props.disabled, true);
  const savedHtml = renderToStaticMarkup(ui.render());
  assert.ok(savedHtml.includes('1 employee dates replaced'));
  assert.ok(savedHtml.includes('1 old sessions removed'));
});

test('a lost reply retries with the original submission key; a changed mode requires a new preview', async () => {
  let failed = false;
  const ui = harness(async body => {
    if (!body.dryRun && !failed) { failed = true; throw new Error('Connection lost'); }
    return { ok: true, status: 200, json: async () => ({ plan: body.mode === 'replace' ? replacementPlan : { ...replacementPlan, replacementDays: undefined, summary: { ...replacementPlan.summary, newSessions: 1 } }, previewFingerprint: 'b'.repeat(64), imported: body.dryRun ? 0 : 1, replacedDays: 1, removed: 1, dryRun: body.dryRun }) };
  });
  await ui.upload(); ui.button('Apply import:').props.onClick(); await settle();
  ui.button('Apply import:').props.onClick(); await settle();
  assert.equal(ui.calls[1].submissionKey, ui.calls[2].submissionKey);
  ui.byLabel('Import behavior').props.onChange({ target: { value: 'append' } });
  assert.equal(ui.button('Import 1 new sessions'), undefined);
  ui.button('Preview import').props.onClick(); await settle();
  assert.equal(ui.calls.at(-1).mode, 'append'); assert.notEqual(ui.calls.at(-1).submissionKey, ui.calls[0].submissionKey);
});

test('a stale preview clears the apply action and disabled attendance never submits', async () => {
  const ui = harness(async body => ({ ok: body.dryRun, status: body.dryRun ? 200 : 409, json: async () => body.dryRun ? { plan: replacementPlan, previewFingerprint: 'c'.repeat(64), imported: 0, dryRun: true } : { message: 'Attendance changed. Preview again.' } }));
  await ui.upload(); ui.button('Apply import:').props.onClick(); await settle();
  assert.equal(ui.button('Apply import:'), undefined);
  assert.ok(renderToStaticMarkup(ui.render()).includes('Attendance changed. Preview again.'));
  const disabled = harness();
  const tree = disabled.render({ disabled: true });
  assert.ok(renderToStaticMarkup(tree).includes('Save or discard attendance edits'));
  assert.equal(disabled.calls.length, 0);
});
