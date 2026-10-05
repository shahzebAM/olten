import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

export type AdminAuthenticatedRequest = Request & {
  authenticatedAdmin?: Awaited<ReturnType<AuthSessionService['authenticate']>>;
};

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly sessions: AuthSessionService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.get<boolean>('authPublic', context.getHandler())) return true;
    const request = context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    const user = await this.sessions.authenticate(request.headers.authorization);
    request.authenticatedAdmin = user;
    if (request.method === 'GET' || user.role === 'Super Admin') return true;
    const path = request.path.replace(/^\/api\//, '/');
    const selfUpdate = /^\/admins\/([^/]+)\/(status|preferences)\/?$/.exec(path);
    if (request.method === 'PATCH' && selfUpdate) {
      const target = decodeURIComponent(selfUpdate[1]);
      if (target === String(user.id) || (selfUpdate[2] === 'preferences' && target.toLowerCase() === user.username.toLowerCase())) return true;
    }
    throw new ForbiddenException('Only a Super Admin can manage users.');
  }
}
