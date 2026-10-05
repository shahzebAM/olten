import { Module } from '@nestjs/common';
import { AuthSessionService } from './auth-session.service';
import { DocsAuthGuard } from './docs-auth.guard';
import { AdminAuthGuard } from './admin-auth.guard';
import { CompanyAuthGuard } from './company-auth.guard';

@Module({ providers: [AuthSessionService, DocsAuthGuard, AdminAuthGuard, CompanyAuthGuard], exports: [AuthSessionService, DocsAuthGuard, AdminAuthGuard, CompanyAuthGuard] })
export class AuthSessionModule {}
