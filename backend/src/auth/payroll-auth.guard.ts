import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionService } from './auth-session.service';

@Injectable()
export class PayrollAuthGuard implements CanActivate, OnModuleDestroy {
  private readonly prisma = new PrismaClient();

  constructor(private readonly sessions: AuthSessionService) {}

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  private id(value: unknown): number {
    const id =
      typeof value === 'number' || typeof value === 'string'
        ? Number(value)
        : NaN;
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new BadRequestException('A valid record ID is required.');
    return id;
  }

  private async employee(company: string, value: unknown) {
    if (
      !(await this.prisma.employee.findFirst({
        where: { id: this.id(value), company },
        select: { id: true },
      }))
    )
      throw new NotFoundException('Employee not found in this workspace.');
  }

  private async record(
    company: string,
    kind: 'attendance' | 'payroll',
    value: unknown,
  ) {
    const where = { id: this.id(value), employee: { company } };
    const found =
      kind === 'attendance'
        ? await this.prisma.attendance.findFirst({
            where,
            select: { id: true },
          })
        : await this.prisma.payroll.findFirst({ where, select: { id: true } });
    if (!found)
      throw new NotFoundException('Record not found in this workspace.');
  }

  private async records(
    company: string,
    kind: 'attendance' | 'payroll',
    value: unknown,
  ) {
    if (value === undefined) return;
    if (!Array.isArray(value))
      throw new BadRequestException('Record IDs must be a list.');
    const ids = [...new Set(value.map((id: unknown) => this.id(id)))];
    if (!ids.length) return;
    const where = { id: { in: ids }, employee: { company } };
    const rows =
      kind === 'attendance'
        ? await this.prisma.attendance.findMany({ where, select: { id: true } })
        : await this.prisma.payroll.findMany({ where, select: { id: true } });
    if (rows.length !== ids.length)
      throw new NotFoundException(
        'A selected record was not found in this workspace.',
      );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
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
    if (
      user.role !== 'Super Admin' &&
      (modules.payroll !== true || companies[company] !== true)
    )
      throw new ForbiddenException(
        'You do not have payroll access in this workspace.',
      );
    if (!(await this.sessions.companyExists(company)))
      throw new ForbiddenException('This workspace is unavailable.');

    const query = request.query as Record<string, unknown>;
    if (query.company !== undefined && query.company !== company)
      throw new ForbiddenException(
        'The requested company does not match this workspace.',
      );
    const input: unknown = request.body;
    if (
      input !== undefined &&
      (input === null || typeof input !== 'object' || Array.isArray(input))
    )
      throw new BadRequestException('Invalid request data.');
    const body = (input ?? {}) as Record<string, unknown>;
    if (body.company !== undefined && body.company !== company)
      throw new ForbiddenException(
        'The requested company does not match this workspace.',
      );

    const path = request.path.replace(/\/+$/, '');
    const history = path.startsWith('/employees/attendance')
      ? 'attendance'
      : path.startsWith('/employees/payroll')
        ? 'payroll'
        : undefined;
    const recordId = request.params.id;
    if (recordId !== undefined) {
      if (history) await this.record(company, history, recordId);
      else await this.employee(company, recordId);
    }
    if (history && body.employeeId !== undefined)
      await this.employee(company, body.employeeId);
    if (
      path === '/employees/attendance' &&
      request.method === 'POST' &&
      body.employeeId === undefined
    )
      throw new BadRequestException('A valid employee is required.');
    if (
      ['/employees/payroll', '/employees/payroll/preview'].includes(path) &&
      request.method === 'POST' &&
      body.employeeId === undefined
    )
      throw new BadRequestException('A valid employee is required.');
    await this.records(company, 'attendance', body.recordIds);
    await this.records(company, 'payroll', body.payrollIds);
    request.headers['x-company'] = company;
    if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
      body.company = company;
      request.body = body;
    }
    return true;
  }
}
