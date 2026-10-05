import { 
  Controller, Get, Post, Delete, Patch, Body, Param, 
  HttpException, HttpStatus, ParseIntPipe, NotFoundException, UnauthorizedException, UseGuards, SetMetadata, Req, BadRequestException
} from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthSessionService } from './auth/auth-session.service';
import { AdminAuthGuard } from './auth/admin-auth.guard';
import type { AdminAuthenticatedRequest } from './auth/admin-auth.guard';

const prisma = new PrismaClient();

@Controller()
@UseGuards(AdminAuthGuard)
export class AppController {
  constructor(private readonly appService: AppService, private readonly sessions: AuthSessionService) {}

  private validatedAdminFields(body: unknown, creating = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Invalid user data.');
    const fields = body as Record<string, unknown>;
    if (Object.keys(fields).some(key => !['username', 'password', 'role', 'status', 'modules'].includes(key))) {
      throw new BadRequestException('Unsupported user fields.');
    }
    const data: { username?: string; password?: string; role?: string; status?: string; modules?: Prisma.InputJsonValue } = {};
    if (creating || fields.username !== undefined) {
      if (typeof fields.username !== 'string' || !fields.username.trim() || fields.username.trim().length > 100
        || /[\u0000-\u001f\u007f]/.test(fields.username)) throw new BadRequestException('A valid username is required.');
      data.username = fields.username.trim();
    }
    if (creating || fields.password !== undefined) {
      if (typeof fields.password !== 'string') throw new BadRequestException('A valid password is required.');
      if (creating || fields.password.trim()) {
        if (fields.password.length < 8 || Buffer.byteLength(fields.password) > 72) {
          throw new BadRequestException('New passwords must contain at least 8 characters and at most 72 bytes.');
        }
        data.password = fields.password;
      }
    }
    if (fields.role !== undefined) {
      if (fields.role !== 'Admin' && fields.role !== 'Super Admin') throw new BadRequestException('Invalid user role.');
      data.role = fields.role;
    }
    if (fields.status !== undefined) {
      if (fields.status !== 'Active' && fields.status !== 'Suspended') throw new BadRequestException('Invalid user status.');
      data.status = fields.status;
    }
    if (fields.modules !== undefined) {
      if (!fields.modules || typeof fields.modules !== 'object' || Array.isArray(fields.modules)) throw new BadRequestException('Invalid permissions.');
      const modules = fields.modules as Record<string, unknown>;
      const booleanKeys = ['payroll', 'ai_docs', 'master_inventory', 'inventory', 'products', 'warehouses', 'purchasing', 'sales'];
      if (Object.entries(modules).some(([key, value]) => key !== 'companies' && (!booleanKeys.includes(key) || typeof value !== 'boolean'))) {
        throw new BadRequestException('Permissions must contain supported boolean module values.');
      }
      if (modules.companies !== undefined) {
        if (!modules.companies || typeof modules.companies !== 'object' || Array.isArray(modules.companies)
          || Object.keys(modules.companies).length > 1000
          || Object.entries(modules.companies).some(([name, allowed]) => !name.trim() || name.length > 100 || typeof allowed !== 'boolean')) {
          throw new BadRequestException('Company permissions must contain valid workspace names and boolean values.');
        }
      }
      data.modules = modules as Prisma.InputJsonValue;
    }
    return data;
  }

  private async preserveActiveSuperAdmin(transaction: Prisma.TransactionClient, target: { role: string; status: string }, role: string, status: string) {
    if (target.role === 'Super Admin' && target.status === 'Active' && (role !== 'Super Admin' || status !== 'Active')
      && await transaction.admin.count({ where: { role: 'Super Admin', status: 'Active' } }) <= 1) {
      throw new HttpException('System must have at least one active Super Admin.', HttpStatus.FORBIDDEN);
    }
  }

  private async mutateAdmin<T>(mutation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(mutation, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new HttpException('User data changed during this request. Please try again.', HttpStatus.CONFLICT);
      }
    }
    throw new HttpException('Could not safely update the user. Please try again.', HttpStatus.CONFLICT);
  }

  @Get()
  @SetMetadata('authPublic', true)
  getHello(): string { 
    return this.appService.getHello(); 
  }

  // ==========================================
  // AUTHENTICATION & ADMIN ROUTES
  // ==========================================

  @Post(['auth/setup', 'api/auth/setup', 'setup', 'api/setup'])
  @SetMetadata('authPublic', true)
  async setupAdmin(@Body() body: any) {
    const fields = this.validatedAdminFields(body, true);
    const username = fields.username!;
    const password = fields.password!;
    const existingAdmin = await prisma.admin.findFirst();
    
    if (existingAdmin) {
      throw new HttpException('An admin already exists!', HttpStatus.FORBIDDEN);
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // First admin ever created gets access to everything
    await prisma.admin.create({ 
      data: { 
        username, 
        password: hashedPassword, 
        role: 'Super Admin',
        modules: { payroll: true, ai_docs: true, inventory: true, sales: true, purchasing: true }
      } 
    });
    
    return { message: "Setup complete!" };
  }

  @Post(['auth/login', 'api/auth/login', 'login', 'api/login'])
  @SetMetadata('authPublic', true)
  async login(@Body() body: any) {
    const { username, password } = body;
    if (typeof username !== 'string' || !username.trim() || username.length > 100
      || typeof password !== 'string' || !password || password.length > 1024) {
      throw new UnauthorizedException('Access Denied: Invalid credentials.');
    }
    const admin = await prisma.admin.findFirst({
      where: { username: { equals: username.trim(), mode: 'insensitive' } },
    });

    if (!admin || admin.status !== 'Active') {
      throw new UnauthorizedException('Access Denied: Invalid credentials.');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException('Access Denied: Invalid credentials.');
    }

    return { message: "Login successful!", ...this.sessions.issue(admin) };
  }

@Get(['admins', 'api/admins'])
  async getAdmins() {
    const admins = await prisma.admin.findMany();
    return admins.map(a => ({
      id: a.id,
      username: a.username,
      role: a.role || 'Admin', 
      modules: a.modules || { payroll: false, ai_docs: false, inventory: false, sales: false, purchasing: false }, 
      moduleOrder: a.moduleOrder || [], // <--- ADDED THIS LINE
      status: a.status,
      isOnline: a.isOnline || false // <--- ADD THIS EXACT LINE
    }));
  }

  @Post(['admins', 'api/admins'])
  async createAdmin(@Body() body: any) {
    const data = this.validatedAdminFields(body, true);
    const existing = await prisma.admin.findFirst({ where: { username: { equals: data.username!, mode: 'insensitive' } } });
    
    if (existing) throw new HttpException('Username exists', HttpStatus.FORBIDDEN);
    
    const hashedPassword = await bcrypt.hash(data.password!, 10);
    await prisma.admin.create({ 
      data: { 
        username: data.username!,
        password: hashedPassword, 
        role: data.role || 'Admin',
        status: data.status || 'Active',
        modules: data.modules || { payroll: false, ai_docs: false, inventory: false, sales: false, purchasing: false, companies: {} }
      } 
    });
    
    return { message: "Admin created" };
  }

  @Patch(['admins/:id', 'api/admins/:id'])
  async updateAdmin(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const data = this.validatedAdminFields(body);
    if (data.password) data.password = await bcrypt.hash(data.password, 10);
    await this.mutateAdmin(async transaction => {
      const target = await transaction.admin.findUnique({ where: { id } });
      if (!target) throw new NotFoundException('Admin not found.');
      await this.preserveActiveSuperAdmin(transaction, target, data.role || target.role, data.status || target.status);
      if (data.username && data.username.toLowerCase() !== target.username.toLowerCase()) {
        const duplicate = await transaction.admin.findFirst({ where: { username: { equals: data.username, mode: 'insensitive' }, NOT: { id } } });
        if (duplicate) throw new HttpException('Username exists', HttpStatus.FORBIDDEN);
      }
      await transaction.admin.update({ where: { id }, data: { ...data, ...(data.status === 'Suspended' ? { isOnline: false } : {}) } });
    });
    return { message: 'Admin updated' };
  }
  
  @Patch(['admins/:id/password', 'api/admins/:id/password'])
  async resetAdminPassword(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const password = this.validatedAdminFields({ password: body?.password }).password;
    if (!password) throw new BadRequestException('A new password is required.');
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.update({ 
      where: { id }, 
      data: { password: hashedPassword } 
    });
    return { message: "Password updated" };
  }

  @Patch(['admins/:id/role', 'api/admins/:id/role'])
  async updateAdminRole(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const role = this.validatedAdminFields({ role: body?.role }).role;
    if (!role) throw new BadRequestException('A user role is required.');
    await this.mutateAdmin(async transaction => {
      const target = await transaction.admin.findUnique({ where: { id } });
      if (!target) throw new NotFoundException('Admin not found.');
      await this.preserveActiveSuperAdmin(transaction, target, role, target.status);
      await transaction.admin.update({ where: { id }, data: { role } });
    });
    return { message: "Role updated" };
  }

  @Patch(['admins/:id/modules', 'api/admins/:id/modules'])
  async updateAdminModules(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    const modules = this.validatedAdminFields({ modules: body?.modules }).modules;
    if (!modules) throw new BadRequestException('Permissions are required.');
    await prisma.admin.update({ 
      where: { id }, 
      data: { modules }
    });
    return { message: "Module access updated" };
  }
  
  @Delete(['admins/:id', 'api/admins/:id'])
  async deleteAdmin(@Param('id', ParseIntPipe) id: number) {
    await this.mutateAdmin(async transaction => {
      const target = await transaction.admin.findUnique({ where: { id } });
      if (!target) throw new NotFoundException('Admin not found.');
      await this.preserveActiveSuperAdmin(transaction, target, 'Admin', 'Suspended');
      await transaction.admin.delete({ where: { id } });
    });
    return { message: "Admin deleted" };
  }

  @Patch(['admins/:id/preferences', 'api/admins/:id/preferences'])
  async updateAdminPreferences(
    @Param('id') id: string, 
    @Body() body: any,
    @Req() request: AdminAuthenticatedRequest,
  ) {
    const { moduleOrder } = body;
    
    if (!moduleOrder || !Array.isArray(moduleOrder)) {
      throw new HttpException('Invalid module layout format', HttpStatus.BAD_REQUEST);
    }

    const actor = request.authenticatedAdmin;
    if (!actor) throw new UnauthorizedException('Please log in again.');
    // Ordinary users always update their authenticated account, including numeric usernames.
    const where = actor.role !== 'Super Admin' ? { id: actor.id }
      : /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? { id: Number(id) }
      : { username: { equals: id, mode: 'insensitive' as const } };
    const adminRecord = await prisma.admin.findFirst({
      where,
    });

    if (!adminRecord) {
      throw new NotFoundException("Admin not found");
    }

    // Save the new layout array to the database
    await prisma.admin.update({ 
      where: { id: adminRecord.id }, 
      data: { moduleOrder } 
    });
    
    return { message: "Preferences updated successfully" };
  }

  // ==========================================
  // ACTIVE SESSIONS TRIGGER
  // ==========================================
  @Patch(['admins/:id/status', 'api/admins/:id/status'])
  async updateAdminStatus(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: { isOnline: boolean }
  ) {
    if (typeof body?.isOnline !== 'boolean') throw new BadRequestException('Online status must be a boolean.');
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    await prisma.admin.update({ 
      where: { id }, 
      data: { isOnline: body.isOnline } 
    });
    
    return { message: "Online status updated" };
  }
}
