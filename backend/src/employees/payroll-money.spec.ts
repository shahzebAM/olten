import {
  calculatePayrollAmounts,
  multiplyPayrollCents,
  roundPayrollMoney,
  toPayrollMoneyCents,
} from './payroll-money';

describe('exact decimal payroll currency calculations', () => {
  const base = {
    basicSalary: 9060,
    daysWorked: 12,
    ratePerDay: 755,
    overtimeMinutes: 0,
    undertimeMinutes: 0,
  };

  it('fixes the independent 18h24m overtime half-cent boundary', () => {
    // 755 / 8 * 1.25 * (1104 / 60) = 2170.625 exactly.
    expect(calculatePayrollAmounts({ ...base, overtimeMinutes: 1104 })).toEqual(
      { otPay: 2170.63, undertimeDeduction: 0, grossPay: 11230.63 },
    );
  });

  it('rounds exact half-cent deductions and tax rates consistently', () => {
    expect(toPayrollMoneyCents(1.005)).toBe(101);
    expect(toPayrollMoneyCents(-1.005)).toBe(-101);
    expect(multiplyPayrollCents(330, 0.35)).toBe(116);
    expect(multiplyPayrollCents(-330, 0.35)).toBe(-116);
  });

  it('reconciles the approved Benjo reference with 667 overtime minutes', () => {
    // 755 * 667 * 5 / 1920 = 1311.4192708333... .
    expect(calculatePayrollAmounts({ ...base, overtimeMinutes: 667 })).toEqual({
      otPay: 1311.42,
      undertimeDeduction: 0,
      grossPay: 10371.42,
    });
  });

  it('deducts a shortage at the normal hourly rate', () => {
    // 755 * 80 / 480 = 125.8333333... ; no overtime premium applies.
    expect(calculatePayrollAmounts({ ...base, undertimeMinutes: 80 })).toEqual({
      otPay: 0,
      undertimeDeduction: 125.83,
      grossPay: 8934.17,
    });
  });

  it('retains the unrounded components until gross is calculated', () => {
    // OT rounds to 0.01, but (2 * 1.25 - 1) / 480 is only 0.003125.
    expect(
      calculatePayrollAmounts({
        ...base,
        basicSalary: 1,
        ratePerDay: 1,
        overtimeMinutes: 2,
        undertimeMinutes: 1,
      }),
    ).toEqual({ otPay: 0.01, undertimeDeduction: 0, grossPay: 1 });
  });

  it('uses the exact original salary divisor when the daily rate repeats', () => {
    // 1.20 / 7 * 1.25 * (56 / 60) / 8 = 0.025 exactly.
    expect(
      calculatePayrollAmounts({
        ...base,
        basicSalary: 1.2,
        daysWorked: 7,
        ratePerDay: 1.2 / 7,
        rateSource: { amount: 1.2, days: 7 },
        overtimeMinutes: 56,
      }),
    ).toEqual({ otPay: 0.03, undertimeDeduction: 0, grossPay: 1.23 });
  });

  it('uses basic salary divided by paid days when no daily rate is supplied', () => {
    expect(
      calculatePayrollAmounts({
        ...base,
        basicSalary: 1.2,
        daysWorked: 7,
        ratePerDay: undefined,
        overtimeMinutes: 56,
      }),
    ).toEqual({ otPay: 0.03, undertimeDeduction: 0, grossPay: 1.23 });
  });

  it('rounds negative adjustments away from zero at an exact half-cent', () => {
    expect(
      calculatePayrollAmounts({
        ...base,
        basicSalary: 0,
        govHolidayAmt: -1.005,
      }),
    ).toEqual({ otPay: 0, undertimeDeduction: 0, grossPay: -1.01 });
  });

  it.each([
    [1.004, 1],
    [1.005, 1.01],
    [1.006, 1.01],
    [-1.004, -1],
    [-1.005, -1.01],
    [-1.006, -1.01],
    [1.005e3, 1005],
    [1e-7, 0],
    [-1e-7, 0],
    [1234567890.125, 1234567890.13],
    [0, 0],
  ])('rounds the decimal %s to %s', (input, expected) => {
    expect(roundPayrollMoney(input)).toBe(expected);
  });

  it('keeps a zero-day fallback rate at zero', () => {
    expect(
      calculatePayrollAmounts({
        ...base,
        basicSalary: 100,
        daysWorked: 0,
        ratePerDay: undefined,
        overtimeMinutes: 60,
        undertimeMinutes: 60,
      }),
    ).toEqual({ otPay: 0, undertimeDeduction: 0, grossPay: 100 });
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects a non-finite amount %s',
    (input) => {
      expect(() => roundPayrollMoney(input)).toThrow(RangeError);
    },
  );

  it.each([-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid paid-minute counts %s',
    (value) => {
      expect(() =>
        calculatePayrollAmounts({ ...base, overtimeMinutes: value }),
      ).toThrow(RangeError);
    },
  );

  it.each([0, -1, Infinity])(
    'rejects an invalid original rate divisor %s',
    (days) => {
      expect(() =>
        calculatePayrollAmounts({ ...base, rateSource: { amount: 755, days } }),
      ).toThrow(RangeError);
    },
  );

  it('rejects values whose cents cannot be represented safely', () => {
    expect(() => roundPayrollMoney(1e20)).toThrow(RangeError);
  });

  it('does not mutate calculation inputs', () => {
    const input = { ...base, rateSource: { amount: 9060, days: 12 } };
    const before = structuredClone(input);
    calculatePayrollAmounts(input);
    expect(input).toEqual(before);
  });
});
