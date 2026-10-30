import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, Date, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
}
const money = load('../../backend/src/employees/payroll-money.ts');
const calculator = load('../../backend/src/employees/attendance-calculator.ts', { './payroll-money': money });
const entry = load('../src/lib/attendanceEntry.ts', { '../../../backend/src/employees/attendance-calculator': calculator });
const draft = (values = {}) => ({ key: 'new-1', date: '2026-10-12', kind: 'work', timeIn: '820', timeOut: '820', reason: '', ...values });

test('compact manual times use AM for Time In and PM for Time Out', () => {
  for (const [value, expectedIn, expectedOut] of [['820', '08:20', '20:20'], ['0820', '08:20', '20:20'], ['1230', '00:30', '12:30'], ['100', '01:00', '13:00'], ['1200', '00:00', '12:00']]) {
    assert.equal(entry.normalizeManualEntryTime(value, 'timeIn'), expectedIn);
    assert.equal(entry.normalizeManualEntryTime(value, 'timeOut'), expectedOut);
  }
  assert.equal(entry.displayManualEntryTime('820', 'timeIn'), '8:20 AM');
  assert.equal(entry.displayManualEntryTime('820', 'timeOut'), '8:20 PM');
});

test('explicit periods and unambiguous 24-hour shorthand override column defaults', () => {
  for (const [value, expected] of [['820 PM', '20:20'], ['820am', '08:20'], [' 0820 pM ', '20:20'], ['1200AM', '00:00'], ['1200PM', '12:00'], ['1320', '13:20'], ['2026', '20:26'], ['0000', '00:00'], ['020', '00:20']]) {
    for (const field of ['timeIn', 'timeOut']) assert.equal(entry.normalizeManualEntryTime(value, field), expected, value);
  }
});

test('colon-bearing 24-hour and explicit times retain their meaning in both columns', () => {
  for (const [value, expected] of [['08:20', '08:20'], ['8:20', '08:20'], ['20:26', '20:26'], ['8:20 AM', '08:20'], ['8:20 PM', '20:20'], ['12:00 AM', '00:00'], ['12:00 PM', '12:00']]) {
    for (const field of ['timeIn', 'timeOut']) assert.equal(entry.normalizeManualEntryTime(value, field), expected);
  }
});

test('invalid or incomplete values remain invalid and are never silently repaired', () => {
  for (const value of ['', '8', '82', '860', '1260', '2400', '82000', '20:26 PM', '1320 PM', '-820', '8.20', '8:20:30']) {
    for (const field of ['timeIn', 'timeOut']) {
      assert.equal(entry.normalizeManualEntryTime(value, field), null, value);
      assert.equal(entry.displayManualEntryTime(value, field), value);
    }
  }
});

test('save, duplicate checks and refresh use canonical punches even before input blur', () => {
  const punches = entry.rowPunches(draft());
  assert.equal(punches.timeIn, '08:20'); assert.equal(punches.timeOut, '20:20');
  const saved = { id: 1, employeeId: 7, date: '2026-10-12', timeIn: '08:20', timeOut: '20:20', hours: 11 };
  assert.equal(entry.entrySessionKey({ employeeId: 7, date: saved.date, ...punches }), entry.entrySessionKey(saved));
  assert.equal(entry.isChanged({ ...draft(), source: saved }), false);
  assert.equal(entry.mergeRows([saved], [saved.date], 7, [{ ...draft(), unconfirmed: punches }]).length, 1);
});

test('saved source records and backend parsing never apply manual column defaults', () => {
  const saved = { id: 1, employeeId: 7, date: '2026-10-12', timeIn: '08:20', timeOut: '08:20', hours: 0 };
  assert.equal(entry.fromRecord(saved).timeOut, '8:20 AM');
  assert.equal(entry.sourcePunches(saved).timeOut, '08:20');
  assert.equal(entry.normalizeEntryTime('820'), null);
  assert.equal(calculator.parseTimeToMinutes('820'), null);
  assert.equal(entry.rowPunches(draft({ kind: 'paid' })).timeIn, 'LEAVE');
  assert.equal(entry.rowPunches(draft({ kind: 'unpaid' })).timeOut, 'UNPAID');
});

test('additional sessions accept explicit afternoon arrivals and morning overnight departures', () => {
  const afternoon = entry.rowPunches(draft({ key: 'new-2', timeIn: '120PM', timeOut: '620PM' }));
  assert.equal(afternoon.timeIn, '13:20'); assert.equal(afternoon.timeOut, '18:20');
  const overnight = entry.rowPunches(draft({ timeIn: '820PM', timeOut: '820AM' }));
  assert.equal(overnight.timeIn, '20:20'); assert.equal(overnight.timeOut, '08:20');
});

test('removing an unsaved session keeps its sibling sessions and unrelated drafts intact', () => {
  const rows = [draft(), draft({ key: 'new-2', timeIn: '', timeOut: '' }), draft({ key: 'new-3', date: '2026-10-13', timeIn: '900', timeOut: '' })];
  const before = JSON.stringify(rows);
  const remaining = entry.removeEntryRow(rows, 'new-2');
  assert.deepEqual(Array.from(remaining, row => row.key), ['new-1', 'new-3']);
  assert.equal(remaining[0], rows[0]); assert.equal(remaining[1], rows[2]);
  assert.equal(JSON.stringify(rows), before);
});

test('removing the last session leaves a clean blank date in the same position', () => {
  const rows = [draft({ key: 'other-before', date: '2026-10-11' }), draft(), draft({ key: 'other-after', date: '2026-10-13' })];
  const remaining = entry.removeEntryRow(rows, 'new-1');
  assert.equal(remaining.length, 3);
  assert.equal(remaining[1].date, '2026-10-12');
  assert.equal(remaining[1].timeIn, ''); assert.equal(remaining[1].timeOut, '');
  assert.equal(remaining[1].source, undefined); assert.equal(entry.isChanged(remaining[1]), false);
  assert.equal(remaining[0], rows[0]); assert.equal(remaining[2], rows[2]);
});

test('a missing removal key never removes an unrelated session', () => {
  const rows = [draft()];
  assert.equal(entry.removeEntryRow(rows, 'missing'), rows);
});

test('reconciling a saved removal retains typed and empty added sessions on other dates', () => {
  const record = { id: 2, employeeId: 7, date: '2026-10-12', timeIn: '13:00', timeOut: '17:00', hours: 4 };
  const drafts = [entry.fromRecord(record), draft({ key: 'new-empty', timeIn: '', timeOut: '' }), draft({ key: 'new-typed', date: '2026-10-13', timeIn: '900', timeOut: '' })];
  const merged = entry.mergeRows([record], ['2026-10-12', '2026-10-13'], 7, drafts, true);
  assert.deepEqual(Array.from(merged, row => row.key), ['saved-2', 'new-empty', 'new-typed']);
  assert.equal(merged[2].timeIn, '900');
  assert.equal(entry.mergeRows([], ['2026-10-12'], 7, [], true)[0].timeIn, '');
});
