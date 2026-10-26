import { BadRequestException } from '@nestjs/common';
import { reportPeriod } from './books.reports';

describe('Approved ledger report calendar rules', () => {
  it('uses inclusive Manila days with an exclusive next-midnight boundary', () => {
    expect(reportPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: new Date('2026-09-30T16:00:00Z'),
      end: new Date('2026-10-31T16:00:00Z'),
      fromDay: '2026-10-01',
      toDay: '2026-10-31',
    });
  });
  it('handles leap-day and year-end cutoffs without local host timezone assumptions', () => {
    expect(reportPeriod({ asOf: '2028-02-29' }).end.toISOString()).toBe(
      '2028-02-29T16:00:00.000Z',
    );
    expect(
      reportPeriod({ from: '2026-12-31', to: '2026-12-31' }).end.toISOString(),
    ).toBe('2026-12-31T16:00:00.000Z');
  });
  it.each([
    {},
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-10-02', to: '2026-10-01' },
    { from: '0000-01-01', to: '2026-10-01' },
    { from: '2026-10-01T03:00:00Z', to: '2026-10-01' },
  ])('rejects malformed, missing or reversed dates: %j', (input) => {
    expect(() => reportPeriod(input)).toThrow(BadRequestException);
  });
});
