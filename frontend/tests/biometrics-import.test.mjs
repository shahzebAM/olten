import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import xlsx from 'xlsx';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path, dependencies = {}) {
  const url = new URL(path, import.meta.url);
  if (cache.has(url.href)) return cache.get(url.href);
  const exports = {};
  const code = ts.transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { exports, Date, console, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected test dependency: ${name}`);
  } });
  cache.set(url.href, exports); return exports;
}
const money = load('../../backend/src/employees/payroll-money.ts');
const calculator = load('../../backend/src/employees/attendance-calculator.ts', { './payroll-money': money });
const planner = load('../../backend/src/employees/biometrics-import.ts', { './attendance-calculator': calculator });
const reader = load('../src/lib/biometricsWorkbook.ts', { xlsx, '../../../backend/src/employees/biometrics-import': planner });
const header = [' PERSONNEL ID', ' LASTNAME', ' FIRSTNAME', 'DATE', 'TIME', 'IN / OUT', 'DEPARTMENT'];
const book = rows => ({ SheetNames: ['Report'], Sheets: { Report: xlsx.utils.aoa_to_sheet(rows) } });

test('reads the reference layout, preserves alphanumeric IDs and ignores names/departments', async () => {
  const result = await reader.extractBiometricRows(book([header, ['TEST-005', 'Wrong name', 'Ignored', '10-13-2026', '11:31:25 AM', 'IN', 'Another company'], ['TEST-005', '', '', '10-13-2026', '08:27:55 PM', 'OUT', 'Ignored']]));
  assert.equal(result.rows.length, 2); assert.equal(result.startDate, '2026-10-13'); assert.equal(result.endDate, '2026-10-13');
  assert.deepEqual(Object.keys(result.rows[0]).sort(), ['date', 'direction', 'personnelId', 'rowNumber', 'time']);
  const plan = planner.planBiometricImport(planner.normalizeBiometricPunches(result.rows), [{ id: 10, employeeId: 'TEST-005' }], [], result);
  assert.equal(plan.sessions[0].timeIn, '11:31'); assert.equal(plan.sessions[0].timeOut, '20:27');
});
test('reads actual OOXML content despite an .xls extension', async () => {
  const data = xlsx.write(book([header, ['007', '', '', '10-12-2026', '08:00:59', 'IN', '']]), { type: 'array', bookType: 'xlsx' });
  const result = await reader.readBiometricsFile({ name: 'biometrics.xls', size: data.byteLength, arrayBuffer: async () => data });
  assert.equal(result.rows[0].personnelId, '007'); assert.equal(result.rows[0].time, '08:00:59');
});

test('blank workbook TIME cells create blank attendance while separate pairs remain distinct', async () => {
  const result = await reader.extractBiometricRows(book([header,
    ['007', '', '', '10-12-2026', null, 'IN', 'Ignored'],
    ['007', '', '', '10-12-2026', null, 'OUT', 'Ignored'],
    ['007', '', '', '10-13-2026', null, 'IN', 'Ignored'],
    ['007', '', '', '10-13-2026', '17:00:59', 'OUT', 'Ignored'],
    ['007', '', '', '10-14-2026', '08:00:59', 'IN', 'Ignored'],
    ['007', '', '', '10-14-2026', '12:00:59', 'OUT', 'Ignored'],
    ['007', '', '', '10-14-2026', '13:00:59', 'IN', 'Ignored'],
    ['007', '', '', '10-14-2026', '17:00:59', 'OUT', 'Ignored'],
  ]));
  const plan = planner.planBiometricImport(planner.normalizeBiometricPunches(result.rows), [{ id: 7, employeeId: '007' }], [], result);
  assert.equal(plan.summary.invalidPunches, 0);
  assert.equal(plan.summary.incompleteSessions, 2);
  assert.deepEqual(Array.from(plan.sessions, row => [row.date, row.timeIn, row.timeOut]), [
    ['2026-10-12', '', ''],
    ['2026-10-13', '', '17:00'],
    ['2026-10-14', '08:00', '12:00'],
    ['2026-10-14', '13:00', '17:00'],
  ]);
});
test('handles formatted numeric IDs and serial Excel dates/times without timezone conversion', async () => {
  const workbook = book([header, [7, '', '', 46308, (20 * 3600 + 27 * 60 + 55) / 86400, 'OUT', '']]);
  workbook.Sheets.Report.A2.w = '0007';
  const result = await reader.extractBiometricRows(workbook);
  assert.equal(result.rows[0].personnelId, '0007');
  assert.equal(result.rows[0].time, '20:27:55');
  const expected = xlsx.SSF.parse_date_code(46308);
  assert.equal(result.rows[0].date, `${expected.y}-${String(expected.m).padStart(2, '0')}-${String(expected.d).padStart(2, '0')}`);
});
test('supports the 1904 workbook calendar', async () => {
  const workbook = book([header, ['007', '', '', 0, '08:00', 'IN', '']]);
  workbook.Workbook = { WBProps: { date1904: true } };
  assert.equal((await reader.extractBiometricRows(workbook)).rows[0].date, '1904-01-01');
});
test('keeps missing cells empty for server review and does not carry the previous ID', async () => {
  const result = await reader.extractBiometricRows(book([header, ['007', '', '', '2026-10-12', '08:00', 'IN', ''], ['', '', '', '2026-10-12', '', 'OUT', '']]));
  assert.equal(result.rows[1].personnelId, ''); assert.equal(result.rows[1].time, '');
});
test('finds headers after a title and skips repeated header lines', async () => {
  const result = await reader.extractBiometricRows(book([['Attendance report'], [], header, ['007', '', '', '2026-10-12', '08:00', 'IN', ''], header]));
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].rowNumber, 4);
});
test('combines compatible sheets and reports source date bounds', async () => {
  const workbook = book([header, ['007', '', '', '2026-10-12', '08:00', 'IN', '']]);
  workbook.SheetNames.push('Second'); workbook.Sheets.Second = xlsx.utils.aoa_to_sheet([header, ['007', '', '', '2026-10-25', '17:00', 'OUT', '']]);
  const result = await reader.extractBiometricRows(workbook);
  assert.equal(result.sheetCount, 2); assert.equal(result.rows.length, 2); assert.equal(result.endDate, '2026-10-25');
});
test('rejects absent or ambiguous headers, required formulas, oversized files and unsafe IDs', async () => {
  await assert.rejects(reader.extractBiometricRows(book([['ID', 'Department']])), /Required columns/);
  await assert.rejects(reader.extractBiometricRows(book([[...header, 'TIME']])), /repeated/);
  const workbook = book([header, ['007', '', '', '2026-10-12', '08:00', 'IN', '']]); workbook.Sheets.Report.E2.f = 'NOW()';
  await assert.rejects(reader.extractBiometricRows(workbook), /not formulas/);
  await assert.rejects(reader.readBiometricsFile({ name: 'report.xls', size: 6 * 1024 * 1024 }), /5 MB/);
  await assert.rejects(reader.readBiometricsFile({ name: 'report.exe', size: 10 }), /\.xls/);
  await assert.rejects(reader.extractBiometricRows(book([header, [9007199254740992, '', '', '2026-10-12', '08:00', 'IN', '']])), /precision/);
});
test('the import panel explains matching and accepts workbook/CSV files without auto-saving', () => {
  const panel = load('../src/modules/BiometricsAttendanceImport.tsx', {
    react: require('react'), 'react/jsx-runtime': require('react/jsx-runtime'), '../lib/apiSession': { getApiAuthHeaders: () => ({}) }, '../lib/biometricsWorkbook': reader,
  });
  const html = renderToStaticMarkup(React.createElement(panel.default, { selectedCompany: 'Example', API_BASE_URL: 'http://example.invalid', disabled: false, onBusyChange() {}, async onImported() {} }));
  assert.match(html, /Import biometrics/); assert.match(html, /\.xls,\.xlsx,\.csv/); assert.match(html, /Seconds and departments are ignored/);
  assert.doesNotMatch(html, /Import 0 new sessions/);
});
