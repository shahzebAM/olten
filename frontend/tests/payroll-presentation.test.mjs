import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/payroll-ui-baseline.json', import.meta.url), 'utf8'));
const approved = JSON.parse(readFileSync(new URL('./fixtures/payroll-excel-approval.json', import.meta.url), 'utf8'));
const restDayApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-rest-day-approval.json', import.meta.url), 'utf8'));
const workflowApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-workflow-approval.json', import.meta.url), 'utf8'));
const biometricsApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-biometrics-approval.json', import.meta.url), 'utf8'));
const sameDayApproved = JSON.parse(readFileSync(new URL('./fixtures/payroll-same-day-breaks-approval.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/modules/PayrollModule.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tree = ts.createSourceFile('PayrollModule.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const hash = text => createHash('sha256').update(text).digest('hex');

test('approved rest-day payroll changes chain to the retained Excel and UI baselines', () => {
  assert.equal(approved.previousNonClassCodeSHA256, baseline.nonClassCodeSHA256);
  assert.deepEqual(approved.scope, ['fixed-daily-break', 'decimal-money', 'payroll-breakdown']);
  assert.equal(restDayApproved.parentCommit, '9cde900d7d5e062b234bceb9c01df6935ff9aa71');
  assert.equal(restDayApproved.previousApproval, 'payroll-excel-approval.json');
  assert.equal(restDayApproved.previousNonClassCodeSHA256, approved.nonClassCodeSHA256);
  assert.deepEqual(restDayApproved.scope, ['scheduled-rest-day-pay', 'pay-profile-defaults-and-schedule-warning', 'payroll-rest-day-preview-and-exports']);
  assert.equal(workflowApproved.parentCommit, 'dbe83568073b9982d5e94b04d1d7041f2b6d5682');
  assert.equal(workflowApproved.previousApproval, 'payroll-rest-day-approval.json');
  assert.equal(workflowApproved.previousNonClassCodeSHA256, restDayApproved.nonClassCodeSHA256);
  assert.deepEqual(workflowApproved.scope, ['employee-details-pay-setup', 'company-payroll-defaults', 'readonly-payroll-computation']);
  assert.equal(biometricsApproved.parentCommit, 'f6a3d740b99c3d389f8c3be0b11a62d361eb649f');
  assert.equal(biometricsApproved.previousApproval, 'payroll-workflow-approval.json');
  assert.equal(biometricsApproved.previousNonClassCodeSHA256, workflowApproved.nonClassCodeSHA256);
  assert.deepEqual(biometricsApproved.scope, ['biometrics-attendance-import']);
  assert.equal(sameDayApproved.parentCommit, '14e1746c1d723d9c21c385ae785aee4ae6bb5ccd');
  assert.equal(sameDayApproved.previousApproval, 'payroll-biometrics-approval.json');
  assert.equal(sameDayApproved.previousNonClassCodeSHA256, biometricsApproved.nonClassCodeSHA256);
  assert.deepEqual(sameDayApproved.scope, ['same-day-session-break-accounting', 'payroll-break-explanation']);
  const transformed = ts.transform(tree, [context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && !node.importClause && node.moduleSpecifier.text === './payroll-workspace.css') return undefined;
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') return undefined;
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  try {
    assert.equal(hash(printer.printFile(transformed.transformed[0])), sameDayApproved.nonClassCodeSHA256);
  } finally { transformed.dispose(); }
});

test('payslips include the approved rest-day snapshot breakdown and summary print markup is unchanged', () => {
  const templates = {};
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const id = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'id');
      if (id && ts.isStringLiteral(id.initializer) && ['payslip-print-area', 'report-print-area'].includes(id.initializer.text)) {
        templates[id.initializer.text] = hash(printer.printNode(ts.EmitHint.Unspecified, node, tree));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(approved.printTemplatesSHA256['report-print-area'], baseline.printTemplatesSHA256['report-print-area']);
  assert.deepEqual(restDayApproved.previousPrintTemplatesSHA256, approved.printTemplatesSHA256);
  assert.equal(restDayApproved.printTemplatesSHA256['report-print-area'], baseline.printTemplatesSHA256['report-print-area']);
  assert.deepEqual(templates, restDayApproved.printTemplatesSHA256);
  assert.deepEqual(templates, workflowApproved.printTemplatesSHA256);
  assert.deepEqual(templates, biometricsApproved.printTemplatesSHA256);
  assert.deepEqual(templates, sameDayApproved.printTemplatesSHA256);
});

test('payroll palette is opt-in and its stylesheet applies only to screen media', () => {
  const css = readFileSync(new URL('../src/modules/payroll-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /^\/\*[\s\S]*?\*\/\s*@media screen\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|:root|\*)\s*[{,]/);
  assert.doesNotMatch(css, /#(?:payslip|report)-print-area/);
  assert.match(css, /--payroll-green:\s*#218409/);
  assert.match(css, /background:\s*#282828/);
});
