// backend/src/employees/attendance-calculator.ts

export interface AttendanceCalcOptions {
  timeIn: string;
  timeOut: string;
  shiftStart?: string;               // default "08:00"
  shiftEnd?: string;                 // default "17:00"
  lunchStart?: string;               // default "12:00"
  lunchEnd?: string;                 // default "13:00"
  breakOut?: string | null;          // optional actual break-out punch "HH:MM"
  breakIn?: string | null;           // optional actual break-in punch "HH:MM"
  lunchOverrideMinutes?: number | null; // optional approved manual override in minutes
  maxRegularMinutes?: number;        // default 480 (8 hours)
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
  // Hours representations for backward compatibility & display
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

  // Helper to compute overlap with a daily recurring window across day offsets (-1, 0, +1)
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
    // Cap at one lunch duration for standard single shifts
    return Math.min(overlapTotal, grossMinutes);
  };

  // Determine lunch deduction in integer minutes
  let lunchDeductionMinutes = 0;

  if (
    options.lunchOverrideMinutes !== undefined &&
    options.lunchOverrideMinutes !== null &&
    !isNaN(Number(options.lunchOverrideMinutes))
  ) {
    // 1. Explicit approved override
    lunchDeductionMinutes = Math.max(
      0,
      Math.min(grossMinutes, Math.round(Number(options.lunchOverrideMinutes))),
    );
  } else if (options.breakOut && options.breakIn) {
    // 2. Actual break punches
    const bOutRaw = parseTimeToMinutes(options.breakOut);
    const bInRaw = parseTimeToMinutes(options.breakIn);
    if (bOutRaw !== null && bInRaw !== null) {
      lunchDeductionMinutes = computeWindowOverlap(tIn, tOut, bOutRaw, bInRaw);
    }
  } else if (lStartRaw !== null && lEndRaw !== null) {
    // 3. Overlap between attendance [tIn, tOut] and scheduled unpaid lunch [lStart, lEnd]
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

  // Late arrival & undertime minutes (excluding any unpaid lunch window so deductions never double-count)
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

  // Convert to decimal hours rounded to 4 decimals internally, 2 decimals for display
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