import { 
  Controller, Get, Post, Delete, Patch, Body, Param, 
  HttpException, HttpStatus, ParseIntPipe, NotFoundException, UnauthorizedException 
} from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string { 
    return this.appService.getHello(); 
  }

  // ==========================================
  // AUTHENTICATION & ADMIN ROUTES
  // ==========================================

  @Post(['auth/setup', 'api/auth/setup', 'setup', 'api/setup'])
  async setupAdmin(@Body() body: any) {
    const { username, password } = body;
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
  async login(@Body() body: any) {
    const { username, password } = body;
    
    // Fetch all admins and match case-insensitively to prevent "Admin" vs "admin" lockouts
    const admins = await prisma.admin.findMany();
    const admin = admins.find(a => a.username.toLowerCase() === username.toLowerCase());

    if (!admin) {
      throw new UnauthorizedException('Access Denied: User not found.');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    
    if (!isPasswordValid) {
      throw new UnauthorizedException('Access Denied: Invalid password.');
    }

    return { message: "Login successful!" };
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
      status: 'Active',
      isOnline: a.isOnline || false // <--- ADD THIS EXACT LINE
    }));
  }

  @Post(['admins', 'api/admins'])
  async createAdmin(@Body() body: any) {
    const { username, password, modules } = body; 
    
    const admins = await prisma.admin.findMany();
    const existing = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    
    if (existing) throw new HttpException('Username exists', HttpStatus.FORBIDDEN);
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.create({ 
      data: { 
        username, 
        password: hashedPassword, 
        role: 'Admin',
        modules: modules || { payroll: false, ai_docs: false, inventory: false, sales: false, purchasing: false } 
      } 
    });
    
    return { message: "Admin created" };
  }
  
  @Patch(['admins/:id/password', 'api/admins/:id/password'])
  async resetAdminPassword(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const hashedPassword = await bcrypt.hash(body.password, 10);
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
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    if (body.role !== 'Super Admin') {
      const superAdminCount = await prisma.admin.count({ where: { role: 'Super Admin' } });
      if (targetAdmin.role === 'Super Admin' && superAdminCount <= 1) {
        throw new HttpException('System must have at least one Super Admin', HttpStatus.FORBIDDEN);
      }
    }
    
    await prisma.admin.update({ where: { id }, data: { role: body.role } });
    return { message: "Role updated" };
  }

  @Patch(['admins/:id/modules', 'api/admins/:id/modules'])
  async updateAdminModules(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    await prisma.admin.update({ 
      where: { id }, 
      data: { modules: body.modules } 
    });
    return { message: "Module access updated" };
  }
  
  @Delete(['admins/:id', 'api/admins/:id'])
  async deleteAdmin(@Param('id', ParseIntPipe) id: number) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    if (targetAdmin.role === 'Super Admin') {
      const superAdminCount = await prisma.admin.count({ where: { role: 'Super Admin' } });
      if (superAdminCount <= 1) {
        throw new HttpException('Cannot delete the last Super Admin', HttpStatus.FORBIDDEN);
      }
    }
    
    await prisma.admin.delete({ where: { id } });
    return { message: "Admin deleted" };
  }

  @Patch(['admins/:id/preferences', 'api/admins/:id/preferences'])
  async updateAdminPreferences(
    @Param('id') id: string, 
    @Body() body: any
  ) {
    const { moduleOrder } = body;
    
    if (!moduleOrder || !Array.isArray(moduleOrder)) {
      throw new HttpException('Invalid module layout format', HttpStatus.BAD_REQUEST);
    }

    // Determine if the frontend sent the numeric ID or the string username
    const numericId = parseInt(id, 10);
    const adminRecord = await prisma.admin.findFirst({
      where: {
        OR: [
          { id: isNaN(numericId) ? undefined : numericId },
          { username: id }
        ]
      }
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
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    await prisma.admin.update({ 
      where: { id }, 
      data: { isOnline: body.isOnline } 
    });
    
    return { message: "Online status updated" };
  }
}