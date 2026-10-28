import { BadRequestException } from '@nestjs/common';

// Presentation IDs only. Saving a menu never changes module permissions.
export const WORKSPACE_MODULE_IDS = [
  'executive',
  'customers',
  'create_os',
  'sales_orders',
  'suppliers',
  'purchase_orders',
  'importation',
  'inventory',
  'warehouse_ops',
  'deliveries',
  'generate_qr',
  'finance',
  'books',
  'service',
  'ai_docs',
  'ai_assistant',
  'payroll',
] as const;

export type CompanyNavigationGroup = {
  id: string;
  title: string;
  items: string[];
};

export function validateCompanyNavigation(body: unknown): {
  groups: CompanyNavigationGroup[];
  version: number;
} {
  const invalid = () =>
    new BadRequestException(
      'Provide up to 30 named groups containing every workspace module exactly once, and the current layout version.',
    );
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
  const input = body as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => key !== 'groups' && key !== 'version') ||
    !Number.isSafeInteger(input.version) ||
    Number(input.version) < 0 ||
    Number(input.version) >= 2147483647 ||
    !Array.isArray(input.groups) ||
    input.groups.length === 0 ||
    input.groups.length > 30
  )
    throw invalid();
  const known = new Set<string>(WORKSPACE_MODULE_IDS);
  const groupIds = new Set<string>();
  const itemIds = new Set<string>();
  const groups: CompanyNavigationGroup[] = [];
  for (const candidate of input.groups) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      throw invalid();
    const group = candidate as Record<string, unknown>;
    if (
      Object.keys(group).some(
        (key) => !['id', 'title', 'items'].includes(key),
      ) ||
      typeof group.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(group.id) ||
      groupIds.has(group.id) ||
      typeof group.title !== 'string' ||
      !group.title.trim() ||
      group.title.trim().length > 60 ||
      Array.from(group.title).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      !Array.isArray(group.items)
    )
      throw invalid();
    const items: string[] = [];
    for (const id of group.items) {
      if (typeof id !== 'string' || !known.has(id) || itemIds.has(id))
        throw invalid();
      itemIds.add(id);
      items.push(id);
    }
    groupIds.add(group.id);
    groups.push({ id: group.id, title: group.title.trim(), items });
  }
  if (itemIds.size !== known.size) throw invalid();
  return { groups, version: Number(input.version) };
}
