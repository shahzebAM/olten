import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);

test('workspace shell provides accessible navigation, company context and a skip target', () => {
  const source = readFileSync(new URL('../src/components/ErpShell.tsx', import.meta.url), 'utf8');
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require });
  const html = renderToStaticMarkup(React.createElement(exports.default, { company: 'Company A', title: 'Books', username: 'demo', navigation: React.createElement('nav', null, 'Authorized modules'), onWorkspace() {}, onChangeCompany() {}, onLogout() {} }, React.createElement('p', null, 'Saved records')));
  assert.match(html, /href="#erp-main"/);
  assert.match(html, /id="erp-main"/);
  assert.match(html, /aria-label="Workspace navigation"/);
  assert.match(html, /aria-label="Collapse navigation" aria-expanded="true"/);
  assert.match(html, /aria-label="Open navigation" aria-controls="erp-navigation" aria-expanded="false"/);
  for (const text of ['Company A', 'Authorized modules', 'Saved records', 'Switch company', 'Sign out']) assert.ok(html.includes(text));
});

test('payroll route remains outside the new shell and its opt-in screen styles', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'ErpShell') {
      let parent = node.parent;
      while (parent && !ts.isConditionalExpression(parent)) parent = parent.parent;
      assert.ok(parent, 'The shell must have an explicit route boundary');
      assert.match(parent.condition.getText(tree), /activeModule\s*!==\s*'payroll'/);
      assert.equal(parent.whenFalse.getText(tree), 'renderModule()');
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found);
  const css = readFileSync(new URL('../src/erp.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|:root|\*)\s*[{,]/);
});

test('direct warehouse and delivery navigation remounts the requested initial view', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(source, /FulfillmentModule key=\{\[selectedCompany, activeModule\]\.join\('-'\)\}/);
  assert.match(source, /standalone=\{activeModule === 'ai_docs'\}/);
});

test('approved rest-day calculator and profile changes preserve the other protected baselines', () => {
  const baseline = JSON.parse(readFileSync(new URL('./fixtures/payroll-protected-hashes.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  const approved = JSON.parse(readFileSync(new URL('./fixtures/payroll-excel-approval.json', import.meta.url), 'utf8'));
  const restDayApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-rest-day-approval.json', import.meta.url), 'utf8'));
  const workflowApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-workflow-approval.json', import.meta.url), 'utf8'));
  const sameDayApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-same-day-breaks-approval.json', import.meta.url), 'utf8'));
  assert.equal(restDayApproved.parentCommit, '9cde900d7d5e062b234bceb9c01df6935ff9aa71');
  assert.equal(restDayApproved.previousApproval, 'payroll-excel-approval.json');
  assert.equal(baseline.length, 7);
  for (const entry of baseline) {
    const content = readFileSync(new URL(`../../${entry.File.replaceAll('\\', '/')}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    if (entry.ApprovedAllocationModels) {
      assert.deepEqual(entry.ApprovedAllocationModels, ['FinanceDocument', 'FinancePayment', 'FinanceAllocation', 'LedgerAccount', 'LedgerEntry', 'CashAccountSetting', 'CashFlowClassification']);
      // Shared menu settings add only one model and this exact optional Company relation.
      // Removing those additions retains the original 8eb736a protected schema hash.
      assert.deepEqual(entry.ApprovedPresentationModels, ['CompanyNavigation']);
      assert.match(content, /^  navigation CompanyNavigation\?$/m);
      assert.deepEqual(workflowApproved.addedSettingsField, { model: 'Settings', name: 'payrollDefaults', type: 'Json?' });
      assert.match(content, /model Settings \{[^}]*\n  payrollDefaults Json\?\n/);
      assert.equal([...content.matchAll(/^  payrollDefaults Json\?$/gm)].length, 1);
      const protectedSchema = [...entry.ApprovedAllocationModels, ...entry.ApprovedPresentationModels].reduce((text, name) => text.replace(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`, 'g'), ''), content).replace(/^  navigation CompanyNavigation\?\n/m, '').replace(/^  payrollDefaults Json\?\n/m, '').replace(/\n{3,}/g, '\n\n');
      assert.equal(createHash('sha256').update(protectedSchema).digest('hex').toUpperCase(), entry.ProtectedSchemaSHA256, 'All schema models outside approved finance metadata and shared menu settings remain unchanged');
    } else if (entry.File.replaceAll('\\', '/') === 'backend/src/employees/attendance-calculator.ts') {
      assert.equal(approved.previousCalculatorSHA256, entry.SHA256);
      assert.equal(restDayApproved.previousCalculatorSHA256, approved.calculatorSHA256);
      assert.equal(sameDayApproved.previousCalculatorSHA256, restDayApproved.calculatorSHA256);
      assert.deepEqual(sameDayApproved.scope, ['same-day-session-break-accounting', 'payroll-break-explanation']);
      assert.equal(createHash('sha256').update(content).digest('hex').toUpperCase(), sameDayApproved.calculatorSHA256, entry.File);
    } else if (entry.File.replaceAll('\\', '/') === 'frontend/src/modules/PayrollProfileEditor.tsx') {
      assert.equal(restDayApproved.previousProfileEditorSHA256, entry.SHA256);
      assert.equal(workflowApproved.previousProfileEditorSHA256, restDayApproved.profileEditorSHA256);
      assert.equal(createHash('sha256').update(content).digest('hex').toUpperCase(), workflowApproved.profileEditorSHA256, entry.File);
    } else if (entry.File.replaceAll('\\', '/') === 'backend/src/employees/payroll-profile.ts') {
      assert.equal(workflowApproved.previousProfileHelpersSHA256, entry.SHA256);
      assert.equal(createHash('sha256').update(content).digest('hex').toUpperCase(), workflowApproved.profileHelpersSHA256, entry.File);
      const basisResolver = content.slice(content.indexOf('export function resolvePayrollBasis('));
      assert.equal(createHash('sha256').update(basisResolver).digest('hex'), workflowApproved.basisResolverSHA256, 'Existing payroll basis formulas remain unchanged');
    } else if (entry.File.replaceAll('\\', '/') === 'frontend/src/modules/AttendanceEntryGrid.tsx') {
      const previousCopy = 'Enter a cutoff, then save once. Hours are confirmed by the existing attendance service.';
      const updatedCopy = 'Enter a cutoff, then save once. Same-day sessions share the automatic break allowance. Hours are confirmed by the attendance service.';
      assert.ok(content.includes(updatedCopy));
      assert.equal(createHash('sha256').update(content.replace(updatedCopy, previousCopy)).digest('hex').toUpperCase(), entry.SHA256, 'Attendance entry behavior remains unchanged; only its break explanation changed');
    } else assert.equal(createHash('sha256').update(content).digest('hex').toUpperCase(), entry.SHA256, entry.File);
  }
});

test('the QuickBooks-inspired palette retains readable primary actions and hides the closed mobile menu', () => {
  const css = readFileSync(new URL('../src/erp.css', import.meta.url), 'utf8');
  assert.match(css, /--erp-green:\s*#218409/);
  assert.match(css, /background: #282828/);
  assert.match(css, /\.erp-sidebar \{ width: 244px; visibility: hidden/);
  const luminance = hex => {
    const channels = hex.match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  assert.ok((luminance('ffffff') + 0.05) / (luminance('218409') + 0.05) >= 4.5);
});
