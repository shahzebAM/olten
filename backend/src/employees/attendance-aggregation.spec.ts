import {
  aggregateAttendanceRecords,
  attendanceSessionKey,
  calculateAttendanceMetrics,
  calculateAttendancePayroll,
  parseTimeToMinutes,
  toAttendanceDateYMD,
  type AttendanceRecordInput,
} from './attendance-calculator';

const record = (
  changes: Partial<AttendanceRecordInput> = {},
): AttendanceRecordInput => ({
  id: 1,
  employeeId: 1,
  date: '2026-10-06',
  timeIn: '08:00',
  timeOut: '17:00',
  ...changes,
});

describe('shared attendance aggregation', () => {
  it('counts midnight as a valid zero-minute clock value', () => {
    const result = calculateAttendanceMetrics({
      timeIn: '12:00 AM',
      timeOut: '12:38 AM',
    });
    expect(parseTimeToMinutes('12:00 AM')).toBe(0);
    expect(result.netMinutes).toBe(38);
    expect(result.total).toBe(38 / 60);
    expect(result.decimalHours).toBe('0.63');
    expect(result.undertimeMinutes).toBe(0);
  });

  it('includes distinct same-date sessions and applies the daily regular cap once', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: '00:00', timeOut: '00:38' }),
      record({ id: 2, timeIn: '09:32', timeOut: '18:13' }),
    ]);
    expect(result.grossMinutes).toBe(559);
    expect(result.lunchDeductionMinutes).toBe(60);
    expect(result.netMinutes).toBe(499);
    expect(result.regularMinutes).toBe(480);
    expect(result.otMinutes).toBe(19);
    expect(result.earlyOtMinutes).toBe(19);
    expect(result.lateMinutes).toBe(92);
    expect(result.undertimeMinutes).toBe(0);
    expect(result.records.map((row) => row.metrics.netMinutes)).toEqual([
      38, 461,
    ]);
    expect(
      result.records.reduce((sum, row) => sum + row.metrics.regularMinutes, 0),
    ).toBe(480);
    expect(result.daysWorked).toBe(1);
  });

  it('adds a valid 38-minute session to 124h 28m without decimal rounding', () => {
    const baseline = Array.from({ length: 13 }, (_, index) =>
      record({
        id: index + 1,
        date: new Date(Date.UTC(2026, 8, 26 + index))
          .toISOString()
          .slice(0, 10),
        timeOut: index === 12 ? '13:28' : '19:00',
      }),
    );
    const options = { startDate: '2026-09-26', endDate: '2026-10-10' };
    expect(aggregateAttendanceRecords(baseline, options).netMinutes).toBe(7468);
    const result = aggregateAttendanceRecords(
      [...baseline, record({ id: 50, timeIn: '00:00', timeOut: '00:38' })],
      options,
    );
    expect(result.netMinutes).toBe(7506);
    expect(result.total).toBe(125.1);
    expect(result.decimalHours).toBe('125.10');
  });

  it('handles overnight attendance as a five-hour interval', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: '21:00', timeOut: '02:00' }),
    ]);
    expect(result.grossMinutes).toBe(300);
    expect(result.netMinutes).toBe(300);
    expect(result.lunchDeductionMinutes).toBe(0);
  });

  it('deduplicates actual identical sessions while retaining separate sessions', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: '00:00', timeOut: '00:38' }),
      record({ id: 2, timeIn: '12:00 AM', timeOut: '12:38 AM' }),
      record({ id: 3, timeIn: '01:00', timeOut: '01:20' }),
    ]);
    expect(result.netMinutes).toBe(58);
    expect(result.duplicateRecordIds).toEqual([2]);
    expect(result.records.map((row) => row.metrics.netMinutes)).toEqual([
      38, 0, 20,
    ]);
    expect(
      attendanceSessionKey(record({ timeIn: '08:00 AM', timeOut: '05:00 PM' })),
    ).toBe(attendanceSessionKey(record()));
  });

  it('unions overlapping sessions and deducts their shared lunch only once', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: '08:00', timeOut: '14:00' }),
      record({ id: 2, timeIn: '11:00', timeOut: '17:00' }),
    ]);
    expect(result.grossMinutes).toBe(540);
    expect(result.lunchDeductionMinutes).toBe(60);
    expect(result.netMinutes).toBe(480);
    expect(result.otMinutes).toBe(0);
    expect(
      result.records.reduce((sum, row) => sum + row.metrics.grossMinutes, 0),
    ).toBe(540);
    expect(
      result.records.reduce((sum, row) => sum + row.metrics.netMinutes, 0),
    ).toBe(480);
  });

  it('deducts only the lunch minutes actually covered by split sessions', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: '08:00', timeOut: '12:20' }),
      record({ id: 2, timeIn: '12:40', timeOut: '17:00' }),
    ]);
    expect(result.grossMinutes).toBe(520);
    expect(result.lunchDeductionMinutes).toBe(40);
    expect(result.netMinutes).toBe(480);
    expect(result.lateMinutes).toBe(0);
    expect(result.undertimeMinutes).toBe(0);
  });

  it('merges overlap across calendar dates independently of source order', () => {
    const rows = [
      record({ date: '2026-10-05', timeIn: '21:00', timeOut: '02:00' }),
      record({ id: 2, date: '2026-10-06', timeIn: '00:00', timeOut: '10:00' }),
    ];
    const forward = aggregateAttendanceRecords(rows);
    const reverse = aggregateAttendanceRecords(rows.slice().reverse());
    expect(forward.grossMinutes).toBe(780);
    expect(forward.netMinutes).toBe(780);
    expect(reverse.netMinutes).toBe(forward.netMinutes);
    expect(reverse.regularMinutes).toBe(forward.regularMinutes);
    expect(reverse.otMinutes).toBe(forward.otMinutes);
    expect(
      Object.fromEntries(
        reverse.records.map((row) => [row.id, row.metrics.netMinutes]),
      ),
    ).toEqual(
      Object.fromEntries(
        forward.records.map((row) => [row.id, row.metrics.netMinutes]),
      ),
    );
  });

  it('combines fragments of one overnight scheduled workday before applying its cap', () => {
    const rows = [
      record({ date: '2026-10-05', timeIn: '21:00', timeOut: '00:00' }),
      record({ id: 2, date: '2026-10-06', timeIn: '00:00', timeOut: '06:00' }),
    ];
    const options = {
      shiftStart: '21:00',
      shiftEnd: '06:00',
      lunchStart: '00:00',
      lunchEnd: '00:30',
    };
    const forward = aggregateAttendanceRecords(rows, options);
    const reverse = aggregateAttendanceRecords(rows.slice().reverse(), options);
    expect(forward.grossMinutes).toBe(540);
    expect(forward.lunchDeductionMinutes).toBe(30);
    expect(forward.netMinutes).toBe(510);
    expect(forward.regularMinutes).toBe(480);
    expect(forward.otMinutes).toBe(30);
    expect(forward.daysWorked).toBe(1);
    expect(forward.days[0].date).toBe('2026-10-05');
    expect(reverse.regularMinutes).toBe(480);
    expect(reverse.otMinutes).toBe(30);
    expect(forward.lateMinutes).toBe(0);
    expect(forward.undertimeMinutes).toBe(0);
  });

  it('does not merge separate night shifts merely because they start on the same calendar date', () => {
    const result = aggregateAttendanceRecords(
      [
        record({ timeIn: '00:00', timeOut: '02:00' }),
        record({ id: 2, timeIn: '21:00', timeOut: '02:00' }),
      ],
      { shiftStart: '21:00', shiftEnd: '06:00' },
    );
    expect(result.netMinutes).toBe(420);
    expect(result.days.map((day) => day.date).sort()).toEqual([
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(result.daysWorked).toBe(2);
  });

  it('projects adjacent cutoffs after global overlap allocation without counting a minute twice', () => {
    const rows = [
      record({ date: '2026-10-05', timeIn: '21:00', timeOut: '02:00' }),
      record({ id: 2, date: '2026-10-06', timeIn: '00:00', timeOut: '10:00' }),
    ];
    for (const source of [rows, rows.slice().reverse()]) {
      const all = aggregateAttendanceRecords(source);
      const previous = aggregateAttendanceRecords(source, {
        startDate: '2026-10-05',
        endDate: '2026-10-05',
      });
      const current = aggregateAttendanceRecords(source, {
        startDate: '2026-10-06',
        endDate: '2026-10-06',
      });
      expect(all.netMinutes).toBe(780);
      expect(previous.netMinutes).toBe(300);
      expect(current.netMinutes).toBe(480);
      expect(previous.netMinutes + current.netMinutes).toBe(all.netMinutes);
      expect(previous.regularMinutes + current.regularMinutes).toBe(
        all.regularMinutes,
      );
      expect(previous.otMinutes + current.otMinutes).toBe(all.otMinutes);
      expect(current.records.map((row) => row.id)).toEqual([2]);
      expect(current.daysWorked).toBe(1);
    }
  });

  it('classifies a cutoff fragment using the complete scheduled overnight workday', () => {
    const rows = [
      record({ date: '2026-10-05', timeIn: '21:00', timeOut: '00:00' }),
      record({ id: 2, date: '2026-10-06', timeIn: '00:00', timeOut: '06:00' }),
    ];
    const options = {
      shiftStart: '21:00',
      shiftEnd: '06:00',
      lunchStart: '00:00',
      lunchEnd: '00:30',
    };
    const all = aggregateAttendanceRecords(rows, options);
    const previous = aggregateAttendanceRecords(rows, {
      ...options,
      startDate: '2026-10-05',
      endDate: '2026-10-05',
    });
    const current = aggregateAttendanceRecords(rows, {
      ...options,
      startDate: '2026-10-06',
      endDate: '2026-10-06',
    });
    expect(previous.netMinutes).toBe(180);
    expect(previous.regularMinutes).toBe(180);
    expect(previous.otMinutes).toBe(0);
    expect(current.netMinutes).toBe(330);
    expect(current.regularMinutes).toBe(300);
    expect(current.otMinutes).toBe(30);
    expect(previous.netMinutes + current.netMinutes).toBe(all.netMinutes);
    expect(previous.regularMinutes + current.regularMinutes).toBe(
      all.regularMinutes,
    );
    expect(current.days[0].metrics.netMinutes).toBe(330);
  });

  it('keeps employee identities and record-specific schedules/lunch separate across companies', () => {
    const result = aggregateAttendanceRecords([
      { ...record(), company: 'Company A' },
      {
        ...record({
          id: 2,
          employeeId: 2,
          timeIn: '10:00',
          timeOut: '19:00',
          shiftStart: '10:00',
          shiftEnd: '19:00',
          lunchStart: '14:00',
          lunchEnd: '14:30',
        }),
        company: 'Company B',
      },
    ]);
    expect(result.records[0].company).toBe('Company A');
    expect(result.records[1].company).toBe('Company B');
    expect(result.records.map((row) => row.metrics.netMinutes)).toEqual([
      480, 510,
    ]);
    expect(result.netMinutes).toBe(990);
    expect(result.otMinutes).toBe(30);
    expect(
      aggregateAttendanceRecords(result.records, { employeeId: '2' })
        .netMinutes,
    ).toBe(510);
  });

  it('applies actual breaks before scheduled lunch, with explicit overrides taking priority', () => {
    const actual = record({ breakOut: '12:15', breakIn: '12:45' });
    expect(aggregateAttendanceRecords([actual]).lunchDeductionMinutes).toBe(30);
    expect(
      aggregateAttendanceRecords([{ ...actual, lunchOverrideMinutes: 0 }])
        .netMinutes,
    ).toBe(540);
    expect(
      aggregateAttendanceRecords([{ ...actual, lunchOverrideMinutes: 90 }])
        .netMinutes,
    ).toBe(450);
    expect(
      aggregateAttendanceRecords([record({ lunchOverrideMinutes: 1000 })])
        .netMinutes,
    ).toBe(0);
    expect(
      aggregateAttendanceRecords([record({ lunchOverrideMinutes: -5 })])
        .netMinutes,
    ).toBe(540);
  });

  it('does not deduct a break from minutes another valid session explicitly records as paid work', () => {
    const result = aggregateAttendanceRecords([
      record(),
      record({
        id: 2,
        timeIn: '12:00',
        timeOut: '13:00',
        lunchOverrideMinutes: 0,
      }),
    ]);
    expect(result.grossMinutes).toBe(540);
    expect(result.netMinutes).toBe(540);
    expect(result.lunchDeductionMinutes).toBe(0);
    expect(
      result.records.every(
        (row) => row.metrics.grossMinutes >= row.metrics.netMinutes,
      ),
    ).toBe(true);
  });

  it('includes cutoff endpoints based on source date and retains the whole ending overnight shift', () => {
    const rows = ['2026-09-25', '2026-09-26', '2026-10-10', '2026-10-11'].map(
      (date, index) =>
        record({ id: index + 1, date, timeIn: '21:00', timeOut: '02:00' }),
    );
    const result = aggregateAttendanceRecords(rows, {
      startDate: '2026-09-26',
      endDate: '2026-10-10',
    });
    expect(result.records.map((row) => row.date)).toEqual([
      '2026-09-26',
      '2026-10-10',
    ]);
    expect(result.netMinutes).toBe(600);
  });

  it('preserves calendar dates and interprets timezone-bearing timestamps in Manila', () => {
    expect(toAttendanceDateYMD('2026-10-06')).toBe('2026-10-06');
    expect(toAttendanceDateYMD('2026-10-05T16:00:00Z')).toBe('2026-10-06');
    expect(toAttendanceDateYMD(new Date('2026-10-05T16:00:00Z'))).toBe(
      '2026-10-06',
    );
    expect(toAttendanceDateYMD('2026-10-06T00:00:00+08:00')).toBe('2026-10-06');
    expect(toAttendanceDateYMD('2026-10-06T23:30:00')).toBe('2026-10-06');
    expect(toAttendanceDateYMD('2026-02-31')).toBe('');
    const result = aggregateAttendanceRecords(
      [record({ date: '2026-10-05T16:00:00Z' })],
      {
        startDate: '2026-10-06',
        endDate: '2026-10-06',
      },
    );
    expect(result.netMinutes).toBe(480);
  });

  it('recomputes edits and deletions from source punches without mutating the source or trusting stale hours', () => {
    const first = record({ timeIn: '00:00', timeOut: '00:38', hours: 0 });
    const second = record({
      id: 2,
      timeIn: '09:32',
      timeOut: '18:13',
      hours: 1,
    });
    const original = JSON.stringify([first, second]);
    expect(aggregateAttendanceRecords([first, second]).netMinutes).toBe(499);
    expect(
      aggregateAttendanceRecords([{ ...first, timeOut: '00:20' }, second])
        .netMinutes,
    ).toBe(481);
    expect(aggregateAttendanceRecords([second]).netMinutes).toBe(461);
    expect(JSON.stringify([first, second])).toBe(original);
  });

  it.each([
    { timeIn: '', timeOut: '17:00' },
    { timeIn: '08:00', timeOut: '' },
    { timeIn: '24:00', timeOut: '17:00' },
    { timeIn: '08:60', timeOut: '17:00' },
    { timeIn: '08:00:01', timeOut: '17:00' },
    { timeIn: '13:00 PM', timeOut: '17:00' },
    { timeIn: '00:00 AM', timeOut: '17:00' },
    { timeIn: '08:00', timeOut: '08:00' },
  ])('does not credit invalid or incomplete punches: %j', (punches) => {
    const result = aggregateAttendanceRecords([
      record({ ...punches, hours: 8 }),
    ]);
    expect(result.netMinutes).toBe(0);
    expect(result.regularMinutes).toBe(0);
    expect(result.otMinutes).toBe(0);
  });

  it('credits paid leave once per day without creating overtime or double-crediting worked hours', () => {
    const result = aggregateAttendanceRecords([
      record({ timeIn: 'LEAVE', timeOut: 'PAID', hours: 8 }),
      record({ id: 2, timeIn: 'LEAVE', timeOut: 'PAID', hours: 8 }),
      record({ id: 3, timeIn: '08:00', timeOut: '12:00' }),
      record({
        id: 4,
        date: '2026-10-07',
        timeIn: 'LEAVE',
        timeOut: 'UNPAID',
        hours: 8,
      }),
    ]);
    expect(result.netMinutes).toBe(480);
    expect(result.otMinutes).toBe(0);
    expect(result.daysWorked).toBe(2);
    expect(result.duplicateRecordIds).toEqual([2]);
    expect(result.lateMinutes).toBe(0);
    expect(result.undertimeMinutes).toBe(0);
  });

  it('preserves normal full-day, partial-lunch, and long overnight calculations', () => {
    expect(
      calculateAttendanceMetrics({ timeIn: '08:00', timeOut: '17:00' })
        .netMinutes,
    ).toBe(480);
    expect(
      calculateAttendanceMetrics({ timeIn: '12:20', timeOut: '17:00' }),
    ).toMatchObject({
      netMinutes: 240,
      lunchDeductionMinutes: 40,
      lateMinutes: 240,
    });
    expect(
      calculateAttendanceMetrics({ timeIn: '09:03', timeOut: '00:38' }),
    ).toMatchObject({
      grossMinutes: 935,
      netMinutes: 875,
      regularMinutes: 480,
      otMinutes: 395,
    });
  });
});

describe('shared attendance payroll integration', () => {
  const options = {
    employeeId: 1,
    startDate: '2026-10-01',
    endDate: '2026-10-15',
    daysWorked: 1,
    basicSalary: 800,
    overtimeBasis: 'DAILY' as const,
  };

  it('does not turn ordinary hours on extra days into cutoff overtime', () => {
    const result = calculateAttendancePayroll(
      [record(), record({ id: 2, date: '2026-10-07' })],
      options,
    );
    expect(result.totalMinutes).toBe(960);
    expect(result.regularMinutes).toBe(960);
    expect(result.overtimeMinutes).toBe(0);
    expect(result.requiredMinutes).toBe(480);
    expect(result.otPay).toBe(0);
    expect(result.undertimeDeduction).toBe(0);
    expect(result.grossPay).toBe(800);
  });

  it('does not let daily overtime offset another scheduled day of undertime', () => {
    const result = calculateAttendancePayroll(
      [
        record({ timeOut: '19:00' }),
        record({ id: 2, date: '2026-10-07', timeOut: '15:00' }),
      ],
      { ...options, daysWorked: 2, basicSalary: 1600, govHolidayAmt: 50 },
    );
    expect(result.totalMinutes).toBe(960);
    expect(result.regularMinutes).toBe(840);
    expect(result.overtimeMinutes).toBe(120);
    expect(result.undertimeMinutes).toBe(120);
    expect(result.ratePerHour).toBe(100);
    expect(result.otPay).toBe(250);
    expect(result.undertimeDeduction).toBe(200);
    expect(result.grossPay).toBe(1700);
    expect(result).toMatchObject({
      version: 1,
      cutoffStart: options.startDate,
      cutoffEnd: options.endDate,
    });
  });
});
