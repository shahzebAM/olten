type SavedPayslipRecord = {
  daysWorked: number;
  totalHours: number;
  grossPay: number;
  attendanceSummary?: {
    basicSalary?: number;
    ratePerDay?: number;
    ratePerHour?: number;
    totalMinutes?: number;
    requiredMinutes?: number;
    overtimeMinutes?: number;
    undertimeDeduction?: number;
    otPay?: number;
    govHolidayAmt?: number;
  } | null;
};

const amount = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const nonNegative = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
const money = (value: number) => {
  const cents = Math.round(value * 100);
  return cents === 0 ? 0 : cents / 100;
};

export function getSavedPayslipBreakdown(
  record: SavedPayslipRecord,
  currentSalary: number,
) {
  const saved = record.attendanceSummary;
  if (saved) {
    const basicSalary = amount(saved.basicSalary);
    const shortage = amount(saved.undertimeDeduction);
    return {
      source: "snapshot" as const,
      basicSalary,
      ratePerDay: amount(saved.ratePerDay),
      ratePerHour: amount(saved.ratePerHour),
      totalHours:
        nonNegative(saved.totalMinutes) === null
          ? nonNegative(record.totalHours)
          : saved.totalMinutes! / 60,
      requiredHours:
        nonNegative(saved.requiredMinutes) === null
          ? nonNegative(record.daysWorked) === null
            ? null
            : record.daysWorked * 8
          : saved.requiredMinutes! / 60,
      overtimeHours:
        nonNegative(saved.overtimeMinutes) === null
          ? null
          : saved.overtimeMinutes! / 60,
      regularPay:
        basicSalary === null || shortage === null
          ? null
          : money(basicSalary - shortage),
      otPay: amount(saved.otPay),
      adjustment: amount(saved.govHolidayAmt),
    };
  }

  // Before snapshots, payslips used saved cutoff days/hours and the employee's
  // salary reference. This is a display estimate, never a historical snapshot.
  const basicSalary = nonNegative(currentSalary);
  const totalHours = nonNegative(record.totalHours);
  const days = nonNegative(record.daysWorked);
  const requiredHours = days === null ? null : days * 8;
  const ratePerDay =
    basicSalary === null || days === null || days === 0
      ? null
      : basicSalary / days;
  const ratePerHour = ratePerDay === null ? null : ratePerDay / 8;
  const difference =
    totalHours === null || requiredHours === null || requiredHours === 0
      ? null
      : totalHours - requiredHours;
  const overtimeHours = difference === null ? null : Math.max(0, difference);
  const otPay =
    overtimeHours === null || ratePerHour === null
      ? null
      : money(overtimeHours * ratePerHour * 1.25);
  const regularPay =
    basicSalary === null || difference === null || ratePerHour === null
      ? null
      : money(basicSalary - money(Math.max(0, -difference) * ratePerHour));
  return {
    source: "legacy" as const,
    basicSalary,
    ratePerDay,
    ratePerHour,
    totalHours,
    requiredHours,
    overtimeHours,
    regularPay,
    otPay,
    adjustment:
      amount(record.grossPay) === null || regularPay === null || otPay === null
        ? null
        : money(record.grossPay - regularPay - otPay),
  };
}
