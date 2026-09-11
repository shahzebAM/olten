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
    // SECURITY FIX: Forces empty strings to NULL to prevent Unique Constraint crashes
    const sanitize = (val: any) => (val && val.toString().trim() !== '') ? val.toString().trim() : null;

    return await prisma.employee.create({ 
      data: {
        employeeId: data.employeeId,
        firstName: data.firstName,
        middleName: sanitize(data.middleName),
        lastName: data.lastName,
        company: data.company,
        dateOfBirth: data.dateOfBirth,
        address: data.address,
        civilStatus: data.civilStatus,
        baseRate: data.baseRate,
        employmentStatus: data.employmentStatus,
        tin: sanitize(data.tin),
        sssNumber: sanitize(data.sssNumber),
        philhealth: sanitize(data.philhealth),
        pagIbig: sanitize(data.pagIbig),
        bankAccount: sanitize(data.bankAccount),
        cashAdvanceBalance: data.cashAdvanceBalance || 0,
        cashAdvanceInstallment: data.cashAdvanceInstallment || 0,
        loanBalance: data.loanBalance || 0,
        loanInstallment: data.loanInstallment || 0,
      } 
    });
  }

  async updateEmployee(id: number, data: any) {
    const { id: _id, ...cleanData } = data;
    
    // SECURITY FIX: Strip out empty values on updates too
    const sanitize = (val: any) => (val && val.toString().trim() !== '') ? val.toString().trim() : null;
    
    if (cleanData.tin !== undefined) cleanData.tin = sanitize(cleanData.tin);
    if (cleanData.sssNumber !== undefined) cleanData.sssNumber = sanitize(cleanData.sssNumber);
    if (cleanData.philhealth !== undefined) cleanData.philhealth = sanitize(cleanData.philhealth);
    if (cleanData.pagIbig !== undefined) cleanData.pagIbig = sanitize(cleanData.pagIbig);
    if (cleanData.bankAccount !== undefined) cleanData.bankAccount = sanitize(cleanData.bankAccount);
    if (cleanData.middleName !== undefined) cleanData.middleName = sanitize(cleanData.middleName);

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