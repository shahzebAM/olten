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
  runInNewContext(compiled, { exports, require: name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    assert.ok(['react', 'react/jsx-runtime'].includes(name), `Unexpected dependency ${name}`);
    return require(name);
  } });
  return exports;
};
const money = load('../../backend/src/employees/payroll-money.ts');
const calculator = load('../../backend/src/employees/attendance-calculator.ts', { './payroll-money': money });
const profiles = load('../../backend/src/employees/payroll-profile.ts', { './attendance-calculator': calculator });
const helpers = load('../src/lib/employeePaySetup.ts', { '../../../backend/src/employees/payroll-profile': profiles });
const fields = load('../src/modules/PayrollProfileEditor.tsx', { '../../../backend/src/employees/payroll-profile': profiles, '../lib/employeePaySetup': helpers });
const CompanySetup = load('../src/modules/CompanyPayrollSetup.tsx').default;
const defaults = profiles.validatePayrollDefaults(null);
const plain = value => JSON.parse(JSON.stringify(value));
const daily = { version: 1, basis: 'DAILY', dailyRate: 755, paidDayBasis: 'SCHEDULED', workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'CUTOFF_NET' };
const renderFields = (draft, extra = {}) => renderToStaticMarkup(React.createElement(fields.default, {
  value: draft, baseRate: '9815', companyDefaults: defaults, cutoffStart: '2026-10-11', cutoffEnd: '2026-10-25',
  onChange() {}, onBaseRateChange() {}, ...extra,
}));

test('new employees enter one daily wage and inherit company rules without a second salary', () => {
  const draft = helpers.createPaySetupDraft();
  assert.equal(draft.rulesSource, 'COMPANY');
  assert.equal(draft.paidDayBasis, 'SCHEDULED');
  assert.equal(draft.dailyRate, '');
  const html = renderFields(draft);
  assert.match(html, /aria-label="Daily rate"/);
  assert.doesNotMatch(html, /aria-label="Cutoff salary"/);
  assert.doesNotMatch(html, /<button|<form/);
  draft.dailyRate = '755';
  const payload = helpers.buildEmployeePaySetup(draft, '', null, defaults);
  assert.equal(payload.baseRate, 0);
  assert.equal(payload.payrollProfile.dailyRate, 755);
  assert.equal(payload.payrollProfile.rulesSource, 'COMPANY');
  assert.equal(payload.payrollProfile.overtimeBasis, 'CUTOFF_NET');
});

test('saved daily wages populate automatically and existing salary metadata is preserved', () => {
  const draft = helpers.createPaySetupDraft(daily);
  assert.equal(draft.dailyRate, '755');
  assert.equal(draft.rulesSource, 'EMPLOYEE');
  assert.match(renderFields(draft), /aria-label="Daily rate"[^>]*value="755"/);
  assert.equal(helpers.buildEmployeePaySetup(draft, '9815', 9815, defaults).baseRate, 9815);
  assert.equal(daily.rulesSource, undefined);
});

test('legacy fixed salary profiles remain individual agreements with their exact divisor', () => {
  const original = { version: 1, basis: 'CUTOFF', referenceDays: 14, paidDayBasis: 'FIXED', fixedPaidDays: 14, workingWeekdays: [1, 2, 3, 4, 5, 6], overtimeBasis: 'DAILY' };
  const draft = helpers.createPaySetupDraft(original);
  const payload = helpers.buildEmployeePaySetup(draft, '9815', 9815, null);
  assert.equal(payload.baseRate, 9815);
  assert.equal(payload.payrollProfile.referenceDays, 14);
  assert.equal(payload.payrollProfile.fixedPaidDays, 14);
  assert.equal(payload.payrollProfile.overtimeBasis, 'DAILY');
  assert.equal(payload.payrollProfile.rulesSource, 'EMPLOYEE');
  assert.equal(original.rulesSource, undefined);
  assert.throws(() => helpers.buildEmployeePaySetup(draft, '', 9815, defaults), /positive agreed cutoff salary/);
});

test('company default failures block inheritance and invalid wages never get inferred', () => {
  const draft = { ...helpers.createPaySetupDraft(), dailyRate: '755' };
  assert.throws(() => helpers.buildEmployeePaySetup(draft, '', null, null), /Load the company payroll defaults/);
  assert.throws(() => helpers.profileFromPaySetup({ ...draft, dailyRate: '' }, defaults), /positive daily rate/);
  assert.throws(() => helpers.profileFromPaySetup({ ...draft, dailyRate: '1.005' }, defaults), /positive daily rate/);
  assert.throws(() => helpers.effectiveEmployeePayProfile({ ...daily, rulesSource: 'COMPANY' }, null), /not loaded/);
  assert.match(renderFields(draft, { companyDefaults: null, defaultsError: 'Connection failed' }), /Connection failed/);
});

test('company updates affect inherited rules and preserve wage and individual agreements', () => {
  const inherited = { ...daily, rulesSource: 'COMPANY' };
  const changed = { version: 1, workingWeekdays: [0, 1, 2, 3, 4], overtimeBasis: 'DAILY' };
  const before = JSON.stringify(inherited);
  const effective = helpers.effectiveEmployeePayProfile(inherited, changed);
  assert.equal(effective.dailyRate, 755);
  assert.equal(effective.paidDayBasis, 'SCHEDULED');
  assert.deepEqual(plain(effective.workingWeekdays), [0, 1, 2, 3, 4]);
  assert.equal(effective.overtimeBasis, 'DAILY');
  assert.equal(JSON.stringify(inherited), before);
  const individual = helpers.effectiveEmployeePayProfile(daily, changed);
  assert.deepEqual(plain(individual.workingWeekdays), [1, 2, 3, 4, 5, 6]);
  assert.equal(individual.overtimeBasis, 'CUTOFF_NET');
});

test('normal payroll shows a saved read-only summary with no wage or policy controls', () => {
  const html = renderToStaticMarkup(React.createElement(fields.SavedEmployeePaySetup, {
    employee: { id: 1, company: 'Example', baseRate: 9815, payrollProfile: daily }, effectiveProfile: daily,
  }));
  assert.match(html, /Agreed daily rate: ₱755\.00/);
  assert.match(html, /Loaded automatically from Employee Details/);
  assert.match(html, /read-only while computing payroll/);
  assert.doesNotMatch(html, /<input|<select|<textarea|<button|<form/);
  const missing = renderToStaticMarkup(React.createElement(fields.SavedEmployeePaySetup, { employee: { id: 1, company: 'Example', baseRate: 9815 } }));
  assert.match(missing, /pay setup is required/);
});

test('company setup describes inheritance and disables save while defaults cannot load', () => {
  const html = renderToStaticMarkup(React.createElement(CompanySetup, {
    company: 'Example', value: defaults, configured: false, loading: false, saving: false, dirty: false, error: 'Connection failed',
    inheritedCount: 2, individualCount: 3, onChange() {}, onSave() {}, onRetry() {}, onReset() {},
  }));
  assert.match(html, /2 using company defaults · 3 with existing individual rules/);
  assert.match(html, /Existing individual agreements keep their saved rules/);
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /role="alert"/);
});

test('employee registration and details share atomic saving and normal compute has no editor', () => {
  const source = readFileSync(new URL('../src/modules/PayrollModule.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/<PayrollProfileFields\b/g) ?? []).length, 2);
  assert.match(source, /savedPaySetup = buildEmployeePaySetup\(paySetup, formData\.baseRate, existingBaseRate, companyDefaults\)/);
  assert.match(source, /\.\.\.savedPaySetup, dateOfBirth/);
  assert.match(source, /<SavedEmployeePaySetup employee=\{activeEmployee\} effectiveProfile=\{summary\?\.payrollProfile\}/);
  assert.doesNotMatch(source, /profileDirty|profileBusy|profileSaved|<PayrollProfileEditor/);
  assert.match(source, /effectiveEmployeePayProfile\(emp\.payrollProfile, companyDefaults\)/);
  assert.doesNotMatch(source, /daysWorked: basis\?\.paidDays \?\? 14/);
  assert.match(source, /setEmployees\(current => current\.map\(employee => employee\.id === result\.employee\.id/);
  assert.match(source, /Discard unsaved employee details and pay setup/);
  assert.match(source, /return \(\) => controller\.abort\(\)/);
  assert.match(source, /scope !== workspaceVersion\.current/);
  assert.match(source, /workspaceVersion\.current \+= 1;\s*setIsSaving\(false\)/);
  const component = readFileSync(new URL('../src/modules/PayrollProfileEditor.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(component, /fetch\(|API_BASE_URL|Save Pay Profile/);
});
