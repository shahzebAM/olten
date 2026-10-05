import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

@Injectable()
export class CompanyAuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = await this.sessions.authenticate(request.headers.authorization);
    if (request.method === 'GET' || user.role === 'Super Admin') return true;
    throw new ForbiddenException('Only a Super Admin can manage workspaces.');
  }
}
