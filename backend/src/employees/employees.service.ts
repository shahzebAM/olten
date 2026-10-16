import { Injectable, BadRequestException } from '@nestjs/common';
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
      const hasExplicitCutoff = Boolean(pr.cutoffStart && pr.cutoffEnd);

      if (dateType === 'cutoff' && hasExplicitCutoff) {
        const cStart = toManilaDateYMD(pr.cutoffStart);
        const cEnd = toManilaDateYMD(pr.cutoffEnd);
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

  const enriched = matched.map(pr => {
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
      cutoffStart: pr.cutoffStart || null,
      cutoffEnd: pr.cutoffEnd || null,
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
// ==========================================
  // PAYROLLS
  // ==========================================
  async getPayrolls(query?: PayrollFilterQuery) {
    const allPayrolls = await prisma.payroll.findMany();
    if (!query || Object.keys(query).length === 0) {
      return allPayrolls;
    }
    const employees = await prisma.employee.findMany();
    return filterAndAggregatePayrollRecords(allPayrolls, employees, query);
  }

  async createPayroll(data: any) {
    const isDeclared =
      data.isDeclared !== undefined ? Boolean(data.isDeclared) : Number(data.tax || 0) > 0;

    const computed = calculatePhilippinePayrollTax({
      grossPay: data.grossPay || 0,
      sssDeduction: data.sssDeduction || 0,
      pagIbigDeduct: data.pagIbigDeduct || 0,
      philhealthDeduct: data.philhealthDeduct || 0,
      sssProvident: data.sssProvident || 0,
      isSssProvidentMandatory: data.isSssProvidentMandatory ?? true,
      isDeclared,
      cashAdvance: data.cashAdvance || 0,
      companyLoan: data.companyLoan || 0,
      pagIbigLoan: data.pagIbigLoan || 0,
      pagIbigHousingLoan: data.pagIbigHousingLoan || 0,
      sssSalaryLoan: data.sssSalaryLoan || 0,
      sssCalamityLoan: data.sssCalamityLoan || 0,
      pagIbigCalamity: data.pagIbigCalamity || 0,
      pagIbigSalaryLoan: data.pagIbigSalaryLoan || 0,
    });

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
      } 
    });
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
    const allPayrolls = await prisma.payroll.findMany();
    const employees = await prisma.employee.findMany();
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