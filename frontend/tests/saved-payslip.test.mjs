import test from "node:test";
import assert from "node:assert/strict";
import { getSavedPayslipBreakdown } from "../src/lib/savedPayslip.ts";

const legacy = (patch = {}) => ({
  daysWorked: 13,
  totalHours: 108 + 59 / 60,
  grossPay: 10402.88,
  netPay: 9421.38,
  philhealthDeduct: 490.75,
  pagIbigDeduct: 490.75,
  attendanceSummary: null,
  ...patch,
});

test("restores the reported legacy payslip using saved days and hours", () => {
  const record = legacy();
  const before = structuredClone(record);
  const result = getSavedPayslipBreakdown(record, 9815);
  assert.equal(result.source, "legacy");
  assert.equal(result.basicSalary, 9815);
  assert.equal(result.ratePerDay, 755);
  assert.equal(result.ratePerHour, 94.375);
  assert.equal(result.requiredHours, 104);
  assert.ok(Math.abs(result.overtimeHours - (4 + 59 / 60)) < 1e-10);
  assert.equal(result.regularPay, 9815);
  assert.equal(result.otPay, 587.88);
  assert.equal(result.adjustment, 0);
  assert.deepEqual(record, before);
});

test("keeps original snapshots authoritative after salary and profile changes", () => {
  const snapshot = {
    basicSalary: 10570,
    ratePerDay: 755,
    ratePerHour: 94.375,
    totalMinutes: 6880,
    requiredMinutes: 6720,
    overtimeMinutes: 160,
    undertimeDeduction: 0,
    otPay: 314.58,
    govHolidayAmt: 100,
  };
  const record = legacy({
    attendanceSummary: snapshot,
    daysWorked: 99,
    totalHours: 999,
  });
  const before = structuredClone(record);
  const result = getSavedPayslipBreakdown(record, 30000);
  assert.equal(result.source, "snapshot");
  assert.equal(result.basicSalary, 10570);
  assert.equal(result.ratePerDay, 755);
  assert.equal(result.ratePerHour, 94.375);
  assert.equal(result.totalHours, 6880 / 60);
  assert.equal(result.requiredHours, 112);
  assert.equal(result.overtimeHours, 160 / 60);
  assert.equal(result.regularPay, 10570);
  assert.equal(result.otPay, 314.58);
  assert.equal(result.adjustment, 100);
  assert.deepEqual(record, before);
});

test("deducts legacy shortage at the normal hourly rate", () => {
  const result = getSavedPayslipBreakdown(
    legacy({ totalHours: 103, grossPay: 9720.62 }),
    9815,
  );
  assert.equal(result.overtimeHours, 0);
  assert.equal(result.otPay, 0);
  // The 94.375 shortage is rounded to 94.38 before subtracting from salary.
  assert.equal(result.regularPay, 9720.62);
  assert.equal(result.adjustment, 0);
});

test("handles an exact cutoff target without overtime or shortage", () => {
  const result = getSavedPayslipBreakdown(
    legacy({ totalHours: 104, grossPay: 9815 }),
    9815,
  );
  assert.equal(result.regularPay, 9815);
  assert.equal(result.overtimeHours, 0);
  assert.equal(result.otPay, 0);
  assert.equal(result.adjustment, 0);
});

test("retains positive and negative one-cent residuals as unverified adjustments", () => {
  for (const adjustment of [0.01, -0.01, 150, -150]) {
    const result = getSavedPayslipBreakdown(
      legacy({ grossPay: 10402.88 + adjustment }),
      9815,
    );
    assert.equal(result.adjustment, adjustment);
  }
});

test("exposes a changed current salary as a legacy estimate without changing saved pay", () => {
  const record = legacy();
  const before = structuredClone(record);
  const result = getSavedPayslipBreakdown(record, 13000);
  assert.equal(result.source, "legacy");
  assert.equal(result.basicSalary, 13000);
  assert.notEqual(result.adjustment, 0);
  assert.equal(
    Math.round((result.regularPay + result.otPay + result.adjustment) * 100),
    1040288,
  );
  assert.deepEqual(record, before);
});

test("does not divide by zero or invent rates for zero paid days", () => {
  const result = getSavedPayslipBreakdown(legacy({ daysWorked: 0 }), 9815);
  assert.equal(result.requiredHours, 0);
  for (const key of [
    "ratePerDay",
    "ratePerHour",
    "overtimeHours",
    "regularPay",
    "otPay",
    "adjustment",
  ]) {
    assert.equal(result[key], null, key);
  }
});

test("handles a legacy record with no work hours and preserves a manual adjustment", () => {
  const result = getSavedPayslipBreakdown(
    legacy({ totalHours: 0, grossPay: 100 }),
    9815,
  );
  assert.equal(result.regularPay, 0);
  assert.equal(result.otPay, 0);
  assert.equal(result.adjustment, 100);
});

test("invalid legacy inputs remain distinguishable from a recorded zero", () => {
  for (const salary of [NaN, Infinity, -1]) {
    const result = getSavedPayslipBreakdown(legacy(), salary);
    assert.equal(result.basicSalary, null);
    assert.equal(result.ratePerHour, null);
    assert.equal(result.regularPay, null);
    assert.equal(result.otPay, null);
    assert.equal(result.adjustment, null);
  }
  for (const totalHours of [NaN, Infinity, -1]) {
    const result = getSavedPayslipBreakdown(legacy({ totalHours }), 9815);
    assert.equal(result.totalHours, null);
    assert.equal(result.regularPay, null);
  }
});

test("does not fabricate missing fields in a partial snapshot from current salary", () => {
  const result = getSavedPayslipBreakdown(
    legacy({ attendanceSummary: { basicSalary: 9815 } }),
    30000,
  );
  assert.equal(result.source, "snapshot");
  assert.equal(result.basicSalary, 9815);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.otPay, null);
  assert.equal(result.regularPay, null);
  assert.equal(result.totalHours, 108 + 59 / 60);
  assert.equal(result.requiredHours, 104);
});

test("preserves saved daily overtime snapshots instead of applying legacy cutoff balancing", () => {
  const result = getSavedPayslipBreakdown(
    legacy({
      attendanceSummary: {
        basicSalary: 9815,
        ratePerDay: 755,
        ratePerHour: 94.375,
        totalMinutes: 7506,
        requiredMinutes: 6240,
        overtimeMinutes: 1327,
        undertimeDeduction: 95.95,
        otPay: 2609.08,
        govHolidayAmt: -50,
      },
    }),
    13000,
  );
  assert.equal(result.overtimeHours, 1327 / 60);
  assert.equal(result.regularPay, 9719.05);
  assert.equal(result.otPay, 2609.08);
  assert.equal(result.adjustment, -50);
});
