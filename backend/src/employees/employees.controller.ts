import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { EmployeesService } from './employees.service'; 
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

@Controller() 
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // ==========================================
  // EMPLOYEES
  // ==========================================
  @Get('employees')
  async getEmployees() {
    return await this.employeesService.getEmployees();
  }

  @Post('employees')
  async createEmployee(@Body() data: any) {
    return await this.employeesService.createEmployee(data);
  }

  @Patch('employees/:id')
  async updateEmployee(@Param('id') id: string, @Body() data: any) {
    return await this.employeesService.updateEmployee(Number(id), data);
  }

  @Delete('employees/:id')
  async deleteEmployee(@Param('id') id: string) {
    return await this.employeesService.deleteEmployee(Number(id));
  }

  // ==========================================
  // ATTENDANCES
  // ==========================================
  @Get('employees/attendance/all')
  async getAttendances() {
    return await this.employeesService.getAttendances();
  }

  @Post('employees/attendance')
  async createAttendance(@Body() data: any) {
    return await this.employeesService.createAttendance(data);
  }

  @Patch('employees/attendance/:id')
  async updateAttendance(@Param('id') id: string, @Body() data: any) {
    return await this.employeesService.updateAttendance(Number(id), data);
  }

  @Delete('employees/attendance/:id')
  async deleteAttendance(@Param('id') id: string) {
    return await this.employeesService.deleteAttendance(Number(id));
  }

  // ==========================================
  // PAYROLLS
  // ==========================================
  @Get('employees/payroll/all')
  async getPayrolls() {
    return await this.employeesService.getPayrolls();
  }

  @Post('employees/payroll')
  async createPayroll(@Body() data: any) {
    return await this.employeesService.createPayroll(data);
  }

  @Delete('employees/payroll/:id')
  async deletePayroll(@Param('id') id: string) {
    return await this.employeesService.deletePayroll(Number(id));
  }

  // ==========================================
  // SETTINGS (Global Shift Times)
  // ==========================================
  @Get('settings')
  async getSettings() {
    return await this.employeesService.getSettings();
  }

  @Post('settings')
  async updateSettings(@Body() data: any) {
    return await this.employeesService.updateSettings(data);
  }

  // ==========================================
  // ADMINS / USER CONTROL
  // ==========================================
  @Get('admins')
  async getAdmins() {
    return await prisma.admin.findMany();
  }

  @Post('admins')
  async createAdmin(@Body() data: any) {
    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(data.password, salt);
    }
    return await prisma.admin.create({ data });
  }

  @Patch('admins/:id')
  async updateAdmin(@Param('id') id: string, @Body() data: any) {
    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(data.password, salt);
    }
    
    return await prisma.admin.update({
      where: { id: Number(id) },
      data
    });
  }

  @Delete('admins/:id')
  async deleteAdmin(@Param('id') id: string) {
    return await prisma.admin.delete({
      where: { id: Number(id) }
    });
  }
}