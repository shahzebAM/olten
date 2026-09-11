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
    // Explicitly mapping fields to ensure the new loan parameters are safely written
    return await prisma.employee.create({ 
      data: {
        employeeId: data.employeeId,
        firstName: data.firstName,
        middleName: data.middleName,
        lastName: data.lastName,
        company: data.company,
        dateOfBirth: data.dateOfBirth,
        address: data.address,
        civilStatus: data.civilStatus,
        baseRate: data.baseRate,
        employmentStatus: data.employmentStatus,
        tin: data.tin,
        sssNumber: data.sssNumber,
        philhealth: data.philhealth,
        pagIbig: data.pagIbig,
        bankAccount: data.bankAccount,
        cashAdvanceBalance: data.cashAdvanceBalance || 0,
        cashAdvanceInstallment: data.cashAdvanceInstallment || 0,
        // --- NEW LOAN FIELDS ---
        loanBalance: data.loanBalance || 0,
        loanInstallment: data.loanInstallment || 0,
      } 
    });
  }

  async updateEmployee(id: number, data: any) {
    // Strips the 'id' field out of the data payload so Prisma doesn't throw an error
    const { id: _id, ...cleanData } = data;
    return await prisma.employee.update({
      where: { id },
      data: cleanData,
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
    const { id: _id, ...cleanData } = data;
    return await prisma.attendance.update({
      where: { id },
      data: cleanData,
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
    return await prisma.payroll.findMany(); 
  }

  async createPayroll(data: any) {
    return await prisma.payroll.create({ 
      data: {
        employeeId: data.employeeId,
        daysWorked: data.daysWorked,
        totalHours: data.totalHours,
        cashAdvance: data.cashAdvance || 0,
        // --- NEW LOAN FIELD ---
        companyLoan: data.companyLoan || 0,
        sssDeduction: data.sssDeduction || 0,
        pagIbigDeduct: data.pagIbigDeduct || 0,
        philhealthDeduct: data.philhealthDeduct || 0,
        tax: data.tax || 0,
        grossPay: data.grossPay,
        netPay: data.netPay,
        pagIbigLoan: data.pagIbigLoan || 0,
        pagIbigHousingLoan: data.pagIbigHousingLoan || 0,
        sssProvident: data.sssProvident || 0,
        sssSalaryLoan: data.sssSalaryLoan || 0,
        sssCalamityLoan: data.sssCalamityLoan || 0,
        pagIbigCalamity: data.pagIbigCalamity || 0,
        pagIbigSalaryLoan: data.pagIbigSalaryLoan || 0,
      } 
    });
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
    
    if (!settings) {
      settings = await prisma.settings.create({
        data: { shiftStart: "08:00", shiftEnd: "17:00" }
      });
    }
    return settings;
  }

  async updateSettings(data: any) {
    const existing = await prisma.settings.findFirst();
    
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