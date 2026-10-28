import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/payroll-ui-baseline.json', import.meta.url), 'utf8'));
const source = readFileSync(new URL('../src/modules/PayrollModule.tsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const tree = ts.createSourceFile('PayrollModule.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const hash = text => createHash('sha256').update(text).digest('hex');

test('authorized payroll styling preserves every non-class code node against the pre-redesign baseline', () => {
  const transformed = ts.transform(tree, [context => {
    const visit = node => {
      if (ts.isImportDeclaration(node) && !node.importClause && node.moduleSpecifier.text === './payroll-workspace.css') return undefined;
      if (ts.isJsxAttribute(node) && node.name.getText(tree) === 'className') return undefined;
      return ts.visitEachChild(node, visit, context);
    };
    return node => ts.visitNode(node, visit);
  }]);
  try {
    assert.equal(hash(printer.printFile(transformed.transformed[0])), baseline.nonClassCodeSHA256);
  } finally { transformed.dispose(); }
});

test('payslip and summary print/export markup remain exactly unchanged', () => {
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
  assert.deepEqual(templates, baseline.printTemplatesSHA256);
});

test('payroll palette is opt-in and its stylesheet applies only to screen media', () => {
  const css = readFileSync(new URL('../src/modules/payroll-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /^\/\*[\s\S]*?\*\/\s*@media screen\s*\{/);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|:root|\*)\s*[{,]/);
  assert.doesNotMatch(css, /#(?:payslip|report)-print-area/);
  assert.match(css, /--payroll-green:\s*#218409/);
  assert.match(css, /background:\s*#282828/);
});
