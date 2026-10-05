import { BadRequestException, CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

@Injectable()
export class DocsAuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.sessions.authenticate(request.headers.authorization);
    const rawCompany = request.headers['x-company'];
    if (typeof rawCompany !== 'string' || !rawCompany.trim() || rawCompany.length > 100) {
      throw new BadRequestException('A valid company header is required.');
    }
    const company = rawCompany.trim();
    const modules = user.modules && typeof user.modules === 'object' && !Array.isArray(user.modules)
      ? user.modules as Record<string, unknown> : {};
    const companies = modules.companies && typeof modules.companies === 'object' && !Array.isArray(modules.companies)
      ? modules.companies as Record<string, unknown> : {};
    if (user.role !== 'Super Admin' && (modules.ai_docs !== true || companies[company] !== true)) {
      throw new ForbiddenException('You do not have access to documents in this workspace.');
    }
    if (!await this.sessions.companyExists(company)) throw new ForbiddenException('This workspace is unavailable.');
    request.headers['x-company'] = company;
    request.headers['x-username'] = user.username;
    return true;
  }
}
