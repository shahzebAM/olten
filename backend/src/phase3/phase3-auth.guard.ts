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
import { AuthSessionService } from '../auth/auth-session.service';
import { Actor, hasAccess, Phase3Scope } from './phase3.shared';

export type Phase3Request = Request & { user: Actor };
const ACCESS = 'phase3-access';
const READ_ONLY = 'phase3-read-only';
export const Phase3Access = (...scopes: Phase3Scope[]) =>
  SetMetadata(ACCESS, scopes);
export const Phase3ReadOnly = () => SetMetadata(READ_ONLY, true);

@Injectable()
export class Phase3AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly reflector: Reflector = new Reflector(),
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Phase3Request>();
    const user = await this.sessions.authenticate(
      request.headers.authorization,
    );
    const raw = request.headers['x-company'];
    if (
      typeof raw !== 'string' ||
      !raw.trim() ||
      raw.length > 100 ||
      Array.from(raw).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new BadRequestException('A valid company header is required.');
    const company = raw.trim();
    const modules =
      user.modules &&
      typeof user.modules === 'object' &&
      !Array.isArray(user.modules)
        ? (user.modules as Record<string, unknown>)
        : {};
    const companies =
      modules.companies &&
      typeof modules.companies === 'object' &&
      !Array.isArray(modules.companies)
        ? (modules.companies as Record<string, unknown>)
        : {};
    const targets = [context.getHandler(), context.getClass()];
    const scopes =
      this.reflector.getAllAndOverride<Phase3Scope[]>(ACCESS, targets) ?? [];
    const readOnly =
      this.reflector.getAllAndOverride<boolean>(READ_ONLY, targets) === true;
    const write =
      !readOnly && !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (
      (user.role !== 'Super Admin' && companies[company] !== true) ||
      !scopes.some((scope) => hasAccess(user, scope, write))
    ) {
      throw new ForbiddenException(
        'You do not have permission for this action in this workspace.',
      );
    }
    if (!(await this.sessions.companyExists(company)))
      throw new ForbiddenException('This workspace is unavailable.');
    request.headers['x-company'] = company;
    request.user = user;
    return true;
  }
}
