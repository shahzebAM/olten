import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function requestHarness(status, result) {
  const exports = {};
  const source = readFileSync(new URL('../src/modules/phase3/api.ts', import.meta.url), 'utf8');
  runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, {
    exports, AbortSignal,
    require: name => name === 'react' ? {} : {getApiAuthHeaders:()=>({Authorization:'Bearer test-session'}),expireApiSession(){}},
    fetch: async () => ({ok:status === 200,status,json:async()=>result}),
  });
  return exports.phase3Request;
}

test('a backend without the requested report route explains the version mismatch', async () => {
  const request = requestHarness(404,{message:'Cannot GET /phase3/books/reports/financial-overview'});
  await assert.rejects(request('/api','Company A','/books/reports/financial-overview'), /connected backend version.*matching backend and database updates/);
});

test('a genuine missing record retains the server explanation', async () => {
  const request = requestHarness(404,{message:'Invoice not found in this workspace.'});
  await assert.rejects(request('/api','Company A','/invoices/missing'), /Invoice not found in this workspace/);
});

test('working report requests retain the server result unchanged', async () => {
  const result={amount:'9999999999999999.99',rows:[]};
  const request = requestHarness(200,result);
  assert.equal(await request('/api','Company A','/books/reports/financial-overview'), result);
});
