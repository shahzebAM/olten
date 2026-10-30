import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const load = (file, dependencies = {}) => {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(compiled, {
    exports, setTimeout, clearTimeout,
    require: name => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      assert.ok(['react', 'react/jsx-runtime'].includes(name), `Unexpected dependency ${name}`);
      return require(name);
    },
  });
  return exports;
};
const money = load('../../backend/src/employees/payroll-money.ts');
const calculator = load('../../backend/src/employees/attendance-calculator.ts', { './payroll-money': money });
const profileHelpers = load('../../backend/src/employees/payroll-profile.ts', { './attendance-calculator': calculator });
const paySetupHelpers = load('../src/lib/employeePaySetup.ts', { '../../../backend/src/employees/payroll-profile': profileHelpers });
const ProfileEditor = load('../src/modules/PayrollProfileEditor.tsx', {
  '../../../backend/src/employees/payroll-profile': profileHelpers,
  '../lib/employeePaySetup': paySetupHelpers,
}).default;
const employee = { id: 1, company: 'Example', baseRate: 9815, payrollProfile: null };
const renderProfile = patch => renderToStaticMarkup(React.createElement(ProfileEditor, {
  value: paySetupHelpers.createPaySetupDraft(patch?.payrollProfile ?? employee.payrollProfile),
  baseRate: String(employee.baseRate), companyDefaults: profileHelpers.validatePayrollDefaults(null),
  cutoffStart: '2026-10-11', cutoffEnd: '2026-10-25',
  onChange() {}, onBaseRateChange() {},
}));
const text = html => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');

test('new pay profiles require an agreed daily rate and use scheduled cutoff days', () => {
  const html = renderProfile();
  assert.match(html, /value="DAILY" selected=""/);
  assert.match(html, /value="COMPANY" selected=""/);
  const dailyRateInput = html.match(/<input\b[^>]*aria-label="Daily rate"[^>]*>/)?.[0];
  assert.ok(dailyRateInput);
  assert.match(dailyRateInput, /value=""/);
  assert.doesNotMatch(dailyRateInput, /value="755"/);
  assert.match(text(html), /save once with employee details/);
});

test('fixed profiles remain fixed and visibly identify a divisor/calendar mismatch', () => {
  const payrollProfile = { version: 1, basis: 'CUTOFF', referenceDays: 14, paidDayBasis: 'FIXED', fixedPaidDays: 14, workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'CUTOFF_NET' };
  const before = JSON.stringify(payrollProfile);
  const html = renderProfile({ payrollProfile });
  assert.match(html, /value="CUTOFF" selected=""/);
  assert.match(text(html), /14 required paid days/);
  assert.match(text(html), /₱701\.07 per day/);
  assert.match(text(html), /requires 14 paid days, while this cutoff has 12 scheduled working days/);
  assert.match(html, /<details open=""/);
  assert.match(text(html), /Review fixed paid days/);
  assert.match(html, /role="alert"/);
  assert.match(html, /aria-label="Working Sun"/);
  assert.equal(JSON.stringify(payrollProfile), before);
});

test('the agreed daily profile derives 12 days and preserves the daily rate', () => {
  const payrollProfile = { version: 1, basis: 'DAILY', dailyRate: 755, paidDayBasis: 'SCHEDULED', workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'CUTOFF_NET' };
  const html = renderProfile({ payrollProfile });
  assert.match(text(html), /12 required paid days/);
  assert.match(text(html), /96 required hours/);
  assert.match(text(html), /₱755\.00 per day/);
  assert.match(text(html), /₱9060\.00 basic pay/);
  assert.doesNotMatch(text(html), /This fixed profile requires/);
  assert.doesNotMatch(text(html), /Review fixed paid days/);
});

test('browser calculation keeps rest-day work separate from ordinary cutoff overtime', () => {
  const rows = [
    { id: 1, employeeId: 1, date: '2026-10-12', timeIn: '08:00', timeOut: '17:00' },
    { id: 2, employeeId: 1, date: '2026-10-18', timeIn: '07:42', timeOut: '20:08' },
  ];
  const result = calculator.calculateAttendancePayroll(rows, {
    ...calculator.APP_ATTENDANCE_POLICY, employeeId: 1, startDate: '2026-10-11', endDate: '2026-10-25',
    daysWorked: 1, basicSalary: 755, ratePerDay: 755, workingWeekdays: [1, 2, 3, 4, 5, 6],
  });
  assert.equal(result.ordinaryMinutes, 480);
  assert.equal(result.restDayMinutes, 686);
  assert.equal(result.overtimeMinutes, 0);
  assert.equal(result.restDayOvertimeMinutes, 206);
  assert.equal(result.totalOvertimeMinutes, 206);
  assert.equal(result.restDayPay, 1529.10);
  assert.equal(result.grossPay, 2284.10);
});

test('a Sunday on the saved working schedule stays ordinary', () => {
  const result = calculator.calculateAttendancePayroll([
    { id: 1, employeeId: 1, date: '2026-10-18', timeIn: '08:00', timeOut: '17:00' },
  ], {
    ...calculator.APP_ATTENDANCE_POLICY, employeeId: 1, startDate: '2026-10-11', endDate: '2026-10-25',
    daysWorked: 1, basicSalary: 755, ratePerDay: 755, workingWeekdays: [0, 1, 2, 3, 4, 5],
  });
  assert.equal(result.ordinaryMinutes, 480);
  assert.equal(result.restDayMinutes, 0);
  assert.equal(result.restDayPay, 0);
  assert.equal(result.grossPay, 755);
});

test('preview, saved payslips and exports consume rest-day snapshot values', () => {
  const source = readFileSync(new URL('../src/modules/PayrollModule.tsx', import.meta.url), 'utf8');
  assert.match(source, /workingWeekdays: effectiveProfile\.workingWeekdays/);
  assert.match(source, /label="Ordinary Cutoff Hours"/);
  assert.match(source, /label="Rest Day OT Hours"/);
  assert.match(source, /summary\.restDayPay \?\? 0/);
  assert.match(source, /rec\.attendanceSummary\?\.restDayPay === undefined \? '-' : payslipMoney\(rec\.attendanceSummary\.restDayPay\)/);
  assert.match(source, /summary\.totalOvertimeMinutes \?\? summary\.overtimeMinutes \+ \(summary\.restDayOvertimeMinutes \?\? 0\)/);
  assert.match(source, /payrollCalculation\.totalOvertimeMinutes \/ 60/);
  assert.match(source, /'Ordinary Cutoff Hours', 'Rest Day Hours', 'Rest Day OT Hours', 'Rest Day Pay'/);
  assert.match(source, /rest-day pay is added automatically/);
});
