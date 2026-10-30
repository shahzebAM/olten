type Fraction = { numerator: bigint; denominator: bigint };

export interface PayrollAmountOptions {
  basicSalary: number;
  daysWorked: number;
  ratePerDay?: number;
  /** Preserve an original salary/divisor instead of a rounded daily rate. */
  rateSource?: { amount: number; days: number };
  overtimeMinutes: number;
  undertimeMinutes: number;
  restDayRegularMinutes?: number;
  restDayOvertimeMinutes?: number;
  govHolidayAmt?: number;
}

const decimal = (value: number): Fraction => {
  if (!Number.isFinite(value))
    throw new RangeError('Payroll amounts must be finite numbers.');
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw new RangeError('Invalid payroll decimal amount.');
  const fractionDigits = match[3] ?? '';
  const scale = fractionDigits.length - Number(match[4] ?? 0);
  const sign = match[1] ? -1n : 1n;
  const digits = sign * BigInt(match[2] + fractionDigits);
  return scale < 0
    ? { numerator: digits * 10n ** BigInt(-scale), denominator: 1n }
    : { numerator: digits, denominator: 10n ** BigInt(scale) };
};

const add = (left: Fraction, right: Fraction): Fraction => ({
  numerator:
    left.numerator * right.denominator + right.numerator * left.denominator,
  denominator: left.denominator * right.denominator,
});

const multiply = (left: Fraction, right: Fraction): Fraction => ({
  numerator: left.numerator * right.numerator,
  denominator: left.denominator * right.denominator,
});

const divide = (left: Fraction, right: Fraction): Fraction => {
  if (right.numerator <= 0n)
    throw new RangeError('The payroll rate divisor must be positive.');
  return {
    numerator: left.numerator * right.denominator,
    denominator: left.denominator * right.numerator,
  };
};

const roundedCents = ({ numerator, denominator }: Fraction): number => {
  const negative = numerator < 0n;
  const cents = (negative ? -numerator : numerator) * 100n;
  const rounded =
    cents / denominator + ((cents % denominator) * 2n >= denominator ? 1n : 0n);
  const signed = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(signed))
    throw new RangeError(
      'Payroll amount exceeds the supported cent precision.',
    );
  return signed === 0 ? 0 : signed;
};

const money = (value: Fraction): number => roundedCents(value) / 100;

const minutes = (value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError('Payroll minutes must be non-negative whole minutes.');
  return BigInt(value);
};

/** Decimal half-up at the currency boundary, including negative adjustments. */
export const roundPayrollMoney = (value: number): number =>
  money(decimal(value));

export const toPayrollMoneyCents = (value: number): number =>
  roundedCents(decimal(value));

/** Multiply an integer cent balance by an exact decimal tax rate. */
export const multiplyPayrollCents = (cents: number, rate: number): number => {
  if (!Number.isSafeInteger(cents))
    throw new RangeError('Payroll cents must be whole safe integers.');
  return roundedCents(
    multiply({ numerator: BigInt(cents), denominator: 100n }, decimal(rate)),
  );
};

/**
 * Eight-hour days and 125% ordinary overtime, retaining exact decimal rates
 * through gross pay. Two-decimal display values do not feed the calculation.
 */
export function calculatePayrollAmounts(options: PayrollAmountOptions) {
  const basic = decimal(options.basicSalary);
  let dailyRate: Fraction;
  if (options.rateSource) {
    dailyRate = divide(
      decimal(options.rateSource.amount),
      decimal(options.rateSource.days),
    );
  } else if (
    options.ratePerDay !== undefined &&
    Number.isFinite(options.ratePerDay) &&
    options.ratePerDay > 0
  ) {
    dailyRate = decimal(options.ratePerDay);
  } else {
    dailyRate =
      Number.isFinite(options.daysWorked) && options.daysWorked > 0
        ? divide(basic, decimal(options.daysWorked))
        : decimal(0);
  }
  const overtime = multiply(dailyRate, {
    numerator: minutes(options.overtimeMinutes) * 5n,
    denominator: 1920n,
  });
  const shortage = multiply(dailyRate, {
    numerator: minutes(options.undertimeMinutes),
    denominator: 480n,
  });
  const restDayRegular = multiply(dailyRate, {
    numerator: minutes(options.restDayRegularMinutes ?? 0) * 13n,
    denominator: 4800n,
  });
  const restDayOvertime = multiply(dailyRate, {
    numerator: minutes(options.restDayOvertimeMinutes ?? 0) * 169n,
    denominator: 48000n,
  });
  const restDay = add(restDayRegular, restDayOvertime);
  const gross = add(
    add(add(basic, overtime), restDay),
    add(
      { numerator: -shortage.numerator, denominator: shortage.denominator },
      decimal(options.govHolidayAmt ?? 0),
    ),
  );
  return {
    otPay: money(overtime),
    undertimeDeduction: money(shortage),
    grossPay: money(gross),
    ...(options.restDayRegularMinutes !== undefined ||
    options.restDayOvertimeMinutes !== undefined
      ? {
          restDayRegularPay: money(restDayRegular),
          restDayOvertimePay: money(restDayOvertime),
          restDayPay: money(restDay),
        }
      : {}),
  };
}
