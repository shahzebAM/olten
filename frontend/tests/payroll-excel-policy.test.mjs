import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const load = (file, dependencies = {}) => {
  const exports = {};
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return exports;
};
const money = load('../../backend/src/employees/payroll-money.ts');
const calculator = load('../../backend/src/employees/attendance-calculator.ts', { './payroll-money': money });

test('browser payroll credits an already unpaid daytime gap across the employee’s sessions', () => {
  const rows = [
    { id: 1, employeeId: 1, date: '2026-10-12', timeIn: '08:30', timeOut: '11:00' },
    { id: 2, employeeId: 1, date: '2026-10-12', timeIn: '12:00', timeOut: '17:30' },
  ];
  const result = calculator.calculateAttendancePayroll(rows, { ...calculator.APP_ATTENDANCE_POLICY, employeeId: 1, startDate: '2026-10-12', endDate: '2026-10-12', shiftStart: '08:30', shiftEnd: '17:30', lunchStart: '12:00', lunchEnd: '13:00', daysWorked: 1, basicSalary: 500, ratePerDay: 500 });
  assert.equal(result.totalMinutes, 480);
  assert.equal(result.lunchDeductionMinutes, 0);
  assert.equal(result.grossPay, 500);
});

test('a zero-break exception remains session-specific and a continuous afternoon shift keeps its default', () => {
  assert.equal(calculator.calculateAttendanceMetrics({ ...calculator.APP_ATTENDANCE_POLICY, timeIn: '13:01', timeOut: '18:20', lunchOverrideMinutes: 0 }).netMinutes, 319);
  assert.equal(calculator.calculateAttendanceMetrics({ ...calculator.APP_ATTENDANCE_POLICY, timeIn: '14:00', timeOut: '22:00' }).lunchDeductionMinutes, 60);
});

test('browser and API share the approved fixed daily break and exact money calculations', () => {
  const result = calculator.calculateAttendanceMetrics({
    ...calculator.APP_ATTENDANCE_POLICY, timeIn: '12:48', timeOut: '19:48',
  });
  assert.equal(result.grossMinutes, 420);
  assert.equal(result.lunchDeductionMinutes, 60);
  assert.equal(result.netMinutes, 360);
  assert.equal(money.calculatePayrollAmounts({ basicSalary: 9060, daysWorked: 12, ratePerDay: 755, overtimeMinutes: 1104, undertimeMinutes: 0 }).otPay, 2170.63);
  assert.equal(money.multiplyPayrollCents(330, 0.35), 116);
});

test('all existing application calculation paths opt into the same lunch policy', () => {
  const frontend = readFileSync(new URL('../src/modules/PayrollModule.tsx', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../../backend/src/employees/employees.service.ts', import.meta.url), 'utf8');
  assert.equal([...frontend.matchAll(/\.\.\.APP_ATTENDANCE_POLICY/g)].length, 3);
  // The fourth backend use fingerprints the selected policy against stale previews.
  assert.equal([...service.matchAll(/\.\.\.APP_ATTENDANCE_POLICY/g)].length, 4);
  assert.match(service, /calculationVersion: PAYROLL_CALCULATION_VERSION/);
  assert.match(frontend, /Before Unpaid Breaks:/);
  assert.match(frontend, /Unpaid Breaks:/);
  assert.match(frontend, /!!rec\.attendanceSummary\?\.roundingAdjustment/);
});

test('rounded currency components and the explicit adjustment reconcile to gross', () => {
  const result = calculator.calculateAttendancePayroll([
    { id: 1, employeeId: 1, date: '2026-10-12', timeIn: '08:00', timeOut: '16:00' },
  ], { ...calculator.APP_ATTENDANCE_POLICY, employeeId: 1, startDate: '2026-10-11', endDate: '2026-10-25', daysWorked: 1, basicSalary: 755, ratePerDay: 755 });
  assert.equal(result.undertimeDeduction, 94.38);
  assert.equal(result.roundingAdjustment, 0.01);
  assert.equal(result.grossPay, 660.63);
  assert.equal(money.toPayrollMoneyCents(result.basicSalary) - money.toPayrollMoneyCents(result.undertimeDeduction) + money.toPayrollMoneyCents(result.roundingAdjustment), money.toPayrollMoneyCents(result.grossPay));
});
