import { Controller, Get, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// Initialize Prisma directly for our auth checks
const prisma = new PrismaClient();

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // ==========================================
  // AUTHENTICATION ROUTES
  // ==========================================

  // 1. TEMPORARY SETUP ROUTE (To create your first admin)
  @Post('auth/setup')
  async setupAdmin(@Body() body: any) {
    const { username, password } = body;
    
    // Check if an admin already exists (we only want ONE admin account)
    const existingAdmin = await prisma.admin.findFirst();
    if (existingAdmin) {
      throw new HttpException('An admin account already exists!', HttpStatus.FORBIDDEN);
    }

    // Hash password and save
    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = await prisma.admin.create({
      data: {
        username: username,
        password: hashedPassword
      }
    });

    return { message: "Admin account successfully created!", username: newAdmin.username };
  }

  // 2. ACTUAL LOGIN ROUTE (What your frontend connects to)
  @Post('auth/login')
  async login(@Body() body: any) {
    const { username, password } = body;

    // Find the user in the database
    const admin = await prisma.admin.findUnique({
      where: { username: username }
    });

    // Check if user exists
    if (!admin) {
      throw new HttpException('Invalid username or password', HttpStatus.UNAUTHORIZED);
    }

    // Compare passwords
    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      throw new HttpException('Invalid username or password', HttpStatus.UNAUTHORIZED);
    }

    // Success!
    return { message: "Login successful!" };
  }
}