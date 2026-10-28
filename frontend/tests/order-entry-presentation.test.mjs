import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Captured from the existing order modules before the responsive presentation
// changes. Preserve handlers, requests, numbering, permissions and financial
// expressions while permitting the new screen-only classes and control labels.
const baseline = {
  CreateOSModule: {
    code: 'ad0488f7ce5132b58857515c30d265eb8305aa04b235e5b27cb6671525995487',
    documentMarker: '{/* FINALIZED PRINT MODAL */}',
    documents: 'f893ea5b36da91308870ed2b442942166cd41d4b565a910823abb9caf30e69e4',
  },
  PurchaseOrdersModule: {
    code: '3c6581434a6ae6d9a3db95035711c7a61bd0ad5e4da6f68ae817b21046dc1870',
    documentMarker: '{/* RECEIVE PO MODAL */}',
    documents: 'd869f3a02223f4818088da9fa7fcac17c7ea9549e70493f33534fe2123b1c08c',
  },
};
const hash = text => createHash('sha256').update(text).digest('hex');

for (const [name, expected] of Object.entries(baseline)) {
  const source = readFileSync(new URL(`../src/modules/${name}.tsx`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const tree = ts.createSourceFile(`${name}.tsx`, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  test(`${name} responsive editor preserves business code and data-bound content`, () => {
    const transformed = ts.transform(tree, [context => {
      const visit = node => {
        if (ts.isImportDeclaration(node) && !node.importClause && node.moduleSpecifier.text === './order-entry-workspace.css') return undefined;
        if (ts.isJsxText(node) && !node.text.trim()) return undefined;
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'span'
          && node.openingElement.attributes.properties.some(attribute => ts.isJsxAttribute(attribute)
            && attribute.name.getText(tree) === 'className' && ts.isStringLiteral(attribute.initializer)
            && attribute.initializer.text === 'order-entry-label')) return undefined;
        if (ts.isJsxAttribute(node) && ['className', 'aria-label', 'aria-pressed', 'role', 'tabIndex'].includes(node.name.getText(tree))) return undefined;
        if (ts.isJsxAttribute(node) && ['id', 'htmlFor'].includes(node.name.getText(tree))
          && ts.isStringLiteral(node.initializer) && node.initializer.text === 'purchase-order-supplier') return undefined;
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }]);
    try {
      const printed = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printFile(transformed.transformed[0]).replace(/[ \t]+$/gm, '');
      assert.equal(hash(printed), expected.code);
    } finally { transformed.dispose(); }
  });

  test(`${name} document previews, print markup and document actions remain unchanged`, () => {
    const start = source.indexOf(expected.documentMarker);
    assert.notEqual(start, -1);
    assert.equal(hash(source.slice(start)), expected.documents);
  });
}
