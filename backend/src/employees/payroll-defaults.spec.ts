import {
  resolveEffectivePayrollProfile,
  resolvePayrollBasis,
  validatePayrollDefaults,
  validatePayrollProfile,
  type PayrollDefaults,
  type PayrollProfile,
} from './payroll-profile';

const legacy: PayrollProfile = {
  version: 1,
  basis: 'DAILY',
  dailyRate: 755,
  paidDayBasis: 'SCHEDULED',
  workingWeekdays: [1, 2, 3, 4, 5, 6],
};

const company: PayrollDefaults = {
  version: 1,
  workingWeekdays: [1, 2, 3, 4, 5],
  overtimeBasis: 'DAILY',
};

describe('company payroll defaults and explicit employee rule sources', () => {
  it.each([undefined, null])(
    'returns fresh baseline defaults for %s',
    (value) => {
      const first = validatePayrollDefaults(value);
      const second = validatePayrollDefaults(value);
      expect(first).toEqual({
        version: 1,
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        overtimeBasis: 'CUTOFF_NET',
      });
      expect(first).not.toBe(second);
      expect(first.workingWeekdays).not.toBe(second.workingWeekdays);
      first.workingWeekdays.push(0);
      expect(validatePayrollDefaults(value).workingWeekdays).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    },
  );

  it('normalizes a valid company schedule without mutating its source', () => {
    const input = {
      version: 1,
      workingWeekdays: [6, 0, 1],
      overtimeBasis: 'CUTOFF_NET',
    };
    const before = structuredClone(input);
    const result = validatePayrollDefaults(input);
    expect(result).toEqual({
      version: 1,
      workingWeekdays: [0, 1, 6],
      overtimeBasis: 'CUTOFF_NET',
    });
    expect(input).toEqual(before);
    result.workingWeekdays.push(2);
    expect(input.workingWeekdays).toEqual([6, 0, 1]);
  });

  it.each([
    false,
    1,
    'defaults',
    [],
    {},
    { ...company, version: 2 },
    { ...company, version: '1' },
    { ...company, overtimeBasis: undefined },
    { ...company, overtimeBasis: null },
    { ...company, overtimeBasis: 'WEEKLY' },
    { ...company, workingWeekdays: undefined },
    { ...company, workingWeekdays: [] },
    { ...company, workingWeekdays: [1, 1] },
    { ...company, workingWeekdays: [7] },
    { ...company, workingWeekdays: [-1] },
    { ...company, workingWeekdays: [1.5] },
    { ...company, workingWeekdays: ['1'] },
    { ...company, workingWeekdays: [NaN] },
    { ...company, dailyRate: 755 },
    { ...company, rulesSource: 'COMPANY' },
  ])('rejects malformed or unsupported company defaults: %j', (input) => {
    expect(() => validatePayrollDefaults(input)).toThrow(Error);
  });

  it('retains omitted legacy rule sources and overtime fields exactly', () => {
    expect(validatePayrollProfile(legacy)).toEqual(legacy);
    expect(resolveEffectivePayrollProfile(legacy, company)).toEqual(legacy);
    expect(resolveEffectivePayrollProfile(legacy, company)).not.toHaveProperty(
      'rulesSource',
    );
    expect(resolveEffectivePayrollProfile(legacy, company)).not.toHaveProperty(
      'overtimeBasis',
    );
  });

  it.each(['COMPANY', 'EMPLOYEE'] as const)(
    'accepts explicit %s rule sources',
    (rulesSource) => {
      expect(validatePayrollProfile({ ...legacy, rulesSource })).toEqual({
        ...legacy,
        rulesSource,
      });
    },
  );

  it.each([null, false, 1, '', 'company', 'GLOBAL', 'MANUAL'])(
    'rejects unsupported rule source %j',
    (rulesSource) => {
      expect(() => validatePayrollProfile({ ...legacy, rulesSource })).toThrow(
        Error,
      );
    },
  );

  it('applies only company schedule and overtime rules to an opted-in profile', () => {
    const input = {
      ...legacy,
      rulesSource: 'COMPANY',
      overtimeBasis: 'CUTOFF_NET',
    };
    const beforeProfile = structuredClone(input);
    const beforeDefaults = structuredClone(company);
    const result = resolveEffectivePayrollProfile(input, company);
    expect(result).toEqual({
      ...input,
      workingWeekdays: [1, 2, 3, 4, 5],
      overtimeBasis: 'DAILY',
    });
    expect(input).toEqual(beforeProfile);
    expect(company).toEqual(beforeDefaults);
    result!.workingWeekdays.push(0);
    expect(company.workingWeekdays).toEqual(beforeDefaults.workingWeekdays);
  });

  it('keeps an explicit employee schedule and overtime independent of company changes', () => {
    const input = {
      ...legacy,
      rulesSource: 'EMPLOYEE',
      overtimeBasis: 'CUTOFF_NET',
    };
    expect(resolveEffectivePayrollProfile(input, company)).toEqual(input);
    expect(
      resolveEffectivePayrollProfile(input, {
        ...company,
        workingWeekdays: [0, 6],
      }),
    ).toEqual(input);
    // An employee-specific profile does not consume company defaults.
    expect(resolveEffectivePayrollProfile(input, { malformed: true })).toEqual(
      input,
    );
  });

  it('resolves default company rules when an opted-in profile has no stored defaults', () => {
    const input = {
      ...legacy,
      workingWeekdays: [0, 6],
      overtimeBasis: 'DAILY',
      rulesSource: 'COMPANY',
    };
    expect(resolveEffectivePayrollProfile(input)).toEqual({
      ...input,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      overtimeBasis: 'CUTOFF_NET',
    });
  });

  it('re-resolves company rules without rewriting the original saved profile', () => {
    const input = { ...legacy, rulesSource: 'COMPANY' };
    const before = structuredClone(input);
    const first = resolveEffectivePayrollProfile(input, company);
    const second = resolveEffectivePayrollProfile(input, {
      ...company,
      workingWeekdays: [0, 1, 2, 3, 4],
      overtimeBasis: 'CUTOFF_NET',
    });
    expect(first?.workingWeekdays).toEqual([1, 2, 3, 4, 5]);
    expect(second?.workingWeekdays).toEqual([0, 1, 2, 3, 4]);
    expect(first?.overtimeBasis).toBe('DAILY');
    expect(second?.overtimeBasis).toBe('CUTOFF_NET');
    expect(input).toEqual(before);
  });

  it('preserves cutoff salary and its required fixed divisor invariant', () => {
    const fixed: PayrollProfile = {
      version: 1,
      basis: 'CUTOFF',
      referenceDays: 14,
      paidDayBasis: 'FIXED',
      fixedPaidDays: 14,
      workingWeekdays: [1, 2, 3, 4, 5, 6],
      rulesSource: 'COMPANY',
    };
    const effective = resolveEffectivePayrollProfile(fixed, company)!;
    expect(effective).toEqual({
      ...fixed,
      workingWeekdays: [1, 2, 3, 4, 5],
      overtimeBasis: 'DAILY',
    });
    expect(
      resolvePayrollBasis(effective, 10570, '2026-10-11', '2026-10-25'),
    ).toMatchObject({
      paidDays: 14,
      basicSalary: 10570,
      ratePerDay: 755,
    });
    expect(() =>
      resolveEffectivePayrollProfile({ ...fixed, fixedPaidDays: 12 }, company),
    ).toThrow(Error);
    expect(() =>
      resolveEffectivePayrollProfile(
        { ...fixed, paidDayBasis: 'SCHEDULED' },
        company,
      ),
    ).toThrow(Error);
  });

  it('does not change an agreed daily rate or fixed paid-day basis when using company rules', () => {
    const input = {
      ...legacy,
      paidDayBasis: 'FIXED',
      fixedPaidDays: 12,
      rulesSource: 'COMPANY',
    };
    const effective = resolveEffectivePayrollProfile(input, company)!;
    expect(effective).toMatchObject({
      basis: 'DAILY',
      dailyRate: 755,
      paidDayBasis: 'FIXED',
      fixedPaidDays: 12,
    });
    expect(
      resolvePayrollBasis(effective, 9815, '2026-10-11', '2026-10-25'),
    ).toMatchObject({
      paidDays: 12,
      basicSalary: 9060,
      ratePerDay: 755,
    });
  });

  it('rejects invalid stored profiles before applying valid company rules', () => {
    expect(() =>
      resolveEffectivePayrollProfile(
        { ...legacy, workingWeekdays: [], rulesSource: 'COMPANY' },
        company,
      ),
    ).toThrow(Error);
    expect(() =>
      resolveEffectivePayrollProfile(
        { ...legacy, dailyRate: 0, rulesSource: 'COMPANY' },
        company,
      ),
    ).toThrow(Error);
  });

  it('rejects invalid company rules when the profile actually uses them', () => {
    expect(() =>
      resolveEffectivePayrollProfile(
        { ...legacy, rulesSource: 'COMPANY' },
        { ...company, overtimeBasis: 'WEEKLY' },
      ),
    ).toThrow(Error);
  });

  it('retains the existing null-profile setup requirement', () => {
    expect(resolveEffectivePayrollProfile(null, company)).toBeNull();
    expect(() => resolveEffectivePayrollProfile(undefined, company)).toThrow(
      Error,
    );
  });
});
