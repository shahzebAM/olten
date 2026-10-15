import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ==========================================
// ATTENDANCE & LUNCH OVERLAP CALCULATOR
// ==========================================

export interface AttendanceCalcOptions {
  timeIn: string;
  timeOut: string;
  shiftStart?: string;                  // default "08:00"
  shiftEnd?: string;                    // default "17:00"
  lunchStart?: string;                  // default "12:00"
  lunchEnd?: string;                    // default "13:00"
  breakOut?: string | null;             // optional actual break-out punch "HH:MM"
  breakIn?: string | null;              // optional actual break-in punch "HH:MM"
  lunchOverrideMinutes?: number | null; // optional approved manual override in minutes
  maxRegularMinutes?: number;           // default 480 (8 hours)
}

export interface AttendanceCalcResult {
  grossMinutes: number;
  lunchDeductionMinutes: number;
  netMinutes: number;
  regularMinutes: number;
  otMinutes: number;
  earlyOtMinutes: number;
  lateOtMinutes: number;
  lateMinutes: number;
  undertimeMinutes: number;
  reg: number;
  ot: number;
  earlyOt: number;
  lateOt: number;
  total: number;
  decimalHours: string;     // e.g. "2.90"
  regularFormatted: string; // e.g. "2h 54m"
  actualFormatted: string;  // e.g. "2h 54m"
}

export const parseTimeToMinutes = (timeStr?: string | null): number | null => {
  if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return null;
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;
  if (period) {
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  }
  return hours * 60 + minutes;
};

export const formatMinutesToHM = (totalMinutes: number): string => {
  const safeMins = Math.max(0, Math.round(totalMinutes));
  if (safeMins === 0) return '0m';
  const h = Math.floor(safeMins / 60);
  const m = safeMins % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
};

export const getIntervalOverlapMinutes = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number => {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
};

export const calculateAttendanceMetrics = (
  options: AttendanceCalcOptions,
): AttendanceCalcResult => {
  const zeroResult: AttendanceCalcResult = {
    grossMinutes: 0,
    lunchDeductionMinutes: 0,
    netMinutes: 0,
    regularMinutes: 0,
    otMinutes: 0,
    earlyOtMinutes: 0,
    lateOtMinutes: 0,
    lateMinutes: 0,
    undertimeMinutes: 0,
    reg: 0,
    ot: 0,
    earlyOt: 0,
    lateOt: 0,
    total: 0,
    decimalHours: '0.00',
    regularFormatted: '0m',
    actualFormatted: '0m',
  };

  const inRaw = parseTimeToMinutes(options.timeIn);
  const outRaw = parseTimeToMinutes(options.timeOut);
  if (inRaw === null || outRaw === null) return zeroResult;

  const sInRaw = parseTimeToMinutes(options.shiftStart || '08:00') ?? 480;
  const sOutRaw = parseTimeToMinutes(options.shiftEnd || '17:00') ?? 1020;
  const lStartRaw = parseTimeToMinutes(options.lunchStart || '12:00');
  const lEndRaw = parseTimeToMinutes(options.lunchEnd || '13:00');
  const maxRegularMinutes = options.maxRegularMinutes ?? 480;

  let tIn = inRaw;
  let tOut = outRaw;
  let sIn = sInRaw;
  let sOut = sOutRaw;

  // Handle overnight rollover in integer minutes (1440 mins = 24 hours)
  if (tOut < tIn) tOut += 1440;
  if (sOut < sIn) sOut += 1440;

  // Align shift window with overnight attendance punches
  if (tIn < sIn && sIn - tIn >= 720) {
    tIn += 1440;
    tOut += 1440;
  } else if (tIn > sOut && tIn - sOut >= 720) {
    tIn -= 1440;
    tOut -= 1440;
  }

  const grossMinutes = Math.max(0, tOut - tIn);
  if (grossMinutes === 0) return zeroResult;

  const computeWindowOverlap = (
    spanStart: number,
    spanEnd: number,
    winStartRaw: number,
    winEndRaw: number,
  ): number => {
    let baseStart = winStartRaw;
    let baseEnd = winEndRaw;
    if (baseEnd < baseStart) baseEnd += 1440;
    const winDuration = Math.max(0, baseEnd - baseStart);
    if (winDuration === 0) return 0;

    let overlapTotal = 0;
    for (const offset of [-1440, 0, 1440]) {
      overlapTotal += getIntervalOverlapMinutes(
        spanStart,
        spanEnd,
        baseStart + offset,
        baseEnd + offset,
      );
    }
    return Math.min(overlapTotal, grossMinutes);
  };

  let lunchDeductionMinutes = 0;

  if (
    options.lunchOverrideMinutes !== undefined &&
    options.lunchOverrideMinutes !== null &&
    !isNaN(Number(options.lunchOverrideMinutes))
  ) {
    lunchDeductionMinutes = Math.max(
      0,
      Math.min(grossMinutes, Math.round(Number(options.lunchOverrideMinutes))),
    );
  } else if (options.breakOut && options.breakIn) {
    const bOutRaw = parseTimeToMinutes(options.breakOut);
    const bInRaw = parseTimeToMinutes(options.breakIn);
    if (bOutRaw !== null && bInRaw !== null) {
      lunchDeductionMinutes = computeWindowOverlap(tIn, tOut, bOutRaw, bInRaw);
    }
  } else if (lStartRaw !== null && lEndRaw !== null) {
    lunchDeductionMinutes = computeWindowOverlap(tIn, tOut, lStartRaw, lEndRaw);
  }

  const netMinutes = Math.max(0, grossMinutes - lunchDeductionMinutes);
  const regularMinutes = Math.min(netMinutes, maxRegularMinutes);
  const otMinutes = Math.max(0, netMinutes - maxRegularMinutes);

  let earlyOtMinutes = 0;
  let lateOtMinutes = 0;
  if (otMinutes > 0) {
    if (tIn < sIn) {
      earlyOtMinutes = Math.min(otMinutes, sIn - tIn);
      lateOtMinutes = otMinutes - earlyOtMinutes;
    } else {
      lateOtMinutes = otMinutes;
    }
  }

  let lateMinutes = 0;
  if (tIn > sIn) {
    const lateLunchOverlap =
      lStartRaw !== null && lEndRaw !== null
        ? computeWindowOverlap(sIn, tIn, lStartRaw, lEndRaw)
        : 0;
    lateMinutes = Math.max(0, tIn - sIn - lateLunchOverlap);
  }

  let undertimeMinutes = 0;
  if (tOut < sOut) {
    const earlyOutLunchOverlap =
      lStartRaw !== null && lEndRaw !== null
        ? computeWindowOverlap(tOut, sOut, lStartRaw, lEndRaw)
        : 0;
    undertimeMinutes = Math.max(0, sOut - tOut - earlyOutLunchOverlap);
  }

  const toDec = (mins: number) => Math.round((mins / 60) * 10000) / 10000;

  return {
    grossMinutes,
    lunchDeductionMinutes,
    netMinutes,
    regularMinutes,
    otMinutes,
    earlyOtMinutes,
    lateOtMinutes,
    lateMinutes,
    undertimeMinutes,
    reg: toDec(regularMinutes),
    ot: toDec(otMinutes),
    earlyOt: toDec(earlyOtMinutes),
    lateOt: toDec(lateOtMinutes),
    total: toDec(netMinutes),
    decimalHours: (netMinutes / 60).toFixed(2),
    regularFormatted: formatMinutesToHM(regularMinutes),
    actualFormatted: formatMinutesToHM(grossMinutes),
  };
};

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

  private async computeNormalizedAttendanceData(data: any, existingRecord?: any) {
    const timeIn = data.timeIn ?? existingRecord?.timeIn ?? '';
    const timeOut = data.timeOut ?? existingRecord?.timeOut ?? '';
    const isLeave = timeIn === 'LEAVE';

    if (isLeave) {
      return {
        ...data,
        hours: timeOut === 'PAID' ? 8 : 0,
      };
    }

    if (timeIn && timeOut && timeIn.includes(':') && timeOut.includes(':')) {
      const settings: any = await this.getSettings();
      const shiftStart = data.shiftStart || existingRecord?.shiftStart || settings?.shiftStart || '08:00';
      const shiftEnd = data.shiftEnd || existingRecord?.shiftEnd || settings?.shiftEnd || '17:00';
      const lunchStart = data.lunchStart || settings?.lunchStart || '12:00';
      const lunchEnd = data.lunchEnd || settings?.lunchEnd || '13:00';

      const metrics = calculateAttendanceMetrics({
        timeIn,
        timeOut,
        shiftStart,
        shiftEnd,
        lunchStart,
        lunchEnd,
        breakOut: data.breakOut,
        breakIn: data.breakIn,
        lunchOverrideMinutes: data.lunchOverrideMinutes,
      });

      const {
        lunchStart: _ls,
        lunchEnd: _le,
        breakOut: _bo,
        breakIn: _bi,
        lunchOverrideMinutes: _lom,
        ...cleanPrismaData
      } = data;

      return {
        ...cleanPrismaData,
        shiftStart,
        shiftEnd,
        hours: metrics.total,
      };
    }

    return data;
  }

  async createAttendance(data: any) {
    const normalized = await this.computeNormalizedAttendanceData(data);
    return await prisma.attendance.create({ data: normalized });
  }

  async updateAttendance(id: number, data: any) {
    const { id: _id, ...cleanData } = data;
    const existing = await prisma.attendance.findUnique({ where: { id } });
    const normalized = await this.computeNormalizedAttendanceData(cleanData, existing);
    return await prisma.attendance.update({
      where: { id },
      data: normalized,
    });
  }

  async deleteAttendance(id: number) {
    return await prisma.attendance.delete({
      where: { id },
    });
  }

  // ==========================================
  // HISTORICAL AUDIT & SAFE RECALCULATION
  // ==========================================
  async auditHistoricalAttendance(company?: string) {
    const settings: any = await this.getSettings();
    const allLogs = await prisma.attendance.findMany();
    const employees = await prisma.employee.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    const affectedRecords: any[] = [];

    for (const log of allLogs) {
      const emp = empMap.get(log.employeeId);
      if (company && emp && emp.company !== company) continue;
      if (!log.timeIn || !log.timeOut || log.timeIn === 'LEAVE' || !log.timeIn.includes(':') || !log.timeOut.includes(':')) {
        continue;
      }

      const calc = calculateAttendanceMetrics({
        timeIn: log.timeIn,
        timeOut: log.timeOut,
        shiftStart: log.shiftStart || settings?.shiftStart || '08:00',
        shiftEnd: log.shiftEnd || settings?.shiftEnd || '17:00',
        lunchStart: settings?.lunchStart || '12:00',
        lunchEnd: settings?.lunchEnd || '13:00',
      });

      const storedMinutes = Math.round((Number(log.hours) || 0) * 60);
      if (storedMinutes !== calc.netMinutes) {
        affectedRecords.push({
          id: log.id,
          employeeId: log.employeeId,
          employeeName: emp ? `${emp.lastName}, ${emp.firstName}` : `ID #${log.employeeId}`,
          date: log.date,
          timeIn: log.timeIn,
          timeOut: log.timeOut,
          previousHours: Number((Number(log.hours) || 0).toFixed(2)),
          correctedHours: Number(calc.decimalHours),
          previousMinutes: storedMinutes,
          correctedMinutes: calc.netMinutes,
          lunchDeductionMinutes: calc.lunchDeductionMinutes,
          differenceMinutes: calc.netMinutes - storedMinutes,
        });
      }
    }

    return {
      totalScanned: allLogs.length,
      affectedCount: affectedRecords.length,
      affectedRecords,
    };
  }

  async recalculateHistoricalAttendance(options: { company?: string; recordIds?: number[]; dryRun?: boolean }) {
    const audit = await this.auditHistoricalAttendance(options.company);
    const targets = options?.recordIds?.length
      ? audit.affectedRecords.filter(r => options.recordIds!.includes(r.id))
      : audit.affectedRecords;

    if (options?.dryRun !== false) {
      return { mode: 'DRY_RUN', updatedCount: 0, preview: targets };
    }

    const settings: any = await this.getSettings();
    let updatedCount = 0;

    for (const item of targets) {
      const log = await prisma.attendance.findUnique({ where: { id: item.id } });
      if (!log) continue;
      const calc = calculateAttendanceMetrics({
        timeIn: log.timeIn,
        timeOut: log.timeOut,
        shiftStart: log.shiftStart || settings?.shiftStart || '08:00',
        shiftEnd: log.shiftEnd || settings?.shiftEnd || '17:00',
        lunchStart: settings?.lunchStart || '12:00',
        lunchEnd: settings?.lunchEnd || '13:00',
      });
      await prisma.attendance.update({
        where: { id: log.id },
        data: { hours: calc.total },
      });
      updatedCount++;
    }

    return { mode: 'APPLIED', updatedCount, updatedRecords: targets };
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
    return {
      ...settings,
    };
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