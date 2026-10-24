export const ERP_ROLES = [
  'Management',
  'Purchasing',
  'Importation',
  'Warehouse',
  'QC/Regulatory',
  'Sales',
  'Delivery',
  'Finance',
  'Auditor',
  'AI',
] as const;
export type Phase3Scope =
  'landed' | 'finance' | 'books' | 'service' | 'executive' | 'ai';
export type Phase3View =
  'finance' | 'books' | 'service' | 'executive' | 'ai_assistant';
export type ErpUser = {
  role?: string;
  modules?: {
    erpRoles?: string[];
    approvalLimits?: Record<string, string>;
    companies?: Record<string, boolean>;
    [key: string]: unknown;
  };
};

const roleScopes: Record<Phase3Scope, readonly string[]> = {
  landed: ['Management', 'Purchasing', 'Importation', 'Finance', 'Auditor'],
  finance: ['Management', 'Finance', 'Sales', 'Auditor'],
  books: ['Management', 'Finance', 'Auditor'],
  service: [
    'Management',
    'Warehouse',
    'QC/Regulatory',
    'Sales',
    'Delivery',
    'Auditor',
  ],
  executive: ERP_ROLES,
  ai: ['Management', 'AI', 'Auditor', 'Purchasing', 'Importation', 'Finance'],
};

export function hasPhase3Access(
  user: ErpUser | undefined,
  company: string | null,
  scope: Phase3Scope,
  write = false,
): boolean {
  if (!user || !company) return false;
  if (user.role === 'Super Admin') return true;
  if (user.modules?.companies?.[company] !== true) return false;
  const roles = Array.isArray(user.modules.erpRoles)
    ? user.modules.erpRoles
    : [];
  if (write && roles.includes('Auditor')) return false;
  const flag =
    scope === 'landed'
      ? ['finance', 'purchasing', 'importation'].some(
          (key) => user.modules?.[key] === true,
        )
      : user.modules[scope === 'ai' ? 'ai_assistant' : scope] === true;
  const allowed =
    write && (scope === 'ai' || scope === 'executive')
      ? []
      : write && scope === 'finance'
        ? ['Management', 'Finance']
        : write && scope === 'service'
          ? ['Management', 'Warehouse', 'QC/Regulatory', 'Delivery']
          : roleScopes[scope];
  return flag && roles.some((role) => allowed.includes(role));
}

export function phase3Scope(view: Phase3View): Phase3Scope {
  return view === 'ai_assistant' ? 'ai' : view;
}

export function canManageLedgerAccounts(
  user: ErpUser | undefined,
  company: string | null,
): boolean {
  return (
    user?.role === 'Super Admin' &&
    hasPhase3Access(user, company, 'books', true)
  );
}
