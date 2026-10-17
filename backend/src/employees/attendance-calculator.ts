// Pure attendance calculations shared by the API and payroll interface.
export interface AttendanceCalcOptions {
  timeIn: string;
  timeOut: string;
  shiftStart?: string;
  shiftEnd?: string;
  lunchStart?: string;
  lunchEnd?: string;
  breakOut?: string | null;
  breakIn?: string | null;
  lunchOverrideMinutes?: number | null;
  maxRegularMinutes?: number;
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
  decimalHours: string;
  regularFormatted: string;
  actualFormatted: string;
}

export interface AttendanceRecordInput {
  id?: number | string;
  employeeId: number | string;
  date: string;
  timeIn: string;
  timeOut: string;
  hours?: number;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  lunchStart?: string | null;
  lunchEnd?: string | null;
  breakOut?: string | null;
  breakIn?: string | null;
  lunchOverrideMinutes?: number | null;
}

export interface AttendanceAggregationOptions {
  employeeId?: number | string;
  startDate?: string;
  endDate?: string;
  shiftStart?: string;
  shiftEnd?: string;
  lunchStart?: string;
  lunchEnd?: string;
  maxRegularMinutes?: number;
}

export interface AttendanceAggregationResult<
  T extends AttendanceRecordInput = AttendanceRecordInput,
> extends AttendanceCalcResult {
  daysWorked: number;
  records: Array<T & { metrics: AttendanceCalcResult }>;
  duplicateRecordIds: Array<number | string>;
  days: Array<{
    employeeId: number | string;
    date: string;
    metrics: AttendanceCalcResult;
  }>;
}

type Interval = { start: number; end: number };
type AllocatedInterval = Interval & { index: number; earlyOt: number };
const MINUTES_PER_DAY = 1440;

export const parseTimeToMinutes = (timeStr?: string | null): number | null => {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (minutes > 59 || (period ? hours < 1 || hours > 12 : hours > 23))
    return null;
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours < 12) hours += 12;
  return hours * 60 + minutes;
};

export const toAttendanceDateYMD = (input?: string | Date | null): string => {
  if (!input) return '';
  if (typeof input === 'string') {
    const value = input.trim();
    // An attendance date is a calendar date, not a UTC instant.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
        ? value
        : '';
    }
    // A timestamp without an offset represents the recorded local calendar date.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
      return toAttendanceDateYMD(value.slice(0, 10));
    }
  }
  const parsed = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
};

export const attendanceSessionKey = (record: AttendanceRecordInput): string => {
  const normalizedTime = (value: string) =>
    parseTimeToMinutes(value) ?? value.trim().toUpperCase();
  return JSON.stringify([
    String(record.employeeId),
    toAttendanceDateYMD(record.date),
    normalizedTime(record.timeIn),
    normalizedTime(record.timeOut),
  ]);
};

export const formatMinutesToHM = (totalMinutes: number): string => {
  const safeMins = Math.max(0, Math.round(totalMinutes));
  if (!safeMins) return '0m';
  const hours = Math.floor(safeMins / 60);
  const minutes = safeMins % 60;
  return hours ? `${hours}h${minutes ? ` ${minutes}m` : ''}` : `${minutes}m`;
};

export const getIntervalOverlapMinutes = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number => Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));

const emptyMetrics = (): AttendanceCalcResult => ({
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
});

const withDisplay = (metrics: AttendanceCalcResult): AttendanceCalcResult => ({
  ...metrics,
  reg: metrics.regularMinutes / 60,
  ot: metrics.otMinutes / 60,
  earlyOt: metrics.earlyOtMinutes / 60,
  lateOt: metrics.lateOtMinutes / 60,
  total: metrics.netMinutes / 60,
  decimalHours: (metrics.netMinutes / 60).toFixed(2),
  regularFormatted: formatMinutesToHM(metrics.regularMinutes),
  actualFormatted: formatMinutesToHM(metrics.grossMinutes),
});

const recurringWindows = (
  span: Interval,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): Interval[] => {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start === null || end === null || start === end) return [];
  const duration = (end - start + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const intervals: Interval[] = [];
  const firstDay = Math.floor(span.start / MINUTES_PER_DAY) - 1;
  const lastDay = Math.floor(span.end / MINUTES_PER_DAY);
  for (let day = firstDay; day <= lastDay; day++) {
    const windowStart = day * MINUTES_PER_DAY + start;
    const overlap = {
      start: Math.max(span.start, windowStart),
      end: Math.min(span.end, windowStart + duration),
    };
    if (overlap.end > overlap.start) intervals.push(overlap);
  }
  return intervals;
};

const subtractIntervals = (span: Interval, unpaid: Interval[]): Interval[] => {
  let cursor = span.start;
  const paid: Interval[] = [];
  for (const interval of unpaid.slice().sort((a, b) => a.start - b.start)) {
    if (interval.start > cursor)
      paid.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < span.end) paid.push({ start: cursor, end: span.end });
  return paid;
};

const unpaidIntervals = (
  record: AttendanceRecordInput,
  span: Interval,
  options: AttendanceAggregationOptions,
): Interval[] => {
  const scheduled = recurringWindows(
    span,
    record.lunchStart ?? options.lunchStart ?? '12:00',
    record.lunchEnd ?? options.lunchEnd ?? '13:00',
  );
  if (
    record.lunchOverrideMinutes !== null &&
    record.lunchOverrideMinutes !== undefined &&
    Number.isFinite(Number(record.lunchOverrideMinutes))
  ) {
    let remaining = Math.min(
      span.end - span.start,
      Math.max(0, Math.round(Number(record.lunchOverrideMinutes))),
    );
    const unpaid: Interval[] = [];
    for (const interval of scheduled) {
      const duration = Math.min(remaining, interval.end - interval.start);
      if (duration)
        unpaid.push({ start: interval.start, end: interval.start + duration });
      remaining -= duration;
    }
    // Overrides specify a duration only; place any remainder at the end of available time.
    for (const interval of subtractIntervals(span, unpaid).reverse()) {
      const duration = Math.min(remaining, interval.end - interval.start);
      if (duration)
        unpaid.push({ start: interval.end - duration, end: interval.end });
      remaining -= duration;
    }
    return unpaid;
  }
  if (record.breakOut && record.breakIn)
    return recurringWindows(span, record.breakOut, record.breakIn);
  return scheduled;
};

const addMetrics = (
  total: AttendanceCalcResult,
  metrics: AttendanceCalcResult,
): void => {
  total.grossMinutes += metrics.grossMinutes;
  total.lunchDeductionMinutes += metrics.lunchDeductionMinutes;
  total.netMinutes += metrics.netMinutes;
  total.regularMinutes += metrics.regularMinutes;
  total.otMinutes += metrics.otMinutes;
  total.earlyOtMinutes += metrics.earlyOtMinutes;
  total.lateOtMinutes += metrics.lateOtMinutes;
  total.lateMinutes += metrics.lateMinutes;
  total.undertimeMinutes += metrics.undertimeMinutes;
};

export const aggregateAttendanceRecords = <T extends AttendanceRecordInput>(
  inputRecords: T[],
  options: AttendanceAggregationOptions = {},
): AttendanceAggregationResult<T> => {
  const startDate = options.startDate
    ? toAttendanceDateYMD(options.startDate)
    : '';
  const endDate = options.endDate ? toAttendanceDateYMD(options.endDate) : '';
  const records = inputRecords
    .filter((record) => {
      const date = toAttendanceDateYMD(record.date);
      return (
        date &&
        (options.employeeId === undefined ||
          String(record.employeeId) === String(options.employeeId))
      );
    })
    .map((record) => ({ ...record, metrics: emptyMetrics() }));
  const isEligible = (record: AttendanceRecordInput): boolean => {
    const date = toAttendanceDateYMD(record.date);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  };
  const duplicateIndices: number[] = [];
  const seen = new Set<string>();
  const groups = new Map<
    string,
    {
      employeeId: number | string;
      date: string;
      indices: number[];
      paidLeave: number[];
    }
  >();
  const spans = new Map<number, Interval>();
  const events: Array<{
    time: number;
    index: number;
    paid: boolean;
    entering: boolean;
  }> = [];
  const addEvents = (span: Interval, index: number, paid: boolean) => {
    events.push(
      { time: span.start, index, paid, entering: true },
      { time: span.end, index, paid, entering: false },
    );
  };
  records.forEach((record, index) => {
    const identity = attendanceSessionKey(record);
    if (seen.has(identity)) {
      duplicateIndices.push(index);
      return;
    }
    seen.add(identity);
    const date = toAttendanceDateYMD(record.date);
    const dayStart = Date.parse(`${date}T00:00:00Z`) / 60000;
    const timeIn = parseTimeToMinutes(record.timeIn);
    const timeOut = parseTimeToMinutes(record.timeOut);
    const span =
      timeIn !== null && timeOut !== null && timeIn !== timeOut
        ? {
            start: dayStart + timeIn,
            end: dayStart + timeOut + (timeOut < timeIn ? MINUTES_PER_DAY : 0),
          }
        : null;
    let workday = date;
    const shiftStart =
      parseTimeToMinutes(record.shiftStart ?? options.shiftStart ?? '08:00') ??
      480;
    const shiftEnd =
      parseTimeToMinutes(record.shiftEnd ?? options.shiftEnd ?? '17:00') ??
      1020;
    if (span && shiftEnd < shiftStart) {
      const previousStart = dayStart + shiftStart - MINUTES_PER_DAY;
      const previousEnd = dayStart + shiftEnd;
      const currentStart = dayStart + shiftStart;
      const currentEnd = dayStart + shiftEnd + MINUTES_PER_DAY;
      const previousOverlap = getIntervalOverlapMinutes(
        span.start,
        span.end,
        previousStart,
        previousEnd,
      );
      const currentOverlap = getIntervalOverlapMinutes(
        span.start,
        span.end,
        currentStart,
        currentEnd,
      );
      if (
        previousOverlap > currentOverlap ||
        (!previousOverlap &&
          !currentOverlap &&
          Math.abs(span.start - previousStart) <
            Math.abs(span.start - currentStart))
      ) {
        workday = new Date((dayStart - MINUTES_PER_DAY) * 60000)
          .toISOString()
          .slice(0, 10);
      }
    }
    const groupKey = JSON.stringify([String(record.employeeId), workday]);
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        employeeId: record.employeeId,
        date: workday,
        indices: [],
        paidLeave: [],
      };
      groups.set(groupKey, group);
    }
    group.indices.push(index);
    if (record.timeIn.trim().toUpperCase() === 'LEAVE') {
      if (record.timeOut.trim().toUpperCase() === 'PAID')
        group.paidLeave.push(index);
      return;
    }
    if (!span) return;
    spans.set(index, span);
    addEvents(span, index, false);
    subtractIntervals(span, unpaidIntervals(record, span, options)).forEach(
      (paid) => addEvents(paid, index, true),
    );
  });

  const ownershipOrder = new Map(
    Array.from(spans.entries())
      .sort(
        ([indexA, spanA], [indexB, spanB]) =>
          spanA.start - spanB.start ||
          spanA.end - spanB.end ||
          String(records[indexA].id ?? indexA).localeCompare(
            String(records[indexB].id ?? indexB),
          ),
      )
      .map(([index], rank) => [index, rank]),
  );
  const allocated: AllocatedInterval[] = [];
  // A separate sweep for each employee prevents one employee's punches masking another's.
  const eventsByEmployee = new Map<string, typeof events>();
  events.forEach((event) => {
    const key = String(records[event.index].employeeId);
    const employeeEvents = eventsByEmployee.get(key) ?? [];
    employeeEvents.push(event);
    eventsByEmployee.set(key, employeeEvents);
  });
  eventsByEmployee.forEach((employeeEvents) => {
    employeeEvents.sort((a, b) => a.time - b.time);
    const activeGross = new Set<number>();
    const activePaid = new Set<number>();
    let cursor = 0;
    while (cursor < employeeEvents.length) {
      const time = employeeEvents[cursor].time;
      while (
        cursor < employeeEvents.length &&
        employeeEvents[cursor].time === time
      ) {
        const event = employeeEvents[cursor++];
        const active = event.paid ? activePaid : activeGross;
        if (event.entering) active.add(event.index);
        else active.delete(event.index);
      }
      const end = employeeEvents[cursor]?.time ?? time;
      if (!activeGross.size || end <= time) continue;
      const candidates = activePaid.size ? activePaid : activeGross;
      // Prefer the earlier source session regardless of database retrieval order.
      let owner = candidates.values().next().value as number;
      candidates.forEach((index) => {
        if (ownershipOrder.get(index)! < ownershipOrder.get(owner)!)
          owner = index;
      });
      const duration = end - time;
      records[owner].metrics.grossMinutes += duration;
      if (activePaid.size) {
        records[owner].metrics.netMinutes += duration;
        allocated.push({ start: time, end, index: owner, earlyOt: 0 });
      } else records[owner].metrics.lunchDeductionMinutes += duration;
    }
  });

  const cap = Math.max(0, Math.round(options.maxRegularMinutes ?? 480));
  let daysWorked = 0;
  const days: AttendanceAggregationResult['days'] = [];
  groups.forEach((group) => {
    const indices = new Set(group.indices);
    const segments = allocated
      .filter((interval) => indices.has(interval.index))
      .sort((a, b) => a.start - b.start);
    const workMinutes = segments.reduce(
      (sum, interval) => sum + interval.end - interval.start,
      0,
    );
    const leaveMinutes = group.paidLeave.length
      ? Math.max(0, Math.min(480, cap) - Math.min(workMinutes, cap))
      : 0;
    if (leaveMinutes) {
      const metrics = records[group.paidLeave[0]].metrics;
      metrics.grossMinutes += leaveMinutes;
      metrics.netMinutes += leaveMinutes;
      metrics.regularMinutes += leaveMinutes;
    }
    const groupSpans = group.indices.flatMap((index) =>
      spans.has(index) ? [{ ...spans.get(index)!, index }] : [],
    );
    const representative =
      records[
        group.indices.find((index) => spans.has(index)) ?? group.indices[0]
      ];
    const shiftStart =
      parseTimeToMinutes(
        representative.shiftStart ?? options.shiftStart ?? '08:00',
      ) ?? 480;
    const shiftEnd =
      parseTimeToMinutes(
        representative.shiftEnd ?? options.shiftEnd ?? '17:00',
      ) ?? 1020;
    const scheduleStart =
      Date.parse(`${group.date}T00:00:00Z`) / 60000 + shiftStart;
    const scheduleEnd =
      scheduleStart +
      ((shiftEnd - shiftStart + MINUTES_PER_DAY) % MINUTES_PER_DAY);
    const overtime = Math.max(0, workMinutes - cap);
    let earlyRemaining = Math.min(
      overtime,
      segments.reduce(
        (sum, interval) =>
          sum +
          Math.max(0, Math.min(interval.end, scheduleStart) - interval.start),
        0,
      ),
    );
    segments.forEach((interval) => {
      interval.earlyOt = Math.min(
        earlyRemaining,
        Math.max(0, Math.min(interval.end, scheduleStart) - interval.start),
      );
      records[interval.index].metrics.earlyOtMinutes += interval.earlyOt;
      earlyRemaining -= interval.earlyOt;
    });
    let lateRemaining =
      overtime - segments.reduce((sum, interval) => sum + interval.earlyOt, 0);
    segments
      .slice()
      .reverse()
      .forEach((interval) => {
        const lateOt = Math.min(
          lateRemaining,
          interval.end - interval.start - interval.earlyOt,
        );
        records[interval.index].metrics.lateOtMinutes += lateOt;
        lateRemaining -= lateOt;
      });
    group.indices.forEach((index) => {
      const metrics = records[index].metrics;
      metrics.otMinutes = metrics.earlyOtMinutes + metrics.lateOtMinutes;
      metrics.regularMinutes = metrics.netMinutes - metrics.otMinutes;
    });
    const scheduledSpans = groupSpans
      .filter(
        (span) =>
          getIntervalOverlapMinutes(
            span.start,
            span.end,
            scheduleStart,
            scheduleEnd,
          ) > 0,
      )
      .sort((a, b) => a.start - b.start);
    if (scheduledSpans.length && workMinutes && !group.paidLeave.length) {
      const first = scheduledSpans[0];
      const last = scheduledSpans.reduce((latest, span) =>
        span.end > latest.end ? span : latest,
      );
      const lunchStart =
        representative.lunchStart ?? options.lunchStart ?? '12:00';
      const lunchEnd = representative.lunchEnd ?? options.lunchEnd ?? '13:00';
      const missingMinutes = (start: number, end: number) =>
        end <= start
          ? 0
          : end -
            start -
            recurringWindows({ start, end }, lunchStart, lunchEnd).reduce(
              (sum, interval) => sum + interval.end - interval.start,
              0,
            );
      records[first.index].metrics.lateMinutes = missingMinutes(
        scheduleStart,
        Math.max(scheduleStart, first.start),
      );
      records[last.index].metrics.undertimeMinutes = missingMinutes(
        Math.min(scheduleEnd, last.end),
        scheduleEnd,
      );
    }
    const eligibleIndices = group.indices.filter((index) =>
      isEligible(records[index]),
    );
    if (eligibleIndices.length) {
      const metrics = emptyMetrics();
      for (const index of eligibleIndices)
        addMetrics(metrics, records[index].metrics);
      if (
        metrics.grossMinutes ||
        eligibleIndices.some(
          (index) => records[index].timeIn.trim().toUpperCase() === 'LEAVE',
        )
      )
        daysWorked++;
      days.push({
        employeeId: group.employeeId,
        date: group.date,
        metrics: withDisplay(metrics),
      });
    }
  });
  // Resolve all source overlaps and workday caps before projecting a cutoff so
  // daily, monthly and adjacent payroll periods attribute the same minutes.
  const eligibleRecords = records.filter(isEligible);
  const total = emptyMetrics();
  eligibleRecords.forEach((record) => {
    addMetrics(total, record.metrics);
    record.metrics = withDisplay(record.metrics);
  });
  return {
    ...withDisplay(total),
    records: eligibleRecords,
    daysWorked,
    duplicateRecordIds: duplicateIndices
      .filter((index) => isEligible(records[index]))
      .flatMap((index) =>
        records[index].id === undefined ? [] : [records[index].id],
      ),
    days,
  };
};

export const calculateAttendanceMetrics = (
  options: AttendanceCalcOptions,
): AttendanceCalcResult => {
  const result = aggregateAttendanceRecords(
    [{ ...options, employeeId: 0, date: '2000-01-01' }],
    options,
  );
  const metrics = emptyMetrics();
  addMetrics(metrics, result);
  return withDisplay(metrics);
};

export interface AttendancePayrollOptions extends AttendanceAggregationOptions {
  startDate: string;
  endDate: string;
  daysWorked: number;
  basicSalary: number;
  govHolidayAmt?: number;
  ratePerDay?: number;
  overtimeBasis?: 'DAILY' | 'CUTOFF_NET';
}

export const calculateAttendancePayroll = (
  records: AttendanceRecordInput[],
  options: AttendancePayrollOptions,
) => {
  const summary = aggregateAttendanceRecords(records, options);
  const days = Number.isFinite(options.daysWorked)
    ? Math.max(0, options.daysWorked)
    : 0;
  const basicSalary = Number.isFinite(options.basicSalary)
    ? options.basicSalary
    : 0;
  const govHolidayAmt = Number.isFinite(options.govHolidayAmt)
    ? options.govHolidayAmt!
    : 0;
  const requiredMinutes = Math.round(days * 480);
  const overtimeBasis = options.overtimeBasis ?? 'CUTOFF_NET';
  const regularMinutes =
    overtimeBasis === 'CUTOFF_NET'
      ? Math.min(summary.netMinutes, requiredMinutes)
      : summary.regularMinutes;
  const overtimeMinutes =
    overtimeBasis === 'CUTOFF_NET'
      ? Math.max(0, summary.netMinutes - requiredMinutes)
      : summary.otMinutes;
  const undertimeMinutes = Math.max(0, requiredMinutes - regularMinutes);
  const ratePerDay =
    options.ratePerDay !== undefined &&
    Number.isFinite(options.ratePerDay) &&
    options.ratePerDay > 0
      ? options.ratePerDay
      : days > 0
        ? basicSalary / days
        : 0;
  const ratePerHour = ratePerDay / 8;
  const money = (value: number) => Math.round(value * 100) / 100;
  const otPay = money((overtimeMinutes / 60) * ratePerHour * 1.25);
  const undertimeDeduction = money((undertimeMinutes / 60) * ratePerHour);
  return {
    version: 1 as const,
    cutoffStart: options.startDate,
    cutoffEnd: options.endDate,
    totalMinutes: summary.netMinutes,
    regularMinutes,
    overtimeMinutes,
    overtimeBasis,
    lateMinutes: summary.lateMinutes,
    undertimeMinutes,
    requiredMinutes,
    basicSalary,
    ratePerDay,
    ratePerHour,
    otPay,
    undertimeDeduction,
    govHolidayAmt,
    grossPay: money(basicSalary - undertimeDeduction + otPay + govHolidayAmt),
  };
};
