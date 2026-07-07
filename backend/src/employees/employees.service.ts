import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@Injectable()
export class EmployeesService {
  
  // ==========================================
  // EMPLOYEES
  // ==========================================
  async getEmployees() {
    return await prisma.employee.findMany();
  }

  async createEmployee(data: any) {
    return await prisma.employee.create({ data });
  }

  async updateEmployee(id: number, data: any) {
    return await prisma.employee.update({
      where: { id },
      data,
    });
  }

  async deleteEmployee(id: number) {
    return await prisma.employee.delete({
      where: { id },
    });
  }

  // ==========================================
  // ATTENDANCES
  // ==========================================
  async getAttendances() {
    return await prisma.attendance.findMany();
  }

  async createAttendance(data: any) {
    return await prisma.attendance.create({ data });
  }

  async updateAttendance(id: number, data: any) {
    return await prisma.attendance.update({
      where: { id },
      data,
    });
  }

  async deleteAttendance(id: number) {
    return await prisma.attendance.delete({
      where: { id },
    });
  }

  // ==========================================
  // PAYROLLS
  // ==========================================
  async getPayrolls() {
    // Note: Change 'payroll' to 'payrollRecord' if your prisma schema uses that name
    return await prisma.payroll.findMany(); 
  }

  async createPayroll(data: any) {
    return await prisma.payroll.create({ data });
  }

  async deletePayroll(id: number) {
    return await prisma.payroll.delete({
      where: { id },
    });
  }

  // ==========================================
  // SETTINGS (Global Shift Times)
  // ==========================================
  async getSettings() {
    let settings = await prisma.settings.findFirst();
    
    // If database is empty, create a default setting row
    if (!settings) {
      settings = await prisma.settings.create({
        data: { shiftStart: "08:00", shiftEnd: "17:00" }
      });
    }
    return settings;
  }

  async updateSettings(data: any) {
    const existing = await prisma.settings.findFirst();
    
    // Upsert logic: Update if exists, Create if it doesn't
    if (existing) {
      return await prisma.settings.update({
        where: { id: existing.id },
        data: { shiftStart: data.shiftStart, shiftEnd: data.shiftEnd }
      });
    } else {
      return await prisma.settings.create({
        data: { shiftStart: data.shiftStart, shiftEnd: data.shiftEnd }
      });
    }
  }
}