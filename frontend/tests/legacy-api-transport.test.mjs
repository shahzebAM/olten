import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const modules = [
  'CustomerModule', 'SupplierModule', 'MasterInventory', 'CreateOSModule',
  'OrderSlipsModule', 'PurchaseOrdersModule', 'ProductQRModule', 'SalesOrderModule',
];
const propertyName = (property, ast) => property.name?.getText(ast).replace(/['"]/g, '');

for (const name of modules) {
  test(`${name} sends the active session and company on every internal API request`, () => {
    const file = `${name}.tsx`;
    const text = readFileSync(new URL(`../src/modules/${file}`, import.meta.url), 'utf8');
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const requests = [];
    const declarations = [];
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'headers') declarations.push(node);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
        const target = node.arguments[0]?.getText(ast) || '';
        if (target.includes('API_BASE_URL') || ['url', 'endpoint'].includes(target)) requests.push(node);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(requests.length > 0, `${file}: expected internal API requests`);
    for (const request of requests) {
      const location = `${file}:${ast.getLineAndCharacterOfPosition(request.getStart(ast)).line + 1}`;
      const options = request.arguments[1];
      assert.ok(options && ts.isObjectLiteralExpression(options), `${location}: explicit request options required`);
      const headerProperty = options.properties.find((property) => propertyName(property, ast) === 'headers');
      assert.ok(headerProperty, `${location}: headers required`);
      let headers = ts.isPropertyAssignment(headerProperty) ? headerProperty.initializer : headerProperty.name;
      if (headers && ts.isIdentifier(headers)) {
        const declaration = declarations.filter((declaration) => {
          let scope = declaration.parent;
          while (scope && !ts.isBlock(scope)) scope = scope.parent;
          return declaration.pos < request.pos && scope && scope.pos <= request.pos && scope.end >= request.end;
        }).at(-1);
        headers = declaration?.initializer;
      }
      assert.ok(headers && ts.isObjectLiteralExpression(headers), `${location}: inspect indirect headers`);
      assert.ok(headers.properties.some((property) =>
        ts.isSpreadAssignment(property) && ts.isCallExpression(property.expression)
        && property.expression.expression.getText(ast) === 'getApiAuthHeaders'), `${location}: session bearer headers missing`);
      const company = headers.properties.find((property) => propertyName(property, ast) === 'x-company');
      assert.ok(company && ts.isPropertyAssignment(company), `${location}: company header missing`);
      assert.equal(company.initializer.getText(ast), 'selectedCompany', `${location}: company must match selected workspace`);
    }
  });
}

function qrSyncHandler(name, authorized) {
  const source = readFileSync(new URL('../src/modules/ProductQRModule.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('ProductQRModule.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) handler = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler, `Missing QR handler ${name}`);
  const compiled = ts.transpileModule(`exports.handler = ${handler.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const calls = [];
  const notices = [];
  let refreshes = 0;
  runInNewContext(compiled, {
    exports, pendingCount: 1, selectedCompany: 'Transport QA', API_BASE_URL: 'http://isolated-test',
    loginUsername: 'admin', adminPasswordInput: '',
    getApiAuthHeaders: () => ({ Authorization: 'Bearer synthetic-test-session' }),
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: authorized }; },
    fetchProducts: async () => { refreshes++; },
    showToast: (message, type) => notices.push({ message, type }),
    setIsLoading: () => {}, setActiveTab: () => {}, setIsPasswordModalOpen: () => {}, setAdminPasswordInput: () => {},
  });
  return { run: exports.handler, calls, notices, refreshes: () => refreshes };
}

for (const name of ['handleGenerateClick', 'handlePasswordSubmit']) {
  test(`${name} does not report QR sync success when the server rejects the session`, async () => {
    const handler = qrSyncHandler(name, false);
    await handler.run({ preventDefault() {} });
    assert.equal(handler.calls.length, 1);
    assert.equal(handler.calls[0].options.headers.Authorization, 'Bearer synthetic-test-session');
    assert.equal(handler.calls[0].options.headers['x-company'], 'Transport QA');
    assert.equal(handler.refreshes(), 0);
    assert.equal(handler.notices.length, 1);
    assert.equal(handler.notices[0].type, 'error');
  });
}

test('successful QR sync still refreshes products and confirms the saved action', async () => {
  const handler = qrSyncHandler('handleGenerateClick', true);
  await handler.run();
  assert.equal(handler.refreshes(), 1);
  assert.equal(handler.notices.length, 1);
  assert.equal(handler.notices[0].type, 'success');
  assert.equal(handler.calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(handler.calls[0].options.body), { company: 'Transport QA' });
});
