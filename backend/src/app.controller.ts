import { Controller, Get, Post, Delete, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
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
    if (existingAdmin) throw new HttpException('An admin account already exists!', HttpStatus.FORBIDDEN);
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.create({ data: { username, password: hashedPassword } });
    return { message: "Admin account successfully created!" };
  }

  @Post('auth/login')
  async login(@Body() body: any) {
    const { username, password } = body;
    const admin = await prisma.admin.findUnique({ where: { username } });
    if (!admin) throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    
    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    
    return { message: "Login successful!" };
  }

  // 👉 THIS IS THE ROUTE THAT LOADS THE USERS TABLE
  @Get('admins')
  async getAdmins() {
    const admins = await prisma.admin.findMany();
    return admins.map(a => ({
      id: a.id,
      username: a.username,
      role: a.id === 1 ? 'Super Admin' : 'Admin',
      status: 'Active'
    }));
  }

  // 👉 THIS IS THE ROUTE THAT SAVES NEW USERS
  @Post('admins')
  async createAdmin(@Body() body: any) {
    const { username, password } = body;
    const existing = await prisma.admin.findUnique({ where: { username } });
    if (existing) throw new HttpException('Username exists', HttpStatus.FORBIDDEN);
    
    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.create({ data: { username, password: hashedPassword } });
    return { message: "Admin created" };
  }

  // 👉 THIS IS THE ROUTE THAT DELETES USERS
  @Delete('admins/:id')
  async deleteAdmin(@Param('id') id: string) {
    if (Number(id) === 1) throw new HttpException('Cannot delete root admin', HttpStatus.FORBIDDEN);
    await prisma.admin.delete({ where: { id: Number(id) } });
    return { message: "Admin deleted" };
  }
}