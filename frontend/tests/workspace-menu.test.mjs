import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as navigation from '../src/lib/workspaceNavigation.ts';
import * as apiSession from '../src/lib/apiSession.ts';

const { canEditWorkspaceMenu, defaultWorkspaceMenuGroups, getWorkspaceNavigationGroups, moveWorkspaceMenuGroup, moveWorkspaceMenuItem, normalizeWorkspaceMenuGroups, parseWorkspaceMenuGroups, workspaceNavigation } = navigation;
const require = createRequire(import.meta.url);
const allIds = workspaceNavigation.map(item => item.id).sort();
const ids = groups => groups.flatMap(group => group.items).sort();

test('default company menu contains each existing module exactly once with its existing action metadata', () => {
  const groups = defaultWorkspaceMenuGroups();
  assert.deepEqual(ids(groups), allIds);
  assert.equal(new Set(ids(groups)).size, allIds.length);
  assert.ok(groups.some(group => group.title === 'Accounting' && group.items.includes('books')));
  assert.equal(workspaceNavigation.find(item => item.id === 'generate_qr').module, 'qr_system');
  groups[0].items.length = 0;
  assert.deepEqual(ids(defaultWorkspaceMenuGroups()), allIds, 'separate calls do not share mutable arrays');
});

test('stored presentation layouts reject malformed data instead of exposing arbitrary module paths', () => {
  const invalid = [null, {}, [], [{ id: 'g', title: '', items: [] }], [{ id: 'bad id', title: 'Group', items: [] }], [{ id: 'g', title: 'x'.repeat(61), items: [] }], [{ id: 'g', title: 'A\nB', items: [] }], [{ id: 'g', title: 'Group', items: ['arbitrary_admin_endpoint'] }], [{ id: 'g', title: 'Group', items: ['books', 'books'] }], [{ id: 'g', title: 'One', items: ['books'] }, { id: 'g', title: 'Two', items: [] }], [{ id: 'a', title: 'One', items: ['books'] }, { id: 'b', title: 'Two', items: ['books'] }], Array.from({ length: 31 }, (_, index) => ({ id: `group-${index}`, title: 'Group', items: [] }))];
  for (const value of invalid) {
    assert.equal(parseWorkspaceMenuGroups(value), null, JSON.stringify(value));
    assert.deepEqual(ids(normalizeWorkspaceMenuGroups(value)), allIds);
  }
});

test('normalization retains renamed groups and appends modules added after an older saved layout', () => {
  const stored = [{ id: 'finance-team', title: '  Our accounts  ', items: ['books'] }];
  const before = structuredClone(stored);
  const groups = normalizeWorkspaceMenuGroups(stored);
  assert.equal(groups[0].title, 'Our accounts');
  assert.deepEqual(groups[0].items, ['books']);
  assert.deepEqual(ids(groups), allIds);
  assert.deepEqual(stored, before);
  assert.deepEqual(normalizeWorkspaceMenuGroups(groups), groups);
});

test('permissions filter the configured menu after ordering and do not grant hidden modules', () => {
  const layout = [{ id: 'custom', title: 'My team', items: ['books', 'finance', 'customers'] }, { id: 'ops', title: 'Dispatch', items: ['deliveries'] }];
  const groups = getWorkspaceNavigationGroups(layout, ['customers', 'books', 'unknown']);
  assert.deepEqual(groups.map(group => ({ title: group.title, items: group.items.map(item => item.id) })), [{ title: 'My team', items: ['books', 'customers'] }]);
  assert.equal(groups[0].items[0], workspaceNavigation.find(item => item.id === 'books'));
  assert.deepEqual(getWorkspaceNavigationGroups(layout, []), []);
});

test('only an exact Super Admin role enables company menu editing', () => {
  assert.equal(canEditWorkspaceMenu({ role: 'Super Admin' }), true);
  for (const value of [undefined, null, {}, { role: 'Admin', hasUsers: true }, { role: 'Finance' }, { role: 'super admin' }, { role: 'Auditor' }]) assert.equal(canEditWorkspaceMenu(value), false);
});

test('group reorder retains all module IDs and leaves the original draft unchanged', () => {
  const original = defaultWorkspaceMenuGroups();
  const before = structuredClone(original);
  const next = moveWorkspaceMenuGroup(original, 'accounting', 0);
  assert.equal(next[0].id, 'accounting');
  assert.deepEqual(ids(next), allIds);
  assert.deepEqual(original, before);
  assert.deepEqual(moveWorkspaceMenuGroup(original, 'absent', 1), original);
});

test('module moves within and between headings retain every module once and preserve action IDs', () => {
  const original = defaultWorkspaceMenuGroups();
  const reordered = moveWorkspaceMenuItem(original, 'customers', 'sales', 2);
  assert.deepEqual(reordered.find(group => group.id === 'sales').items, ['create_os', 'sales_orders', 'customers']);
  const next = moveWorkspaceMenuItem(reordered, 'customers', 'accounting', 0);
  assert.equal(next.find(group => group.id === 'accounting').items[0], 'customers');
  assert.ok(!next.find(group => group.id === 'sales').items.includes('customers'));
  assert.deepEqual(ids(next), allIds);
  assert.equal(new Set(ids(next)).size, allIds.length);
  assert.deepEqual(original.find(group => group.id === 'sales').items, ['customers', 'create_os', 'sales_orders']);
  assert.deepEqual(moveWorkspaceMenuItem(original, 'books', 'missing', 0), original);
  assert.deepEqual(moveWorkspaceMenuItem(original, 'unknown', 'sales', 0), original);
  assert.deepEqual(moveWorkspaceMenuItem(original, 'books', 'sales', NaN), original);
});

function loadComponent(path, overrides = {}, namedExport = 'default') {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8') + (namedExport === 'default' ? '' : `\nexport { ${namedExport} };`);
  const exports = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, { exports, require: name => name === '../lib/workspaceNavigation' ? navigation : name === '../lib/apiSession' ? apiSession : name in overrides ? overrides[name] : require(name) });
  return exports[namedExport];
}

function keyboardDragContext(activeId) {
  const view = { Document: class {}, HTMLElement: class {} };
  const node = { nodeType: 1, ownerDocument: { defaultView: view } };
  const rows = [
    ['group:sales', 'group', 0, 300, false, 'headings', 0],
    ['item:customers', 'item', 100, 40, false, 'sales-items', 0],
    ['group:purchases', 'group', 320, 200, false, 'headings', 1],
    ['item:suppliers', 'item', 400, 40, false, 'purchases-items', 0],
    ['group:empty', 'group', 540, 100, true, 'headings', 2],
  ];
  const droppableRects = new Map();
  const droppableContainers = new Map();
  for (const [id, kind, top, height, empty, containerId, index] of rows) {
    const left = kind === 'group' ? 0 : 20;
    const rect = { left, top, width: 300 - left, height, right: 300, bottom: top + height };
    droppableRects.set(id, rect);
    droppableContainers.set(id, { id, disabled: false, node: { current: node }, data: { current: { kind, empty, sortable: { containerId, index, items: rows.filter(row => row[5] === containerId).map(row => row[0]) } } } });
  }
  droppableContainers.getEnabled = () => [...droppableContainers.values()];
  const active = droppableContainers.get(activeId);
  return { active, collisionRect: droppableRects.get(activeId), droppableRects, droppableContainers, over: active, scrollableAncestors: [] };
}

test('keyboard heading drag moves to the adjacent heading instead of a nested module', () => {
  const coordinates = loadComponent('../src/components/WorkspaceMenuEditor.tsx', {}, 'workspaceMenuKeyboardCoordinates');
  const context = keyboardDragContext('group:sales');
  let prevented = 0;
  const next = coordinates({ code: 'ArrowDown', preventDefault() { prevented++; } }, { active: 'group:sales', currentCoordinates: { x: 0, y: 0 }, context });
  assert.equal(next.x, 0);
  assert.equal(next.y, 220, 'sortable bottom alignment uses the next heading, despite nearer child rectangles');
  assert.equal(prevented, 1);
  assert.equal(context.droppableRects.size, 5, 'target filtering never mutates shared DnD measurements');
  const previousContext = keyboardDragContext('group:purchases');
  const previous = coordinates({ code: 'ArrowUp', preventDefault() {} }, { active: 'group:purchases', currentCoordinates: { x: 0, y: 320 }, context: previousContext });
  assert.equal(previous.x, 0);
  assert.equal(previous.y, 0);
});

test('keyboard module drag crosses headings through modules and can target an empty heading', () => {
  const coordinates = loadComponent('../src/components/WorkspaceMenuEditor.tsx', {}, 'workspaceMenuKeyboardCoordinates');
  const context = keyboardDragContext('item:customers');
  const next = coordinates({ code: 'ArrowDown', preventDefault() {} }, { active: 'item:customers', currentCoordinates: { x: 20, y: 100 }, context });
  assert.equal(next.x, 20);
  assert.equal(next.y, 400, 'populated parent headings do not intercept the next module target');
  const lastContext = keyboardDragContext('item:suppliers');
  const emptyHeading = coordinates({ code: 'ArrowDown', preventDefault() {} }, { active: 'item:suppliers', currentCoordinates: { x: 20, y: 400 }, context: lastContext });
  assert.equal(emptyHeading.x, 0);
  assert.equal(emptyHeading.y, 540);
});

test('workspace editor controls appear for Super Admin only, including when an ordinary admin has unrelated tools', () => {
  const CompanyModule = loadComponent('../src/modules/CompanyModule.tsx', { '../components/WorkspaceMenuEditor': { __esModule: true, default: () => null } });
  const props = { isGateway: true, selectedCompany: 'Company A', adminUsers: [], loginUsername: 'demo', onSaveNavigation: () => Promise.resolve(), navigationGroups: defaultWorkspaceMenuGroups() };
  const render = currentUser => renderToStaticMarkup(React.createElement(CompanyModule, { ...props, currentUser, hasUsers: true }));
  assert.match(render({ role: 'Super Admin' }), /Edit company menu/);
  assert.doesNotMatch(render({ role: 'Admin' }), /Edit company menu/);
  assert.doesNotMatch(render({ role: 'Auditor' }), /Edit company menu/);
});

test('editor presents accessible drag/move controls, escapes headings and does not save during rendering', () => {
  const Editor = loadComponent('../src/components/WorkspaceMenuEditor.tsx');
  let saves = 0;
  const groups = defaultWorkspaceMenuGroups();
  groups[0].title = '<My & team>';
  const html = renderToStaticMarkup(React.createElement(Editor, { company: 'Company A', groups, version: 4, onSave: () => { saves++; return Promise.resolve(); }, onClose() {} }));
  assert.match(html, /<dialog/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /&lt;My &amp; team&gt;/);
  assert.match(html, /Drag Books &amp; reconciliation/);
  assert.match(html, /Move Books &amp; reconciliation to heading/);
  assert.match(html, /Save company menu/);
  assert.match(html, /\+ Add heading/);
  assert.equal(saves, 0);
});
