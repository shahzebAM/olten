import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { resolvePayrollBasis, validatePayrollProfile } from './payroll-profile';
import type { Attendance, Settings } from '@prisma/client';
import type { AttendanceCalcResult } from './attendance-calculator';
import {
  aggregateAttendanceRecords,
  attendanceSessionKey,
  calculateAttendanceMetrics,
  calculateAttendancePayroll,
  parseTimeToMinutes,
  toAttendanceDateYMD,
} from './attendance-calculator';
export {
  calculateAttendanceMetrics,
  formatMinutesToHM,
  getIntervalOverlapMinutes,
  parseTimeToMinutes,
} from './attendance-calculator';
export type {
  AttendanceCalcOptions,
  AttendanceCalcResult,
} from './attendance-calculator';

const prisma = new PrismaClient();
type PayrollDatabase = Pick<
  Prisma.TransactionClient,
  'employee' | 'attendance' | 'settings' | 'payroll'
>;

type AttendanceWriteInput = Partial<
  Omit<Attendance, 'id' | 'createdAt' | 'employeeId'>
> & {
  employeeId?: number | string;
  id?: number;
};

type PayrollCutoffSource = {
  cutoffStart?: string | Date | null;
  cutoffEnd?: string | Date | null;
  attendanceSummary?: { cutoffStart?: string; cutoffEnd?: string } | null;
};

const getPayrollCutoff = (payroll: PayrollCutoffSource) => ({
  cutoffStart:
    payroll.cutoffStart ?? payroll.attendanceSummary?.cutoffStart ?? null,
  cutoffEnd: payroll.cutoffEnd ?? payroll.attendanceSummary?.cutoffEnd ?? null,
});

// ==========================================
// PHILIPPINE BIR WITHHOLDING TAX CALCULATOR
// ==========================================

export interface TaxBracket {
  id: number;
  min: number;
  baseTax: number;
  rate: number;
  excessOver: number;
}

export const BIR_SEMI_MONTHLY_TAX_BRACKETS: TaxBracket[] = [
  { id: 1, min: 0, baseTax: 0, rate: 0, excessOver: 0 },
  { id: 2, min: 10417, baseTax: 0, rate: 0.15, excessOver: 10417 },
  { id: 3, min: 16667, baseTax: 937.5, rate: 0.20, excessOver: 16667 },
  { id: 4, min: 33333, baseTax: 4270.7, rate: 0.25, excessOver: 33333 },
  { id: 5, min: 83333, baseTax: 16770.7, rate: 0.30, excessOver: 83333 },
  { id: 6, min: 333333, baseTax: 91770.7, rate: 0.35, excessOver: 333333 },
];

export interface PayrollTaxInput {
  grossPay: number;
  sssDeduction?: number;
  philhealthDeduct?: number;
  pagIbigDeduct?: number;
  sssProvident?: number;
  isSssProvidentMandatory?: boolean; // defaults to true (mandatory WISP/MPF share)
  isDeclared?: boolean;              // defaults to true when computing BIR tax
  cashAdvance?: number;
  companyLoan?: number;
  pagIbigLoan?: number;
  pagIbigHousingLoan?: number;
  sssSalaryLoan?: number;
  sssCalamityLoan?: number;
  pagIbigCalamity?: number;
  pagIbigSalaryLoan?: number;
  brackets?: TaxBracket[];
}

export interface PayrollTaxResult {
  grossPay: number;
  mandatoryContributions: number;
  nonExemptDeductions: number;
  taxableIncome: number;
  withholdingTax: number;
  totalDeductions: number;
  netPay: number;
  bracketMin: number;
  rate: number;
  minTax: number;
  taxBase: number;
}

export const toMoneyCents = (val: any): number => {
  const num = typeof val === 'number' ? val : parseFloat(String(val ?? '0'));
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
};

// ==========================================
// TAX REPORT FILTERING & TIMEZONE HELPERS
// ==========================================

export interface PayrollFilterQuery {
  company?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  dateType?: 'payroll_date' | 'cutoff';
  search?: string;
  declaredOnly?: boolean | string;
  page?: number | string;
  limit?: number | string;
}

/**
 * Converts a Date or ISO timestamp into a YYYY-MM-DD string in Philippine Time (Asia/Manila, UTC+8).
 */
export const toManilaDateYMD = (dateInput?: Date | string | null): string => {
  if (!dateInput) return '';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
};

export const matchesEmployeeSearch = (emp: any, rawSearch?: string): boolean => {
  if (!rawSearch || !rawSearch.trim()) return true;
  if (!emp) return false;
  const query = rawSearch.trim().toLowerCase().replace(/\s+/g, ' ');
  const first = (emp.firstName || '').trim().toLowerCase();
  const middle = (emp.middleName || '').trim().toLowerCase();
  const last = (emp.lastName || '').trim().toLowerCase();
  const empCode = String(emp.employeeId || '').trim().toLowerCase();
  const sysId = String(emp.id || '').trim().toLowerCase();

  const fullFML = [first, middle, last].filter(Boolean).join(' ');
  const fullFL = [first, last].filter(Boolean).join(' ');
  const fullLF = [last, first].filter(Boolean).join(', ');
  const fullLFM = [last, first, middle].filter(Boolean).join(' ');

  return (
    first.includes(query) ||
    middle.includes(query) ||
    last.includes(query) ||
    empCode.includes(query) ||
    sysId === query ||
    fullFML.includes(query) ||
    fullFL.includes(query) ||
    fullLF.includes(query) ||
    fullLFM.includes(query)
  );
};

export const filterAndAggregatePayrollRecords = (
  payrolls: any[],
  employees: any[],
  query: PayrollFilterQuery = {},
  taxBrackets: TaxBracket[] = BIR_SEMI_MONTHLY_TAX_BRACKETS,
) => {
  const startDate = query.startDate?.trim() || '';
  const endDate = query.endDate?.trim() || '';
  const dateType = query.dateType === 'cutoff' ? 'cutoff' : 'payroll_date';
  const declaredOnly =
    query.declaredOnly === true || String(query.declaredOnly).toLowerCase() === 'true';

  if (startDate && endDate && startDate > endDate) {
    throw new BadRequestException('Invalid date range: Date From cannot be later than Date To.');
  }

  const empMap = new Map<number, any>(employees.map(e => [Number(e.id), e]));

  const matched = payrolls.filter(pr => {
    const emp = empMap.get(Number(pr.employeeId));

    // 1. Strict company / workspace isolation
    if (query.company) {
      if (!emp || emp.company !== query.company) return false;
    }

    // 2. Declared tax filter (for Tax Computation Report)
    if (declaredOnly && !(Number(pr.tax || 0) > 0)) {
      return false;
    }

    // 3. Employee name / ID search
    if (!matchesEmployeeSearch(emp, query.search)) {
      return false;
    }

    // 4. Inclusive date-range filter in Asia/Manila timezone
    if (startDate || endDate) {
      const { cutoffStart, cutoffEnd } = getPayrollCutoff(
        pr as PayrollCutoffSource,
      );
      const hasExplicitCutoff = Boolean(cutoffStart && cutoffEnd);

      if (dateType === 'cutoff' && hasExplicitCutoff) {
        const cStart = toManilaDateYMD(cutoffStart);
        const cEnd = toManilaDateYMD(cutoffEnd);
        if (startDate && cEnd < startDate) return false;
        if (endDate && cStart > endDate) return false;
      } else {
        const recordManilaDate = toManilaDateYMD(pr.createdAt);
        if (!recordManilaDate) return false;
        if (startDate && recordManilaDate < startDate) return false;
        if (endDate && recordManilaDate > endDate) return false;
      }
    }

    return true;
  });

  // Sort chronologically (newest first, deterministic tie-breaker by id)
  matched.sort((a, b) => {
    const tA = new Date(a.createdAt || 0).getTime();
    const tB = new Date(b.createdAt || 0).getTime();
    return tB !== tA ? tB - tA : Number(b.id) - Number(a.id);
  });

  // Calculate Total Collected across ALL matching records (even across pagination pages)
  let totalCollectedCents = 0;
  let totalTaxableIncomeCents = 0;

  const enriched = matched.map((pr) => {
    const emp = empMap.get(Number(pr.employeeId));
    const taxCalc = calculatePhilippinePayrollTax({
      grossPay: pr.grossPay,
      sssDeduction: pr.sssDeduction,
      philhealthDeduct: pr.philhealthDeduct,
      pagIbigDeduct: pr.pagIbigDeduct,
      sssProvident: pr.sssProvident || 0,
      isSssProvidentMandatory: true,
      isDeclared: Number(pr.tax || 0) > 0,
      brackets: taxBrackets,
    });

    // Preserve stored payroll tax if already finalized; also expose bracket breakdown
    const effectiveTaxCents = toMoneyCents(pr.tax ?? taxCalc.withholdingTax);
    totalCollectedCents += effectiveTaxCents;
    totalTaxableIncomeCents += toMoneyCents(taxCalc.taxableIncome);

    return {
      ...pr,
      payrollDateManila: toManilaDateYMD(pr.createdAt),
      ...getPayrollCutoff(pr as PayrollCutoffSource),
      taxBreakdown: {
        taxableIncome: taxCalc.taxableIncome,
        bracketMin: taxCalc.bracketMin,
        taxBase: taxCalc.taxBase,
        rate: taxCalc.rate,
        taxOnExcess: fromMoneyCents(
          Math.max(0, effectiveTaxCents - toMoneyCents(taxCalc.minTax)),
        ),
        minTax: taxCalc.minTax,
        withholdingTax: fromMoneyCents(effectiveTaxCents),
      },
    };
  });

  const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
  const limit = Math.max(1, parseInt(String(query.limit || '5000'), 10) || 5000);
  const totalCount = enriched.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const paginatedData = enriched.slice((page - 1) * limit, page * limit);

  return {
    data: paginatedData,
    totalCount,
    totalCollected: fromMoneyCents(totalCollectedCents),
    totalTaxableIncome: fromMoneyCents(totalTaxableIncomeCents),
    page,
    limit,
    totalPages,
  };
};

export const fromMoneyCents = (cents: number): number => {
  return Math.round(cents) / 100;
};

export const calculatePhilippinePayrollTax = (
  input: PayrollTaxInput,
): PayrollTaxResult => {
  const brackets = input.brackets?.length ? input.brackets : BIR_SEMI_MONTHLY_TAX_BRACKETS;
  const isDeclared = input.isDeclared !== undefined ? Boolean(input.isDeclared) : true;
  const isSssProvidentMandatory =
    input.isSssProvidentMandatory !== undefined ? Boolean(input.isSssProvidentMandatory) : true;

  const grossCents = toMoneyCents(input.grossPay);
  const sssCents = Math.max(0, toMoneyCents(input.sssDeduction));
  const philhealthCents = Math.max(0, toMoneyCents(input.philhealthDeduct));
  const pagIbigCents = Math.max(0, toMoneyCents(input.pagIbigDeduct));
  const sssProvidentCents = Math.max(0, toMoneyCents(input.sssProvident));

  // Only mandatory employee statutory contributions reduce taxable income
  const exemptProvidentCents = isSssProvidentMandatory ? sssProvidentCents : 0;
  const mandatoryContributionsCents =
    sssCents + philhealthCents + pagIbigCents + exemptProvidentCents;

  const taxableIncomeCents = Math.max(0, grossCents - mandatoryContributionsCents);

  let taxCents = 0;
  let bracketMin = 0;
  let rate = 0;
  let minTax = 0;
  let excessCents = 0;

  if (isDeclared && taxableIncomeCents > 0) {
    const sorted = [...brackets].sort((a, b) => b.min - a.min);
    const applicable =
      sorted.find(b => taxableIncomeCents >= toMoneyCents(b.min)) || sorted[sorted.length - 1];
    excessCents = Math.max(0, taxableIncomeCents - toMoneyCents(applicable.excessOver));
    const baseTaxCents = toMoneyCents(applicable.baseTax);
    taxCents = Math.max(0, baseTaxCents + Math.round(excessCents * Number(applicable.rate)));
    bracketMin = applicable.min;
    rate = applicable.rate;
    minTax = applicable.baseTax;
  }

  // Loans, cash advances, and non-mandatory deductions are NOT tax-exempt, deducted once from Net Pay
  const nonExemptDeductionsCents =
    Math.max(0, toMoneyCents(input.cashAdvance)) +
    Math.max(0, toMoneyCents(input.companyLoan)) +
    Math.max(0, toMoneyCents(input.pagIbigLoan)) +
    Math.max(0, toMoneyCents(input.pagIbigHousingLoan)) +
    Math.max(0, toMoneyCents(input.sssSalaryLoan)) +
    Math.max(0, toMoneyCents(input.sssCalamityLoan)) +
    Math.max(0, toMoneyCents(input.pagIbigCalamity)) +
    Math.max(0, toMoneyCents(input.pagIbigSalaryLoan)) +
    (isSssProvidentMandatory ? 0 : sssProvidentCents);

  const totalDeductionsCents =
    mandatoryContributionsCents + nonExemptDeductionsCents + taxCents;
  const netPayCents = grossCents - totalDeductionsCents;

  return {
    grossPay: fromMoneyCents(grossCents),
    mandatoryContributions: fromMoneyCents(mandatoryContributionsCents),
    nonExemptDeductions: fromMoneyCents(nonExemptDeductionsCents),
    taxableIncome: fromMoneyCents(taxableIncomeCents),
    withholdingTax: fromMoneyCents(taxCents),
    totalDeductions: fromMoneyCents(totalDeductionsCents),
    netPay: fromMoneyCents(netPayCents),
    bracketMin,
    rate,
    minTax,
    taxBase: fromMoneyCents(excessCents),
  };
};

@Injectable()
export class EmployeesService {
  
  // ==========================================
  // EMPLOYEES
  // ==========================================
  async getEmployees(company?: string) {
    return company
      ? await prisma.employee.findMany({ where: { company } })
      : await prisma.employee.findMany();
  }

  async createEmployee(data: any) {
    const payrollProfile = (data as Record<string, unknown>).payrollProfile;
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
        ...(payrollProfile !== undefined
          ? {
              payrollProfile:
                this.checkedPayrollProfile(payrollProfile) ?? Prisma.DbNull,
            }
          : {}),
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
    const employeePatch = cleanData as Record<string, unknown>;
    const payrollProfile = employeePatch.payrollProfile;
    if (payrollProfile !== undefined)
      employeePatch.payrollProfile =
        this.checkedPayrollProfile(payrollProfile) ?? Prisma.DbNull;
    
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
  async getAttendances(company?: string) {
    const [logs, employees] = await Promise.all([
      prisma.attendance.findMany({
        where: company ? { employee: { company } } : undefined,
      }),
      prisma.employee.findMany({ where: company ? { company } : undefined }),
    ]);
    const result: Array<
      (typeof logs)[number] & { metrics: AttendanceCalcResult }
    > = [];
    const settingsByCompany = new Map<
      string,
      Awaited<ReturnType<EmployeesService['getSettings']>>
    >();
    for (const employee of employees) {
      if (company && employee.company !== company) continue;
      const employeeLogs = logs.filter((log) => log.employeeId === employee.id);
      if (!employeeLogs.length) continue;
      let settings = settingsByCompany.get(employee.company);
      if (!settings) {
        settings = await this.getSettings(employee.company);
        settingsByCompany.set(employee.company, settings);
      }
      const summary = aggregateAttendanceRecords(employeeLogs, settings);
      result.push(
        ...summary.records.map((log) => ({ ...log, hours: log.metrics.total })),
      );
    }
    return result;
  }

  private async computeNormalizedAttendanceData(
    data: AttendanceWriteInput,
    existingRecord?: Attendance,
  ) {
    const employeeId = Number(data.employeeId ?? existingRecord?.employeeId);
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0) {
      throw new BadRequestException('A valid employee is required.');
    }
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new BadRequestException('Employee not found.');
    const date = toAttendanceDateYMD(data.date ?? existingRecord?.date);
    if (!date)
      throw new BadRequestException('A valid attendance date is required.');
    const settings = await this.getSettings(employee.company);
    const normalizePunch = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value !== 'string')
        throw new BadRequestException('Invalid attendance time.');
      const text = value.trim().toUpperCase();
      if (['LEAVE', 'PAID', 'UNPAID'].includes(text)) return text;
      const minutes = parseTimeToMinutes(text);
      if (minutes === null)
        throw new BadRequestException('Invalid attendance time.');
      return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    };
    const timeIn = normalizePunch(
      data.timeIn !== undefined ? data.timeIn : existingRecord?.timeIn,
    );
    const timeOut = normalizePunch(
      data.timeOut !== undefined ? data.timeOut : existingRecord?.timeOut,
    );
    if (
      (timeIn === 'LEAVE' && !['PAID', 'UNPAID'].includes(timeOut)) ||
      (timeIn !== 'LEAVE' &&
        (['PAID', 'UNPAID', 'LEAVE'].includes(timeIn) ||
          ['PAID', 'UNPAID', 'LEAVE'].includes(timeOut)))
    ) {
      throw new BadRequestException('Invalid leave attendance.');
    }
    const sourceValue = <K extends keyof AttendanceWriteInput>(field: K) =>
      data[field] !== undefined ? data[field] : existingRecord?.[field];
    const shiftStart = normalizePunch(
      sourceValue('shiftStart') || settings.shiftStart,
    );
    const shiftEnd = normalizePunch(
      sourceValue('shiftEnd') || settings.shiftEnd,
    );
    const lunchStart = normalizePunch(
      sourceValue('lunchStart') ?? settings.lunchStart,
    );
    const lunchEnd = normalizePunch(
      sourceValue('lunchEnd') ?? settings.lunchEnd,
    );
    const breakOut = normalizePunch(sourceValue('breakOut')) || null;
    const breakIn = normalizePunch(sourceValue('breakIn')) || null;
    if (
      [shiftStart, shiftEnd, lunchStart, lunchEnd, breakOut, breakIn].some(
        (time) => time && parseTimeToMinutes(time) === null,
      )
    ) {
      throw new BadRequestException('Invalid shift or break time.');
    }
    const override = sourceValue('lunchOverrideMinutes');
    const lunchOverrideMinutes =
      override === null || override === undefined ? null : Number(override);
    if (
      lunchOverrideMinutes !== null &&
      (!Number.isInteger(lunchOverrideMinutes) ||
        lunchOverrideMinutes < 0 ||
        lunchOverrideMinutes > 2147483647)
    ) {
      throw new BadRequestException(
        'Lunch override must be a non-negative integer number of minutes.',
      );
    }
    const metrics = calculateAttendanceMetrics({
      timeIn,
      timeOut,
      shiftStart,
      shiftEnd,
      lunchStart,
      lunchEnd,
      breakOut,
      breakIn,
      lunchOverrideMinutes,
    });
    return {
      employeeId,
      date,
      timeIn,
      timeOut,
      shiftStart,
      shiftEnd,
      lunchStart,
      lunchEnd,
      breakOut,
      breakIn,
      lunchOverrideMinutes,
      reason:
        data.reason !== undefined
          ? data.reason
          : (existingRecord?.reason ?? null),
      hours: timeIn === 'LEAVE' ? (timeOut === 'PAID' ? 8 : 0) : metrics.total,
    };
  }

  async createAttendance(data: any) {
    const normalized = await this.computeNormalizedAttendanceData(
      data as AttendanceWriteInput,
    );
    const existing = await prisma.attendance.findMany({
      where: { employeeId: normalized.employeeId },
    });
    const duplicate = existing.find(
      (log) => attendanceSessionKey(log) === attendanceSessionKey(normalized),
    );
    if (duplicate) return duplicate;
    return await prisma.attendance.create({ data: normalized });
  }

  async updateAttendance(id: number, data: any) {
    const { id: _id, ...cleanData } = data as AttendanceWriteInput;
    const existing = await prisma.attendance.findUnique({ where: { id } });
    if (!existing)
      throw new BadRequestException('Attendance record not found.');
    const normalized = await this.computeNormalizedAttendanceData(
      cleanData,
      existing,
    );
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
    const [allLogs, employees, recalculated] = await Promise.all([
      prisma.attendance.findMany(company ? { where: { employee: { company } } } : undefined),
      prisma.employee.findMany(company ? { where: { company } } : undefined),
      this.getAttendances(company),
    ]);
    const sourceById = new Map(allLogs.map((log) => [log.id, log]));
    const employeeById = new Map(
      employees.map((employee) => [employee.id, employee]),
    );
    const affectedRecords = recalculated.flatMap((log) => {
      const source = sourceById.get(log.id);
      if (!source) return [];
      const previousMinutes = Math.round((Number(source.hours) || 0) * 60);
      const correctedMinutes = Math.round(log.hours * 60);
      if (previousMinutes === correctedMinutes) return [];
      const employee = employeeById.get(log.employeeId);
      return [
        {
          id: log.id,
          employeeId: log.employeeId,
          employeeName: employee
            ? employee.lastName + ', ' + employee.firstName
            : 'ID #' + log.employeeId,
          date: log.date,
          timeIn: log.timeIn,
          timeOut: log.timeOut,
          previousHours: Number(source.hours) || 0,
          correctedHours: log.hours,
          previousMinutes,
          correctedMinutes,
          lunchDeductionMinutes: log.metrics.lunchDeductionMinutes,
          differenceMinutes: correctedMinutes - previousMinutes,
        },
      ];
    });
    return {
      totalScanned: recalculated.length,
      affectedCount: affectedRecords.length,
      affectedRecords,
    };
  }

  async recalculateHistoricalAttendance(options: {
    company?: string;
    recordIds?: number[];
    dryRun?: boolean;
  }) {
    const audit = await this.auditHistoricalAttendance(options?.company);
    const targets = options?.recordIds?.length
      ? audit.affectedRecords.filter((r) => options.recordIds!.includes(r.id))
      : audit.affectedRecords;

    if (options?.dryRun !== false) {
      return { mode: 'DRY_RUN', updatedCount: 0, preview: targets };
    }
    if (!options.recordIds?.length) {
      throw new BadRequestException(
        'Review the attendance audit and supply explicit recordIds before applying corrections.',
      );
    }

    const recalculated = await this.getAttendances(options.company);
    let updatedCount = 0;
    for (const item of targets) {
      const log = recalculated.find((record) => record.id === item.id);
      if (!log) continue;
      await prisma.attendance.update({
        where: { id: log.id },
        data: { hours: log.hours },
      });
      updatedCount++;
    }

    return { mode: 'APPLIED', updatedCount, updatedRecords: targets };
  }

// ==========================================
  // PAYROLLS
  // ==========================================
// ==========================================
  // PAYROLLS
  // ==========================================
  async getPayrolls(query?: PayrollFilterQuery) {
    const allPayrolls = query?.company
      ? await prisma.payroll.findMany({ where: { employee: { company: query.company } } })
      : await prisma.payroll.findMany();
    if (!query || Object.keys(query).length === 0) {
      return allPayrolls;
    }
    const employees = query.company
      ? await prisma.employee.findMany({ where: { company: query.company } })
      : await prisma.employee.findMany();
    return filterAndAggregatePayrollRecords(allPayrolls, employees, query);
  }

  private checkedPayrollProfile(value: unknown) {
    try {
      return validatePayrollProfile(value);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pay profile.',
      );
    }
  }

  async previewPayroll(data: Record<string, unknown>) {
    return this.preparePayroll(data, prisma);
  }

  private async preparePayroll(
    data: Record<string, unknown>,
    database: PayrollDatabase,
  ) {
    const employeeId = Number(data.employeeId);
    const cutoffStart = toAttendanceDateYMD(
      typeof data.cutoffStart === 'string' ? data.cutoffStart : null,
    );
    const cutoffEnd = toAttendanceDateYMD(
      typeof data.cutoffEnd === 'string' ? data.cutoffEnd : null,
    );
    if (!Number.isSafeInteger(employeeId) || employeeId <= 0)
      throw new BadRequestException('A valid employee is required.');
    if (!cutoffStart || !cutoffEnd || cutoffStart > cutoffEnd) {
      throw new BadRequestException(
        'A valid payroll cutoff start and end are required.',
      );
    }
    const employee = await database.employee.findUnique({
      where: { id: employeeId },
    });
    if (!employee) throw new BadRequestException('Employee not found.');
    if (data.company !== undefined && data.company !== employee.company)
      throw new BadRequestException(
        'Employee does not belong to this company.',
      );
    const settings = await this.getSettings(employee.company, database);
    const logs = await database.attendance.findMany({ where: { employeeId } });
    const profile = this.checkedPayrollProfile(employee.payrollProfile ?? null);
    let basis: ReturnType<typeof resolvePayrollBasis> | null = null;
    if (profile) {
      try {
        basis = resolvePayrollBasis(
          profile,
          employee.baseRate,
          cutoffStart,
          cutoffEnd,
        );
      } catch (error) {
        throw new BadRequestException(
          error instanceof Error ? error.message : 'Invalid payroll basis.',
        );
      }
    }
    const daysWorked = basis?.paidDays ?? Number(data.daysWorked);
    if (!Number.isFinite(daysWorked) || daysWorked < 0)
      throw new BadRequestException(
        'Valid non-negative working days are required.',
      );
    const govHolidayAmt = Number(data.govHolidayAmt ?? 0);
    if (!Number.isFinite(govHolidayAmt))
      throw new BadRequestException('Invalid holiday adjustment.');
    const calculated = calculateAttendancePayroll(logs, {
      ...settings,
      employeeId,
      startDate: cutoffStart,
      endDate: cutoffEnd,
      daysWorked,
      basicSalary: basis?.basicSalary ?? employee.baseRate,
      overtimeBasis: profile?.overtimeBasis ?? 'CUTOFF_NET',
      ...(basis ? { ratePerDay: basis.ratePerDay } : {}),
      govHolidayAmt,
    });
    const selected = logs.filter((log) => {
      const date = toAttendanceDateYMD(log.date);
      return date >= cutoffStart && date <= cutoffEnd;
    });
    const datesOf = (predicate: (log: (typeof logs)[number]) => boolean) =>
      new Set(
        selected.filter(predicate).map((log) => toAttendanceDateYMD(log.date)),
      ).size;
    const source = {
      fetchedAt: new Date().toISOString(),
      attendanceDateCount: datesOf(() => true),
      workedDateCount: datesOf((log) => {
        const start = parseTimeToMinutes(log.timeIn);
        const end = parseTimeToMinutes(log.timeOut);
        return start !== null && end !== null && start !== end;
      }),
      paidLeaveDateCount: datesOf(
        (log) =>
          log.timeIn.toUpperCase() === 'LEAVE' &&
          log.timeOut.toUpperCase() === 'PAID',
      ),
      unpaidLeaveDateCount: datesOf(
        (log) =>
          log.timeIn.toUpperCase() === 'LEAVE' &&
          log.timeOut.toUpperCase() === 'UNPAID',
      ),
      sessionCount: selected.length,
    };
    const attendanceSummary = {
      ...calculated,
      ...(profile && basis
        ? {
            version: 2,
            payrollProfile: profile,
            paidDays: basis.paidDays,
            scheduledDates: basis.scheduledDates,
            workedDateCount: source.workedDateCount,
            paidLeaveDateCount: source.paidLeaveDateCount,
            unpaidLeaveDateCount: source.unpaidLeaveDateCount,
            sourceSessionCount: source.sessionCount,
          }
        : {}),
    };
    const isDeclared =
      data.isDeclared !== undefined
        ? Boolean(data.isDeclared)
        : Number(data.tax || 0) > 0;

    const deduction = (key: string) => {
      const amount = Number(data[key] ?? 0);
      if (!Number.isFinite(amount) || amount < 0)
        throw new BadRequestException(`Invalid ${key} deduction.`);
      return amount;
    };

    const computed = calculatePhilippinePayrollTax({
      grossPay: attendanceSummary.grossPay,
      sssDeduction: deduction('sssDeduction'),
      pagIbigDeduct: deduction('pagIbigDeduct'),
      philhealthDeduct: deduction('philhealthDeduct'),
      sssProvident: deduction('sssProvident'),
      isSssProvidentMandatory:
        data.isSssProvidentMandatory === undefined
          ? true
          : Boolean(data.isSssProvidentMandatory),
      isDeclared,
      cashAdvance: deduction('cashAdvance'),
      companyLoan: deduction('companyLoan'),
      pagIbigLoan: deduction('pagIbigLoan'),
      pagIbigHousingLoan: deduction('pagIbigHousingLoan'),
      sssSalaryLoan: deduction('sssSalaryLoan'),
      sssCalamityLoan: deduction('sssCalamityLoan'),
      pagIbigCalamity: deduction('pagIbigCalamity'),
      pagIbigSalaryLoan: deduction('pagIbigSalaryLoan'),
    });

    const previewFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          employee: {
            id: employee.id,
            company: employee.company,
            baseRate: employee.baseRate,
            profile,
            cashAdvanceBalance: employee.cashAdvanceBalance,
            loanBalance: employee.loanBalance,
          },
          settings: {
            shiftStart: settings.shiftStart,
            shiftEnd: settings.shiftEnd,
            lunchStart: settings.lunchStart,
            lunchEnd: settings.lunchEnd,
          },
          cutoffStart,
          cutoffEnd,
          logs: [...logs]
            .sort((a, b) => a.id - b.id)
            .map((log) => ({
              id: log.id,
              employeeId: log.employeeId,
              date: log.date,
              timeIn: log.timeIn,
              timeOut: log.timeOut,
              shiftStart: log.shiftStart,
              shiftEnd: log.shiftEnd,
              lunchStart: log.lunchStart,
              lunchEnd: log.lunchEnd,
              breakOut: log.breakOut,
              breakIn: log.breakIn,
              lunchOverrideMinutes: log.lunchOverrideMinutes,
            })),
        }),
      )
      .digest('hex');
    return {
      employee: {
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        company: employee.company,
        baseRate: employee.baseRate,
        payrollProfile: profile,
        cashAdvanceBalance: employee.cashAdvanceBalance,
        cashAdvanceInstallment: employee.cashAdvanceInstallment,
        loanBalance: employee.loanBalance,
        loanInstallment: employee.loanInstallment,
      },
      attendanceSummary,
      computed,
      source,
      configurationRequired: profile === null,
      previewFingerprint,
    };
  }

  async createPayroll(data: any) {
    const input = data as Record<string, unknown>;
    const previewFingerprint = input.previewFingerprint;
    const save = async (database: PayrollDatabase) => {
      const preview = await this.preparePayroll(
        data as Record<string, unknown>,
        database,
      );
      if (
        previewFingerprint !== undefined &&
        previewFingerprint !== preview.previewFingerprint
      )
        throw new ConflictException(
          'Attendance, pay profile or shift settings changed. Refresh the payroll preview before saving.',
        );
      const { attendanceSummary, computed } = preview;

      return await database.payroll.create({
        data: {
          employeeId: preview.employee.id,
          daysWorked: attendanceSummary.requiredMinutes / 480,
          totalHours: attendanceSummary.totalMinutes / 60,
          attendanceSummary,
          cashAdvance: data.cashAdvance || 0,
          companyLoan: data.companyLoan || 0,
          sssDeduction: data.sssDeduction || 0,
          pagIbigDeduct: data.pagIbigDeduct || 0,
          philhealthDeduct: data.philhealthDeduct || 0,
          tax: computed.withholdingTax,
          grossPay: computed.grossPay,
          netPay: computed.netPay,
          pagIbigLoan: data.pagIbigLoan || 0,
          pagIbigHousingLoan: data.pagIbigHousingLoan || 0,
          sssProvident: data.sssProvident || 0,
          sssSalaryLoan: data.sssSalaryLoan || 0,
          sssCalamityLoan: data.sssCalamityLoan || 0,
          pagIbigCalamity: data.pagIbigCalamity || 0,
          pagIbigSalaryLoan: data.pagIbigSalaryLoan || 0,
        },
      });
    };
    if (previewFingerprint === undefined) return save(prisma);
    try {
      return await prisma.$transaction(save, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      )
        throw new ConflictException(
          'Attendance, pay profile or shift settings changed. Refresh the payroll preview before saving.',
        );
      throw error;
    }
  }

  async deletePayroll(id: number) {
    return await prisma.payroll.delete({
      where: { id },
    });
  }

  // ==========================================
  // HISTORICAL PAYROLL TAX AUDIT & SAFE RECALCULATION
  // ==========================================
  async auditHistoricalPayrollTax(company?: string) {
    const allPayrolls = company
      ? await prisma.payroll.findMany({ where: { employee: { company } } })
      : await prisma.payroll.findMany();
    const employees = company
      ? await prisma.employee.findMany({ where: { company } })
      : await prisma.employee.findMany();
    const empMap = new Map(employees.map(e => [e.id, e]));

    const discrepancies: any[] = [];

    for (const pr of allPayrolls) {
      const emp = empMap.get(pr.employeeId);
      if (company && emp && emp.company !== company) continue;

      const isDeclared = Number(pr.tax || 0) > 0;
      const expected = calculatePhilippinePayrollTax({
        grossPay: pr.grossPay,
        sssDeduction: pr.sssDeduction,
        philhealthDeduct: pr.philhealthDeduct,
        pagIbigDeduct: pr.pagIbigDeduct,
        sssProvident: pr.sssProvident,
        isSssProvidentMandatory: true,
        isDeclared,
        cashAdvance: pr.cashAdvance,
        companyLoan: pr.companyLoan,
        pagIbigLoan: pr.pagIbigLoan,
        pagIbigHousingLoan: pr.pagIbigHousingLoan,
        sssSalaryLoan: pr.sssSalaryLoan,
        sssCalamityLoan: pr.sssCalamityLoan,
        pagIbigCalamity: pr.pagIbigCalamity,
        pagIbigSalaryLoan: pr.pagIbigSalaryLoan,
      });

      const storedTaxCents = toMoneyCents(pr.tax);
      const expectedTaxCents = toMoneyCents(expected.withholdingTax);
      const storedNetCents = toMoneyCents(pr.netPay);
      const expectedNetCents = toMoneyCents(expected.netPay);

      if (storedTaxCents !== expectedTaxCents || storedNetCents !== expectedNetCents) {
        discrepancies.push({
          payrollId: pr.id,
          employeeId: pr.employeeId,
          employeeName: emp ? `${emp.firstName} ${emp.lastName}` : `ID #${pr.employeeId}`,
          createdAt: pr.createdAt,
          grossPay: pr.grossPay,
          sssDeduction: pr.sssDeduction,
          sssProvident: pr.sssProvident,
          expectedTaxableIncome: expected.taxableIncome,
          storedTax: fromMoneyCents(storedTaxCents),
          expectedTax: expected.withholdingTax,
          taxDifference: fromMoneyCents(storedTaxCents - expectedTaxCents),
          storedNetPay: fromMoneyCents(storedNetCents),
          expectedNetPay: expected.netPay,
        });
      }
    }

    return {
      totalScanned: allPayrolls.length,
      discrepancyCount: discrepancies.length,
      discrepancies,
    };
  }

  async recalculateHistoricalPayrollTax(options: {
    company?: string;
    payrollIds?: number[];
    dryRun?: boolean;
  }) {
    const audit = await this.auditHistoricalPayrollTax(options?.company);
    const targets = options?.payrollIds?.length
      ? audit.discrepancies.filter(d => options.payrollIds!.includes(d.payrollId))
      : audit.discrepancies;

    if (options?.dryRun !== false) {
      return { mode: 'DRY_RUN', updatedCount: 0, preview: targets };
    }

    let updatedCount = 0;
    for (const item of targets) {
      await prisma.payroll.update({
        where: { id: item.payrollId },
        data: {
          tax: item.expectedTax,
          netPay: item.expectedNetPay,
        },
      });
      updatedCount++;
    }

    return { mode: 'APPLIED', updatedCount, updatedRecords: targets };
  }

  // ==========================================
  // SETTINGS (Global Shift Times)
  // ==========================================
  async getSettings(
    company?: string,
    database: Pick<Prisma.TransactionClient, 'settings'> = prisma,
  ) {
    const requestedCompany = company?.trim() || 'Global';
    const configured = await database.settings.findUnique({
      where: { company: requestedCompany },
    });
    if (configured) return configured;
    const fallback =
      requestedCompany === 'Global'
        ? null
        : await database.settings.findUnique({ where: { company: 'Global' } });
    return (
      fallback ?? {
        id: 0,
        company: 'Global',
        shiftStart: '08:00',
        shiftEnd: '17:00',
        lunchStart: '12:00',
        lunchEnd: '13:00',
      }
    );
  }

  async updateSettings(data: any) {
    const input = data as Partial<
      Pick<
        Settings,
        'company' | 'shiftStart' | 'shiftEnd' | 'lunchStart' | 'lunchEnd'
      >
    >;
    const company = input.company?.trim() || 'Global';
    const schedule = {
      shiftStart: input.shiftStart,
      shiftEnd: input.shiftEnd,
      lunchStart: input.lunchStart,
      lunchEnd: input.lunchEnd,
    };
    for (const field of Object.keys(schedule) as Array<keyof typeof schedule>) {
      if (schedule[field] === undefined) continue;
      const minutes = parseTimeToMinutes(schedule[field]);
      if (minutes === null)
        throw new BadRequestException('Invalid shift or lunch time.');
      schedule[field] =
        `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    }
    return await prisma.settings.upsert({
      where: { company },
      create: { company, ...schedule },
      update: schedule,
    });
  }
}
