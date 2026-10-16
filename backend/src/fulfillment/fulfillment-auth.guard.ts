import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AuthSessionService,
  type SessionAdmin,
} from '../auth/auth-session.service';

export type FulfillmentRequest = Request & {
  user: Omit<SessionAdmin, 'password'>;
};

export type FulfillmentScope = 'warehouse' | 'sales' | 'delivery';
const FULFILLMENT_ACCESS = 'fulfillment-access';
export const FulfillmentAccess = (scope: FulfillmentScope) =>
  SetMetadata(FULFILLMENT_ACCESS, scope);

@Injectable()
export class FulfillmentAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FulfillmentRequest>();
    const user = await this.sessions.authenticate(
      request.headers.authorization,
    );
    const raw = request.headers['x-company'];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 100)
      throw new BadRequestException('A valid company header is required.');
    const company = raw.trim();
    const modules = (
      user.modules &&
      typeof user.modules === 'object' &&
      !Array.isArray(user.modules)
        ? user.modules
        : {}
    ) as Record<string, unknown>;
    const companies = (
      modules.companies &&
      typeof modules.companies === 'object' &&
      !Array.isArray(modules.companies)
        ? modules.companies
        : {}
    ) as Record<string, unknown>;
    const scope =
      this.reflector.getAllAndOverride<FulfillmentScope>(FULFILLMENT_ACCESS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'delivery';
    const warehouse = [
      'inventory',
      'master_inventory',
      'warehouse',
      'warehouses',
    ].some((key) => modules[key] === true);
    const sales = modules.sales === true;
    const allowed =
      scope === 'warehouse'
        ? warehouse
        : scope === 'sales'
          ? sales
          : warehouse || sales || modules.delivery === true;
    if (
      user.role !== 'Super Admin' &&
      (!allowed || companies[company] !== true)
    )
      throw new ForbiddenException(
        'You do not have fulfillment access in this workspace.',
      );
    if (!(await this.sessions.companyExists(company)))
      throw new ForbiddenException('This workspace is unavailable.');
    request.headers['x-company'] = company;
    request.user = user;
    return true;
  }
}
