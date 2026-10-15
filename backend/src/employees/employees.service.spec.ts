import { calculateAttendanceMetrics } from './attendance-calculator';

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