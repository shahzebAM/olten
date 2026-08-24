import { 
  Controller, Get, Post, Delete, Patch, Body, Param, 
  HttpException, HttpStatus, ParseIntPipe, NotFoundException 
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

  @Post('auth/setup')
  async setupAdmin(@Body() body: any) {
    const { username, password } = body;
    const existingAdmin = await prisma.admin.findFirst();
    
    if (existingAdmin) {
      throw new HttpException('An admin already exists!', HttpStatus.FORBIDDEN);
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // First admin ever created is forced to be a Super Admin
    await prisma.admin.create({ 
      // @ts-ignore (Ignores temporary VS code warning)
      data: { username, password: hashedPassword, role: 'Super Admin' } 
    });
    
    return { message: "Setup complete!" };
  }

  @Post('auth/login')
  async login(@Body() body: any) {
    const { username, password } = body;
    
    // FIXED: Fetch all and match case-insensitively so "Ali" and "ali" both work perfectly!
    const admins = await prisma.admin.findMany();
    const admin = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    
    if (!admin) throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    
    return { message: "Login successful!" };
  }

  @Get('admins')
  async getAdmins() {
    const admins = await prisma.admin.findMany();
    return admins.map(a => ({
      id: a.id,
      username: a.username,
      // @ts-ignore
      role: a.role || 'Admin', // Pulls the real role from the database!
      // FIXED: Actually return the modules to the frontend so checkboxes stay checked!
      // @ts-ignore
      modules: a.modules || { payroll: false, ai_docs: false }, 
      status: 'Active'
    }));
  }

  @Post('admins')
  async createAdmin(@Body() body: any) {
    // FIXED: Extract the modules from the frontend payload
    const { username, password, modules } = body; 
    
    // FIXED: Case-insensitive check to prevent duplicate names like "admin" and "Admin"
    const admins = await prisma.admin.findMany();
    const existing = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
    
    if (existing) throw new HttpException('Username exists', HttpStatus.FORBIDDEN);
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.create({ 
      // @ts-ignore
      data: { 
        username, 
        password: hashedPassword, 
        role: 'Admin',
        // FIXED: Save the modules to the database when adding a user!
        modules: modules || { payroll: false, ai_docs: false } 
      } 
    });
    
    return { message: "Admin created" };
  }
  
  @Patch('admins/:id/password')
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

  @Patch('admins/:id/role')
  async updateAdminRole(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    // Protect the last Super Admin from being demoted
    if (body.role !== 'Super Admin') {
      // @ts-ignore
      const superAdminCount = await prisma.admin.count({ where: { role: 'Super Admin' } });
      // @ts-ignore
      if (targetAdmin.role === 'Super Admin' && superAdminCount <= 1) {
        throw new HttpException('System must have at least one Super Admin', HttpStatus.FORBIDDEN);
      }
    }
    
    // @ts-ignore
    await prisma.admin.update({ where: { id }, data: { role: body.role } });
    return { message: "Role updated" };
  }

  @Patch('admins/:id/modules')
  async updateAdminModules(
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: any
  ) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    await prisma.admin.update({ 
      where: { id }, 
      // @ts-ignore
      data: { modules: body.modules } 
    });
    return { message: "Module access updated" };
  }
  
  @Delete('admins/:id')
  async deleteAdmin(@Param('id', ParseIntPipe) id: number) {
    const targetAdmin = await prisma.admin.findUnique({ where: { id } });
    if (!targetAdmin) throw new NotFoundException("Admin not found");

    // Protect the last Super Admin from being deleted
    // @ts-ignore
    if (targetAdmin.role === 'Super Admin') {
      // @ts-ignore
      const superAdminCount = await prisma.admin.count({ where: { role: 'Super Admin' } });
      if (superAdminCount <= 1) {
        throw new HttpException('Cannot delete the last Super Admin', HttpStatus.FORBIDDEN);
      }
    }
    
    await prisma.admin.delete({ where: { id } });
    return { message: "Admin deleted" };
  }
}