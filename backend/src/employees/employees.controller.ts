import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Headers, UseGuards } from '@nestjs/common';
import { EmployeesService } from './employees.service'; 
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PayrollAuthGuard } from '../auth/payroll-auth.guard';
import { AdminAuthGuard } from '../auth/admin-auth.guard';

const prisma = new PrismaClient();

@Controller() 
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  // ==========================================
  // EMPLOYEES
  // ==========================================
  @Get('employees')
  @UseGuards(PayrollAuthGuard)
  async getEmployees(@Headers('x-company') company?: string) {
    const employees = await this.employeesService.getEmployees(company);
    return company ? employees.filter(employee => employee.company === company) : employees;
  }

  @Post('employees')
  @UseGuards(PayrollAuthGuard)
  async createEmployee(@Body() data: any) {
    return await this.employeesService.createEmployee(data);
  }

  @Patch('employees/:id')
  @UseGuards(PayrollAuthGuard)
  async updateEmployee(@Param('id') id: string, @Body() data: any) {
    return await this.employeesService.updateEmployee(Number(id), data);
  }

  @Delete('employees/:id')
  @UseGuards(PayrollAuthGuard)
  async deleteEmployee(@Param('id') id: string) {
    return await this.employeesService.deleteEmployee(Number(id));
  }

  // ==========================================
  // ATTENDANCES
  // ==========================================
  @Get('employees/attendance/all')
  @UseGuards(PayrollAuthGuard)
  async getAttendances(@Headers('x-company') company?: string) {
    return await this.employeesService.getAttendances(company);
  }

  @Post('employees/attendance')
  @UseGuards(PayrollAuthGuard)
  async createAttendance(@Body() data: any) {
    return await this.employeesService.createAttendance(data);
  }

  @Patch('employees/attendance/:id')
  @UseGuards(PayrollAuthGuard)
  async updateAttendance(@Param('id') id: string, @Body() data: any) {
    return await this.employeesService.updateAttendance(Number(id), data);
  }

  @Delete('employees/attendance/:id')
  @UseGuards(PayrollAuthGuard)
  async deleteAttendance(@Param('id') id: string) {
    return await this.employeesService.deleteAttendance(Number(id));
  }

// ==========================================
  // PAYROLLS
  // ==========================================
  @Get('employees/payroll/all')
  @UseGuards(PayrollAuthGuard)
  async getPayrolls(
    @Headers('x-company') company?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('dateType') dateType?: 'payroll_date' | 'cutoff',
    @Query('search') search?: string,
    @Query('declaredOnly') declaredOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!company && !startDate && !endDate && !search && !declaredOnly && !page && !limit) {
      return await this.employeesService.getPayrolls();
    }
    return await this.employeesService.getPayrolls({
      company,
      startDate,
      endDate,
      dateType,
      search,
      declaredOnly,
      page,
      limit,
    });
  }

  @Post('employees/payroll')
  @UseGuards(PayrollAuthGuard)
  async createPayroll(@Body() data: any) {
    return await this.employeesService.createPayroll(data);
  }

  @Post('employees/payroll/preview')
  @UseGuards(PayrollAuthGuard)
  async previewPayroll(@Body() data: Record<string, unknown>) {
    return await this.employeesService.previewPayroll(data);
  }

  @Delete('employees/payroll/:id')
  @UseGuards(PayrollAuthGuard)
  async deletePayroll(@Param('id') id: string) {
    return await this.employeesService.deletePayroll(Number(id));
  }

  // ==========================================
  // SETTINGS (Global Shift Times)
  // ==========================================
  @Get('settings')
  @UseGuards(PayrollAuthGuard)
  async getSettings(@Headers('x-company') company?: string) {
    return await this.employeesService.getSettings(company);
  }

  @Post('settings')
  @UseGuards(PayrollAuthGuard)
  async updateSettings(@Body() data: any) {
    return await this.employeesService.updateSettings(data);
  }

  // ==========================================
  // ADMINS / USER CONTROL
  // ==========================================
  @Get('admins')
  @UseGuards(AdminAuthGuard)
  async getAdmins() {
    return await prisma.admin.findMany();
  }

  @Post('admins')
  @UseGuards(AdminAuthGuard)
  async createAdmin(@Body() data: any) {
    if (data.password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(data.password, salt);
    }
    return await prisma.admin.create({ data });
  }

  @Patch('admins/:id')
  @UseGuards(AdminAuthGuard)
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

  @Get('employees/attendance/audit-lunch')
  @UseGuards(PayrollAuthGuard)
  async auditLunchDeductions(@Headers('x-company') company?: string) {
    return await this.employeesService.auditHistoricalAttendance(company);
  }

  @Get('employees/payroll/audit-tax')
  @UseGuards(PayrollAuthGuard)
  async auditPayrollTax(@Headers('x-company') company?: string) {
    return await this.employeesService.auditHistoricalPayrollTax(company);
  }

  @Post('employees/payroll/recalculate-tax')
  @UseGuards(PayrollAuthGuard)
  async recalculatePayrollTax(
    @Body() body: { company?: string; payrollIds?: number[]; dryRun?: boolean },
  ) {
    return await this.employeesService.recalculateHistoricalPayrollTax(body);
  }

  @Post('employees/attendance/recalculate-lunch')
  @UseGuards(PayrollAuthGuard)
  async recalculateLunchDeductions(@Body() body: { company?: string; recordIds?: number[]; dryRun?: boolean }) {
    return await this.employeesService.recalculateHistoricalAttendance(body);
  }
  
  @Delete('admins/:id')
  @UseGuards(AdminAuthGuard)
  async deleteAdmin(@Param('id') id: string) {
    return await prisma.admin.delete({
      where: { id: Number(id) }
    });
  }
}
