import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageLedgerAccounts, hasPhase3Access } from '../src/lib/phase3Access.ts';

const user = (roles, flags = {}) => ({
  role: 'Admin',
  modules: { companies: { Olten: true }, erpRoles: roles, ...flags },
});

test('legacy administrator and module flags alone do not grant Phase 3 access', () => {
  assert.equal(
    hasPhase3Access(user([], { finance: true }), 'Olten', 'finance'),
    false,
  );
  assert.equal(hasPhase3Access(user(['Finance']), 'Olten', 'finance'), false);
  assert.equal(
    hasPhase3Access(user(['Finance'], { finance: true }), 'Other', 'finance'),
    false,
  );
});

test('malformed stored roles or company permissions fail closed', () => {
  assert.equal(
    hasPhase3Access(
      {
        role: 'Admin',
        modules: {
          finance: true,
          erpRoles: 'Finance',
          companies: { Olten: true },
        },
      },
      'Olten',
      'finance',
    ),
    false,
  );
  assert.equal(
    hasPhase3Access(
      {
        role: 'Admin',
        modules: {
          finance: true,
          erpRoles: ['Finance'],
          companies: { Olten: 'true' },
        },
      },
      'Olten',
      'finance',
    ),
    false,
  );
});

test('Finance access is company scoped and Sales can only read', () => {
  assert.equal(
    hasPhase3Access(
      user(['Finance'], { finance: true }),
      'Olten',
      'finance',
      true,
    ),
    true,
  );
  assert.equal(
    hasPhase3Access(user(['Sales'], { finance: true }), 'Olten', 'finance'),
    true,
  );
  assert.equal(
    hasPhase3Access(
      user(['Sales'], { finance: true }),
      'Olten',
      'finance',
      true,
    ),
    false,
  );
});

test('Auditor prevents writes even when combined with Finance or Management', () => {
  const auditor = user(['Auditor', 'Management', 'Finance'], {
    finance: true,
    books: true,
    service: true,
  });
  for (const scope of ['landed', 'finance', 'books', 'service'])
    assert.equal(hasPhase3Access(auditor, 'Olten', scope, true), false);
  assert.equal(hasPhase3Access(auditor, 'Olten', 'books'), true);
});

test('Purchasing and Importation can prepare landed costs without finance privileges', () => {
  for (const [role, flag] of [
    ['Purchasing', 'purchasing'],
    ['Importation', 'importation'],
  ]) {
    const staff = user([role], { [flag]: true });
    assert.equal(hasPhase3Access(staff, 'Olten', 'landed', true), true);
    assert.equal(hasPhase3Access(staff, 'Olten', 'finance'), false);
  }
});

test('executive and AI features are read operations and need their module flags', () => {
  const warehouse = user(['Warehouse'], { executive: true });
  assert.equal(hasPhase3Access(warehouse, 'Olten', 'executive'), true);
  assert.equal(hasPhase3Access(warehouse, 'Olten', 'executive', true), false);
  assert.equal(
    hasPhase3Access(
      user(['Purchasing'], { ai_assistant: true }),
      'Olten',
      'ai',
    ),
    true,
  );
  assert.equal(
    hasPhase3Access(user(['Sales'], { ai_assistant: true }), 'Olten', 'ai'),
    false,
  );
});

test('Super Admin retains access, while an absent company or user never grants access', () => {
  assert.equal(
    hasPhase3Access({ role: 'Super Admin' }, 'Olten', 'books', true),
    true,
  );
  assert.equal(hasPhase3Access({ role: 'Super Admin' }, null, 'books'), false);
  assert.equal(hasPhase3Access(undefined, 'Olten', 'books'), false);
});

test('only a Super Admin can delete or restore ledger accounts', () => {
  assert.equal(canManageLedgerAccounts({ role: 'Super Admin' }, 'Olten'), true);
  assert.equal(canManageLedgerAccounts({ role: 'Super Admin' }, null), false);
  assert.equal(canManageLedgerAccounts(undefined, 'Olten'), false);
  for (const role of ['Finance', 'Management', 'Auditor', 'Sales']) {
    assert.equal(
      canManageLedgerAccounts(user([role], { books: true }), 'Olten'),
      false,
    );
  }
  assert.equal(canManageLedgerAccounts({ role: 'super admin' }, 'Olten'), false);
});
