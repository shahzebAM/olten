import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  CompanyAuthGuard,
  type CompanyRequest,
} from '../auth/company-auth.guard';
import { DocumentService } from '../documentation/document.service';
import { validateCompanyNavigation } from './company-navigation';

const prisma = new PrismaClient();

@Controller('companies')
@UseGuards(CompanyAuthGuard)
export class CompaniesController {
  constructor(private readonly documents: DocumentService) {}

  private async navigationCompany(
    request: CompanyRequest,
    rawCompany: unknown,
    write = false,
  ): Promise<string> {
    const user = request.companyUser;
    if (!user)
      throw new UnauthorizedException('A verified session is required.');
    if (write && user.role !== 'Super Admin')
      throw new ForbiddenException(
        'Only a Super Admin can organize workspace navigation.',
      );
    if (
      typeof rawCompany !== 'string' ||
      !rawCompany.trim() ||
      rawCompany.length > 100 ||
      Array.from(rawCompany).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    ) {
      throw new BadRequestException('A valid company query is required.');
    }
    const company = rawCompany.trim();
    const header = request.headers['x-company'];
    if (
      header !== undefined &&
      (typeof header !== 'string' || header.trim() !== company)
    ) {
      throw new BadRequestException('The company header and query must match.');
    }
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
      (!Object.prototype.hasOwnProperty.call(companies, company) ||
        companies[company] !== true)
    ) {
      throw new ForbiddenException('You do not have access to this workspace.');
    }
    if (
      !(await prisma.company.findUnique({
        where: { name: company },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('This workspace is unavailable.');
    }
    return company;
  }

  @Get('navigation')
  async navigation(
    @Req() request: CompanyRequest,
    @Query('company') rawCompany: unknown,
  ) {
    const company = await this.navigationCompany(request, rawCompany);
    const saved = await prisma.companyNavigation.findUnique({
      where: { company },
    });
    return { groups: saved?.groups ?? null, version: saved?.version ?? 0 };
  }

  @Put('navigation')
  async saveNavigation(
    @Req() request: CompanyRequest,
    @Query('company') rawCompany: unknown,
    @Body() body: unknown,
  ) {
    const company = await this.navigationCompany(request, rawCompany, true);
    const { groups, version } = validateCompanyNavigation(body);
    const updatedBy = request.companyUser!.id;
    try {
      return await prisma.$transaction(async (tx) => {
        if (version === 0) {
          await tx.companyNavigation.create({
            data: { company, groups, version: 1, updatedBy },
          });
        } else {
          const changed = await tx.companyNavigation.updateMany({
            where: { company, version },
            data: { groups, updatedBy, version: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException(
              'This navigation layout changed. Refresh before saving again.',
            );
        }
        return { groups, version: version + 1 };
      });
    } catch (error: unknown) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined;
      if (code === 'P2002' || code === 'P2034' || code === 'P2003') {
        throw new ConflictException(
          'This navigation layout or workspace changed. Refresh before saving again.',
        );
      }
      throw error;
    }
  }

  @Get()
  async findAll() {
    return prisma.company.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post()
  async create(@Body() data: { name: string }) {
    return prisma.company.create({ data: { name: data.name } });
  }

  @Delete(':name')
  async remove(@Param('name') name: string) {
    return this.documents.deleteCompanyWorkspace(name);
  }
}
