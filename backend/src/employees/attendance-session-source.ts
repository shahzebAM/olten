import { createHash } from 'node:crypto';
import type { Attendance } from '@prisma/client';

type AttendanceSessionSource = Pick<
  Attendance,
  | 'id'
  | 'employeeId'
  | 'date'
  | 'timeIn'
  | 'timeOut'
  | 'reason'
  | 'shiftStart'
  | 'shiftEnd'
  | 'lunchStart'
  | 'lunchEnd'
  | 'breakOut'
  | 'breakIn'
  | 'lunchOverrideMinutes'
>;

/** Identify source edits without treating derived hours/metrics as source changes. */
export function getAttendanceSourceFingerprint(
  record: AttendanceSessionSource,
) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        record.id,
        record.employeeId,
        record.date,
        record.timeIn,
        record.timeOut,
        record.reason ?? null,
        record.shiftStart ?? null,
        record.shiftEnd ?? null,
        record.lunchStart ?? null,
        record.lunchEnd ?? null,
        record.breakOut ?? null,
        record.breakIn ?? null,
        record.lunchOverrideMinutes ?? null,
      ]),
    )
    .digest('hex');
}
