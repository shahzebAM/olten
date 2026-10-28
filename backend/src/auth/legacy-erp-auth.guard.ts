import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

type Scope = 'sales' | 'purchasing' | 'inventory' | 'qr';
type Model =
  | 'product'
  | 'warehouse'
  | 'customer'
  | 'supplier'
  | 'customerCategory'
  | 'orderSlip'
  | 'packingList'
  | 'shortage'
  | 'employee'
  | 'purchaseOrder';
const ACCESS = 'legacy-erp-access';
const RECORD = 'legacy-erp-record';
const READ_MODULES = 'legacy-erp-read-modules';
const WRITE_MODULES = 'legacy-erp-write-modules';
export const LegacyErpAccess = (scope: Scope) => SetMetadata(ACCESS, scope);
export const LegacyCompanyRecord = (model: Model) => SetMetadata(RECORD, model);
export const LegacyReadModules = (...modules: string[]) =>
  SetMetadata(READ_MODULES, modules);
export const LegacyWriteModules = (...modules: string[]) =>
  SetMetadata(WRITE_MODULES, modules);
const inventoryModules = [
  'products',
  'inventory',
  'master_inventory',
  'warehouse',
  'warehouses',
];

@Injectable()
export class LegacyErpAuthGuard implements CanActivate, OnModuleDestroy {
  private readonly prisma = new PrismaClient();
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}
  onModuleDestroy() {
    return this.prisma.$disconnect();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.sessions.authenticate(
      request.headers.authorization,
    );
    const body: Record<string, unknown> =
      request.body &&
      typeof request.body === 'object' &&
      !Array.isArray(request.body)
        ? (request.body as Record<string, unknown>)
        : {};
    const companies = [
      request.headers['x-company'],
      request.query.company,
      body.company,
      request.params.company,
    ].filter((value) => value !== undefined);
    if (
      !companies.length ||
      companies.some(
        (value) =>
          typeof value !== 'string' || !value.trim() || value.length > 100,
      )
    )
      throw new BadRequestException('A valid workspace is required.');
    const company = (companies[0] as string).trim();
    if (companies.some((value) => (value as string).trim() !== company))
      throw new ForbiddenException('Workspace identifiers must match.');
    const modules =
      user.modules &&
      typeof user.modules === 'object' &&
      !Array.isArray(user.modules)
        ? (user.modules as Record<string, unknown>)
        : {};
    const assigned =
      modules.companies &&
      typeof modules.companies === 'object' &&
      !Array.isArray(modules.companies)
        ? (modules.companies as Record<string, unknown>)
        : {};
    const metadata = [context.getHandler(), context.getClass()];
    const scope = this.reflector.getAllAndOverride<Scope>(ACCESS, metadata);
    if (!scope)
      throw new ForbiddenException('Module access is not configured.');
    const allowedModules =
      scope === 'inventory'
        ? [...inventoryModules]
        : scope === 'qr'
          ? [...inventoryModules, 'sales']
          : scope
            ? [scope]
            : [];
    allowedModules.push(
      ...(this.reflector.getAllAndOverride<string[]>(
        request.method === 'GET' ? READ_MODULES : WRITE_MODULES,
        metadata,
      ) ?? []),
    );
    if (
      user.role !== 'Super Admin' &&
      (assigned[company] !== true ||
        !allowedModules.some((key) => modules[key] === true))
    )
      throw new ForbiddenException(
        'You do not have access to this module in this workspace.',
      );
    if (!(await this.sessions.companyExists(company)))
      throw new ForbiddenException('This workspace is unavailable.');

    const model = this.reflector.getAllAndOverride<Model>(RECORD, metadata);
    if (model) {
      if (typeof request.params.id !== 'string' || !request.params.id)
        throw new BadRequestException('A record ID is required.');
      await this.requireRecord(model, request.params.id, company);
    }
    // List handlers use their existing query predicates. Never allow an omitted
    // query company to turn an authenticated list into an unscoped database read.
    if (request.method === 'GET' && !model && request.query.company !== company)
      throw new BadRequestException('A matching company query is required.');

    const rows = [
      body,
      ...['items', 'prices', 'catalog'].flatMap((key) =>
        Array.isArray(body[key]) ? (body[key] as unknown[]) : [],
      ),
    ].filter(
      (row): row is Record<string, unknown> =>
        !!row && typeof row === 'object' && !Array.isArray(row),
    );
    const references = new Map<Model, Set<string>>();
    const add = (table: Model, id: unknown) => {
      if (id === undefined || id === null || id === '' || id === 'MASTER')
        return;
      if (typeof id !== 'string' && typeof id !== 'number')
        throw new BadRequestException('Invalid record reference.');
      const values = references.get(table) ?? new Set<string>();
      values.add(String(id));
      references.set(table, values);
    };
    for (const row of rows) {
      for (const [key, table] of Object.entries({
        productId: 'product',
        warehouseId: 'warehouse',
        customerId: 'customer',
        supplierId: 'supplier',
        employeeId: 'employee',
      } as const))
        add(table, row[key]);
    }
    if (Array.isArray(body.productIds))
      body.productIds.forEach((id) => add('product', id));
    for (const [table, ids] of references) {
      // Legacy ad-hoc PO/catalog IDs may not yet exist. Preserve that workflow,
      // while rejecting every existing reference owned by a different company.
      const records = await this.lookup(table, [...ids]);
      if (records.some((record) => record.company !== company))
        throw new ForbiddenException(
          'A referenced record belongs to another workspace.',
        );
    }
    request.headers['x-company'] = company;
    if ('company' in body) body.company = company;
    for (const key of ['user', 'username'])
      if (key in body) body[key] = user.username;
    return true;
  }

  private async requireRecord(model: Model, id: string, company: string) {
    const [record] = await this.lookup(model, [id]);
    if (!record || record.company !== company)
      throw new NotFoundException('Record not found in this workspace.');
  }

  private lookup(model: Model, ids: string[]): Promise<{ company: string }[]> {
    const numeric = ids.map(Number);
    if (
      ['product', 'warehouse', 'employee'].includes(model) &&
      numeric.some((id) => !Number.isSafeInteger(id) || id < 1)
    )
      throw new BadRequestException('Invalid record reference.');
    const select = { company: true };
    switch (model) {
      case 'product':
        return this.prisma.product.findMany({
          where: { id: { in: numeric } },
          select,
        });
      case 'warehouse':
        return this.prisma.warehouse.findMany({
          where: { id: { in: numeric } },
          select,
        });
      case 'employee':
        return this.prisma.employee.findMany({
          where: { id: { in: numeric } },
          select,
        });
      case 'customer':
        return this.prisma.customer.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'supplier':
        return this.prisma.supplier.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'customerCategory':
        return this.prisma.customerCategory.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'orderSlip':
        return this.prisma.orderSlip.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'packingList':
        return this.prisma.packingList.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'shortage':
        return this.prisma.shortage.findMany({
          where: { id: { in: ids } },
          select,
        });
      case 'purchaseOrder':
        return this.prisma.purchaseOrder.findMany({
          where: { id: { in: ids } },
          select,
        });
    }
  }
}
