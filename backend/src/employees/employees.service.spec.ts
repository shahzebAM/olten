import { calculateAttendanceMetrics } from './attendance-calculator';
import { calculatePhilippinePayrollTax } from './employees.service';
import {
  filterAndAggregatePayrollRecords,
  toManilaDateYMD,
} from './employees.service';
describe('Attendance & Lunch Deduction Calculator', () => {
  it('Prompt Test Case: Oct 1, 2026 (09:02 AM to 11:56 AM) -> 2h 54m, 0m lunch, 2.90 hrs', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '09:02',
      timeOut: '11:56',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
    });

    expect(res.grossMinutes).toBe(174);
    expect(res.actualFormatted).toBe('2h 54m');
    expect(res.lunchDeductionMinutes).toBe(0);
    expect(res.regularMinutes).toBe(174);
    expect(res.regularFormatted).toBe('2h 54m');
    expect(res.decimalHours).toBe('2.90');
  });

  it('Full-day shift (08:00 AM to 05:00 PM) deducts full 60m overlapping lunch -> 8h 0m (8.00 hrs)', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '08:00',
      timeOut: '17:00',
    });

    expect(res.grossMinutes).toBe(540);
    expect(res.lunchDeductionMinutes).toBe(60);
    expect(res.netMinutes).toBe(480);
    expect(res.regularFormatted).toBe('8h');
    expect(res.decimalHours).toBe('8.00');
  });

  describe('Tax Reports Module — Date Filter, Employee Search & Dynamic Total Collected', () => {
  const mockEmployees = [
    {
      id: 1,
      employeeId: 'EMP-001',
      firstName: 'Zerwa',
      middleName: 'Isabel',
      lastName: 'Mughal',
      company: 'Surgicom',
    },
    {
      id: 2,
      employeeId: 'EMP-002',
      firstName: 'Juan',
      middleName: 'Santos',
      lastName: 'Dela Cruz',
      company: 'Surgicom',
    },
    {
      id: 3,
      employeeId: 'EMP-003',
      firstName: 'Maria',
      middleName: null,
      lastName: 'Clara',
      company: 'OtherCorp',
    },
  ];

  const mockPayrolls = [
    {
      id: 101,
      employeeId: 1,
      daysWorked: 13,
      totalHours: 104,
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 750,
      philhealthDeduct: 0,
      pagIbigDeduct: 0,
      tax: 2254.10,
      netPay: 20995.90,
      // 2026-10-05 00:30 AM in Asia/Manila (2026-10-04T16:30:00Z in UTC)
      createdAt: '2026-10-04T16:30:00.000Z',
      cutoffStart: '2026-10-01',
      cutoffEnd: '2026-10-15',
    },
    {
      id: 102,
      employeeId: 1,
      daysWorked: 13,
      totalHours: 104,
      grossPay: 24250,
      sssDeduction: 1000,
      sssProvident: 750,
      philhealthDeduct: 0,
      pagIbigDeduct: 0,
      tax: 2104.10,
      netPay: 20395.90,
      // 2026-10-20 02:00 PM in Asia/Manila
      createdAt: '2026-10-20T06:00:00.000Z',
      cutoffStart: '2026-10-16',
      cutoffEnd: '2026-10-31',
    },
    {
      id: 103,
      employeeId: 2,
      daysWorked: 13,
      totalHours: 104,
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 0,
      philhealthDeduct: 0,
      pagIbigDeduct: 0,
      tax: 2404.10,
      netPay: 21595.90,
      createdAt: '2026-10-10T04:00:00.000Z',
      cutoffStart: '2026-10-01',
      cutoffEnd: '2026-10-15',
    },
    {
      id: 104,
      employeeId: 3, // Unauthorized company (OtherCorp)
      daysWorked: 13,
      totalHours: 104,
      grossPay: 30000,
      sssDeduction: 1000,
      sssProvident: 0,
      philhealthDeduct: 0,
      pagIbigDeduct: 0,
      tax: 3404.10,
      netPay: 25595.90,
      createdAt: '2026-10-10T04:00:00.000Z',
    },
  ];

  it('1 & 12. No filter + Security: Displays all authorized company records and blocks unauthorized company records', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(3);
    expect(res.data.every(r => r.employeeId !== 3)).toBe(true);
    // 2254.10 + 2104.10 + 2404.10 = 6762.30
    expect(res.totalCollected).toBe(6762.30);
  });

  it('2 & 10. Specific date & Asia/Manila timezone boundary: Matches Oct 5 Manila time even when UTC is Oct 4', () => {
    expect(toManilaDateYMD('2026-10-04T16:30:00.000Z')).toBe('2026-10-05');
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      startDate: '2026-10-05',
      endDate: '2026-10-05',
      dateType: 'payroll_date',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(1);
    expect(res.data[0].id).toBe(101);
    expect(res.totalCollected).toBe(2254.10);
  });

  it('3. Date range: Displays records within Oct 1 to Oct 15, 2026', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      dateType: 'payroll_date',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(2); // IDs 103 and 101
    expect(res.totalCollected).toBe(4658.20); // 2254.10 + 2404.10
  });

  it('4, 6 & 9. Employee search + Multiple records + Dynamic Total Collected: Searching "  zerwa  " returns both Zerwa records totaling ₱4,358.20', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      search: '  zerwa  ',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(2);
    expect(res.totalCollected).toBe(4358.20); // 2254.10 + 2104.10
  });

  it('5 & 9. Combined filtering: Oct 1 to Oct 15, 2026 + search "ZERWA" returns only record #101 with Total Collected = ₱2,254.10', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      startDate: '2026-10-01',
      endDate: '2026-10-15',
      search: 'ZERWA',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(1);
    expect(res.data[0].id).toBe(101);
    expect(res.totalCollected).toBe(2254.10);
  });

  it('7. No results: Returns empty array and 0.00 total when no records match', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      search: 'NON_EXISTENT_EMPLOYEE',
      declaredOnly: true,
    });
    expect(res.totalCount).toBe(0);
    expect(res.data).toEqual([]);
    expect(res.totalCollected).toBe(0);
  });

  it('11. Pagination: Preserves accurate Total Collected across all matching pages even when limit=1', () => {
    const res = filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
      company: 'Surgicom',
      search: 'Isabel', // middle name search for Zerwa Isabel Mughal
      declaredOnly: true,
      page: 1,
      limit: 1,
    });
    expect(res.data.length).toBe(1);
    expect(res.totalCount).toBe(2);
    expect(res.totalPages).toBe(2);
    expect(res.totalCollected).toBe(4358.20);
  });

  it('Rejects invalid date ranges where Date From is later than Date To', () => {
    expect(() =>
      filterAndAggregatePayrollRecords(mockPayrolls, mockEmployees, {
        company: 'Surgicom',
        startDate: '2026-10-20',
        endDate: '2026-10-01',
      }),
    ).toThrow('Invalid date range: Date From cannot be later than Date To.');
  });
});

  it('Half-day afternoon (clocks in at 01:00 PM after lunch ends) deducts 0m lunch -> 4h (4.00 hrs)', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '13:00',
      timeOut: '17:00',
    });

    expect(res.grossMinutes).toBe(240);
    expect(res.lunchDeductionMinutes).toBe(0);
    expect(res.netMinutes).toBe(240);
    expect(res.decimalHours).toBe('4.00');
  });

  it('Partial lunch overlap: clocks out during lunch (08:00 AM to 12:30 PM) deducts only 30m -> 4h (4.00 hrs)', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '08:00',
      timeOut: '12:30',
    });

    expect(res.grossMinutes).toBe(270);
    expect(res.lunchDeductionMinutes).toBe(30);
    expect(res.netMinutes).toBe(240);
    expect(res.decimalHours).toBe('4.00');
  });

  it('Partial lunch overlap: clocks in during lunch (12:20 PM to 05:00 PM) deducts only 40m -> 4h (4.00 hrs) without double-counting late arrival', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '12:20',
      timeOut: '17:00',
    });

    expect(res.grossMinutes).toBe(280);
    expect(res.lunchDeductionMinutes).toBe(40);
    expect(res.netMinutes).toBe(240);
    expect(res.lateMinutes).toBe(240); // 8:00 to 12:00 (excluding 12:00-12:20 lunch)
    expect(res.decimalHours).toBe('4.00');
  });


describe('Philippine BIR Withholding Tax Calculator (2023+ Semi-Monthly Table)', () => {
  it('Test A: Mandatory contributions included (ZERWA ISABEL MUGHAL: Gross ₱25,000, SSS ₱1,000, Mandatory SSS Provident ₱750)', () => {
    const result = calculatePhilippinePayrollTax({
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 750,
      isSssProvidentMandatory: true,
      isDeclared: true,
    });

    expect(result.taxableIncome).toBe(23250.00);
    expect(result.withholdingTax).toBe(2254.10);
    expect(result.totalDeductions).toBe(4004.10);
    expect(result.netPay).toBe(20995.90);
  });

  it('Test B: Without contributions (Gross ₱25,000, all contributions ₱0)', () => {
    const result = calculatePhilippinePayrollTax({
      grossPay: 25000,
      sssDeduction: 0,
      sssProvident: 0,
      philhealthDeduct: 0,
      pagIbigDeduct: 0,
      isDeclared: true,
    });

    expect(result.taxableIncome).toBe(25000.00);
    expect(result.withholdingTax).toBe(2604.10);
    expect(result.totalDeductions).toBe(2604.10);
    expect(result.netPay).toBe(22395.90);
  });

  it('Test C: Only SSS deducted (Gross ₱25,000, SSS ₱1,000, SSS Provident ₱0)', () => {
    const result = calculatePhilippinePayrollTax({
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 0,
      isDeclared: true,
    });

    expect(result.taxableIncome).toBe(24000.00);
    expect(result.withholdingTax).toBe(2404.10);
    expect(result.totalDeductions).toBe(3404.10);
    expect(result.netPay).toBe(21595.90);
  });

  it('Includes PhilHealth and Pag-IBIG mandatory contributions in tax-exempt deductions but excludes loans and cash advances', () => {
    const result = calculatePhilippinePayrollTax({
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 750,
      philhealthDeduct: 500,
      pagIbigDeduct: 200,
      cashAdvance: 1000,
      sssSalaryLoan: 500,
      isDeclared: true,
    });

    // Taxable Income = 25,000 - (1,000 + 750 + 500 + 200) = 22,550.00 (loans & cash advance excluded from tax exemption)
    expect(result.taxableIncome).toBe(22550.00);
    // Tax = 937.50 + (22,550 - 16,667) * 0.20 = 937.50 + 1,176.60 = 2,114.10
    expect(result.withholdingTax).toBe(2114.10);
    // Total Deductions = 2,450 (mandatory) + 1,500 (loans/adv) + 2,114.10 (tax) = 6,064.10
    expect(result.totalDeductions).toBe(6064.10);
    expect(result.netPay).toBe(18935.90);
  });

  it('Does not treat voluntary provident contributions as tax-exempt when isSssProvidentMandatory is false', () => {
    const result = calculatePhilippinePayrollTax({
      grossPay: 25000,
      sssDeduction: 1000,
      sssProvident: 750,
      isSssProvidentMandatory: false,
      isDeclared: true,
    });

    expect(result.taxableIncome).toBe(24000.00);
    expect(result.withholdingTax).toBe(2404.10);
    // Still deducted once from net pay
    expect(result.totalDeductions).toBe(4154.10);
    expect(result.netPay).toBe(20845.90);
  });

  it('Verifies all 6 BIR semi-monthly tax brackets and boundary values', () => {
    // Bracket 1: <= 10,417 (0%)
    expect(calculatePhilippinePayrollTax({ grossPay: 10000 }).withholdingTax).toBe(0.00);
    // Bracket 2: 10,417 - 16,666 (0 + 15% over 10,417)
    expect(calculatePhilippinePayrollTax({ grossPay: 15000 }).withholdingTax).toBe(687.45);
    // Bracket 3: 16,667 - 33,332 (937.50 + 20% over 16,667)
    expect(calculatePhilippinePayrollTax({ grossPay: 16667 }).withholdingTax).toBe(937.50);
    // Bracket 4: 33,333 - 83,332 (4,270.70 + 25% over 33,333)
    expect(calculatePhilippinePayrollTax({ grossPay: 50000 }).withholdingTax).toBe(8437.45);
    // Bracket 5: 83,333 - 333,332 (16,770.70 + 30% over 83,333)
    expect(calculatePhilippinePayrollTax({ grossPay: 150000 }).withholdingTax).toBe(36770.80);
    // Bracket 6: >= 333,333 (91,770.70 + 35% over 333,333)
    expect(calculatePhilippinePayrollTax({ grossPay: 500000 }).withholdingTax).toBe(150104.15);
  });
});

  it('Supports custom employee schedules and configurable lunch breaks (10:00 to 19:00, lunch 14:00 to 15:00)', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '10:00',
      timeOut: '13:30',
      shiftStart: '10:00',
      shiftEnd: '19:00',
      lunchStart: '14:00',
      lunchEnd: '15:00',
    });

    expect(res.lunchDeductionMinutes).toBe(0);
    expect(res.netMinutes).toBe(210);
    expect(res.decimalHours).toBe('3.50');
  });

  it('Handles overnight attendance records across midnight (09:03 AM to 12:38 AM next day)', () => {
    const res = calculateAttendanceMetrics({
      timeIn: '09:03',
      timeOut: '00:38',
      shiftStart: '08:00',
      shiftEnd: '17:00',
      lunchStart: '12:00',
      lunchEnd: '13:00',
    });

    expect(res.grossMinutes).toBe(935); // 15h 35m
    expect(res.lunchDeductionMinutes).toBe(60); // 12:00 PM - 1:00 PM overlap
    expect(res.netMinutes).toBe(875); // 14h 35m
    expect(res.regularMinutes).toBe(480); // 8h reg
    expect(res.otMinutes).toBe(395); // 6h 35m OT
  });
});