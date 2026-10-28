// Presentation metadata only. Available modules continue to come from CompanyModule's existing permissions.
export const workspaceNavigation = [
  { id: 'executive', module: 'executive', title: 'Executive overview', group: 'Overview', icon: 'M3 13h7v8H3zM14 3h7v18h-7zM3 3h7v6H3z' },
  { id: 'customers', module: 'customers', title: 'Customers', group: 'Sales', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
  { id: 'create_os', module: 'create_os', title: 'Create order slip', group: 'Sales', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 15h8M8 18h5' },
  { id: 'sales_orders', module: 'sales_orders', title: 'Sales documents', group: 'Sales', icon: 'M4 3h16v18H4zM8 7h8M8 11h8M8 15h4' },
  { id: 'suppliers', module: 'suppliers', title: 'Suppliers', group: 'Purchases', icon: 'M3 21h18M5 21V3h14v18M9 7h1M14 7h1M9 11h1M14 11h1M10 21v-5h4v5' },
  { id: 'purchase_orders', module: 'purchase_orders', title: 'Purchase orders', group: 'Purchases', icon: 'M6 7h12l2 14H4zM9 7V5a3 3 0 0 1 6 0v2' },
  { id: 'importation', module: 'importation', title: 'Importation & receiving', group: 'Purchases', icon: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4' },
  { id: 'inventory', module: 'inventory', title: 'Master inventory', group: 'Operations', icon: 'm21 8-9 5-9-5M12 13v9M3 7l9-5 9 5v10l-9 5-9-5z' },
  { id: 'warehouse_ops', module: 'warehouse_ops', title: 'Warehouse & counts', group: 'Operations', icon: 'M3 21V8l9-6 9 6v13M7 21V11h10v10M7 15h10M7 18h10' },
  { id: 'deliveries', module: 'deliveries', title: 'Delivery & POD', group: 'Operations', icon: 'M1 3h14v13H1zM15 8h4l3 4v4h-7M8 18a3 3 0 1 0-6 0 3 3 0 0 0 6 0M21 18a3 3 0 1 0-6 0 3 3 0 0 0 6 0' },
  { id: 'generate_qr', module: 'qr_system', title: 'QR labels', group: 'Operations', icon: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h2v2h4v4h-6z' },
  { id: 'finance', module: 'finance', title: 'Landed cost & finance', group: 'Accounting', icon: 'M12 2v20M17 5H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6' },
  { id: 'books', module: 'books', title: 'Books & reconciliation', group: 'Accounting', icon: 'M4 3h6a3 3 0 0 1 3 3v15a4 4 0 0 0-4-2H4zM13 6a3 3 0 0 1 3-3h5v16h-4a4 4 0 0 0-4 2' },
  { id: 'service', module: 'service', title: 'Device service', group: 'Tools & team', icon: 'm14 6 4 4M3 21l8-8M14 3a6 6 0 0 0-6 8l5 5a6 6 0 0 0 8-6l-5 3-4-4z' },
  { id: 'ai_docs', module: 'ai_docs', title: 'Document workspace', group: 'Tools & team', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6' },
  { id: 'ai_assistant', module: 'ai_assistant', title: 'AI assistant & OCR', group: 'Tools & team', icon: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z' },
  { id: 'payroll', module: 'payroll', title: 'Payroll', group: 'Tools & team', icon: 'M3 5h18v14H3zM3 9h18M7 14h3' },
] as const;

const moduleCardLabels: Record<string, string> = {
  executive: 'Executive Dashboard',
  customers: 'Customer Directory',
  create_os: 'Create Order Slip',
  sales_orders: 'O.S. Ledger',
  suppliers: 'Supplier Directory',
  purchase_orders: 'P.O.',
  importation: 'Importation & Receiving',
  inventory: 'Master Inventory',
  warehouse_ops: 'Warehouse & Cycle Counts',
  customer_pos: 'Customer Orders & Fulfillment',
  deliveries: 'Delivery & Proof of Delivery',
  generate_qr: 'QR Generator',
  finance: 'Landed Cost & Finance',
  books: 'Books & Reconciliation',
  service: 'Medical Device Service',
  ai_docs: 'AI Docs Engine',
  ai_assistant: 'Executive AI & Invoice OCR',
  payroll: 'Payroll Engine',
};

export function matchesWorkspaceModule(id: string, query: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[\s_.-]+/g, '');
  const search = normalize(query);
  const item = workspaceNavigation.find(item => item.id === id);
  return !search || [id, item?.module, item?.title, moduleCardLabels[id]]
    .some(label => label !== undefined && normalize(label).includes(search));
}

export function workspaceTitle(module: string): string {
  if (module === 'none') return 'Workspace overview';
  if (module === 'users') return 'User management';
  return workspaceNavigation.find(item => item.module === module)?.title ?? 'Workspace';
}

export type WorkspaceMenuGroup = { id: string; title: string; items: string[] };
export type WorkspaceNavigationItem = (typeof workspaceNavigation)[number];
export type WorkspaceNavigationGroup = Omit<WorkspaceMenuGroup, 'items'> & { items: WorkspaceNavigationItem[] };

export function defaultWorkspaceMenuGroups(): WorkspaceMenuGroup[] {
  const groups: WorkspaceMenuGroup[] = [];
  for (const item of workspaceNavigation) {
    let group = groups.find(group => group.title === item.group);
    if (!group) {
      group = { id: item.group.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: item.group, items: [] };
      groups.push(group);
    }
    group.items.push(item.id);
  }
  return groups;
}

/** Validate presentation data only; permissions always come from the available module IDs. */
export function parseWorkspaceMenuGroups(value: unknown): WorkspaceMenuGroup[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 30) return null;
  const knownIds = new Set<string>(workspaceNavigation.map(item => item.id));
  const groupIds = new Set<string>();
  const itemIds = new Set<string>();
  const groups: WorkspaceMenuGroup[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const group = candidate as Record<string, unknown>;
    if (typeof group.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(group.id)
      || groupIds.has(group.id) || typeof group.title !== 'string' || !group.title.trim()
      || group.title.trim().length > 60 || Array.from(group.title).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || !Array.isArray(group.items) || group.items.some(id => typeof id !== 'string' || !knownIds.has(id) || itemIds.has(id))) return null;
    for (const id of group.items as string[]) {
      if (itemIds.has(id)) return null;
      itemIds.add(id);
    }
    groupIds.add(group.id);
    groups.push({ id: group.id, title: group.title.trim(), items: [...group.items] as string[] });
  }
  return groups;
}

/** New modules remain discoverable even if a previously saved layout predates them. */
export function normalizeWorkspaceMenuGroups(value: unknown): WorkspaceMenuGroup[] {
  const groups = parseWorkspaceMenuGroups(value);
  if (!groups) return defaultWorkspaceMenuGroups();
  const assigned = new Set(groups.flatMap(group => group.items));
  for (const fallback of defaultWorkspaceMenuGroups()) {
    const missing = fallback.items.filter(id => !assigned.has(id));
    if (!missing.length) continue;
    const existing = groups.find(group => group.id === fallback.id);
    if (existing) existing.items.push(...missing);
    else if (groups.length < 30) groups.push({ ...fallback, items: missing });
    else groups[groups.length - 1].items.push(...missing);
    missing.forEach(id => assigned.add(id));
  }
  return groups;
}

export function getWorkspaceNavigationGroups(value: unknown, availableIds: readonly string[]): WorkspaceNavigationGroup[] {
  const available = new Set(availableIds);
  return normalizeWorkspaceMenuGroups(value).map(group => ({
    ...group,
    items: group.items.flatMap(id => {
      const item = available.has(id) ? workspaceNavigation.find(item => item.id === id) : undefined;
      return item ? [item] : [];
    }),
  })).filter(group => group.items.length > 0);
}

export function canEditWorkspaceMenu(user: { role?: string } | null | undefined): boolean {
  return user?.role === 'Super Admin';
}

export function moveWorkspaceMenuGroup(groups: readonly WorkspaceMenuGroup[], groupId: string, targetIndex: number): WorkspaceMenuGroup[] {
  const next = groups.map(group => ({ ...group, items: [...group.items] }));
  const index = next.findIndex(group => group.id === groupId);
  if (index < 0 || !Number.isInteger(targetIndex)) return next;
  const [group] = next.splice(index, 1);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, group);
  return next;
}

export function moveWorkspaceMenuItem(groups: readonly WorkspaceMenuGroup[], itemId: string, targetGroupId: string, targetIndex: number): WorkspaceMenuGroup[] {
  const next = groups.map(group => ({ ...group, items: [...group.items] }));
  const source = next.find(group => group.items.includes(itemId));
  const target = next.find(group => group.id === targetGroupId);
  if (!source || !target || !Number.isInteger(targetIndex)) return next;
  source.items.splice(source.items.indexOf(itemId), 1);
  target.items.splice(Math.max(0, Math.min(targetIndex, target.items.length)), 0, itemId);
  return next;
}
