import { BadRequestException } from '@nestjs/common';
import * as v from './importation.validation';

describe('Importation input validation', () => {
  it.each([undefined, null, [], 'record'])(
    'rejects invalid request objects %p',
    (input) => {
      expect(() => v.object(input)).toThrow(BadRequestException);
    },
  );

  it.each([-1, 1.5, '2', NaN, Infinity, 2147483648])(
    'rejects invalid quantity %p',
    (input) => {
      expect(() => v.integer(input, 'Quantity')).toThrow(BadRequestException);
    },
  );

  it('allows zero hold quantities, positive integer orders, and decimal money', () => {
    expect(v.integer(0, 'Hold')).toBe(0);
    expect(v.integer(2147483647, 'Order', 1)).toBe(2147483647);
    expect(v.amount(123.456, 'Cost')).toBe(123.456);
    expect(() => v.integer(0, 'Order', 1)).toThrow();
    expect(() => v.amount(0, 'Rate', true)).toThrow();
    expect(() => v.amount(1e12, 'Rate')).toThrow();
  });

  it('requires all received goods to be classified and protects placed stock', () => {
    expect(
      v.qcQuantities({ acceptedQty: 6, rejectedQty: 2, heldQty: 2 }, 10, 5),
    ).toEqual({ acceptedQty: 6, rejectedQty: 2, heldQty: 2 });
    expect(() =>
      v.qcQuantities({ acceptedQty: 6, rejectedQty: 2, heldQty: 1 }, 10),
    ).toThrow(/must equal/);
    expect(() =>
      v.qcQuantities({ acceptedQty: 4, rejectedQty: 4, heldQty: 2 }, 10, 5),
    ).toThrow(/already placed/);
  });

  it('checks ISO calendar dates and accepts timezone offsets', () => {
    expect(v.date('2026-10-15T00:00:00+08:00', 'Date')?.toISOString()).toBe(
      '2026-10-14T16:00:00.000Z',
    );
    expect(() => v.date('2026-02-30', 'Date')).toThrow();
    expect(() => v.date('15/10/2026', 'Date')).toThrow();
  });

  it('validates images, duplicates, and item limits', () => {
    expect(v.photos(['data:image/png;base64,YWJj'])).toHaveLength(1);
    expect(() => v.photos(['https://remote.example/image.png'])).toThrow();
    expect(() => v.photos(['data:image/svg+xml;base64,YWJj'])).toThrow();
    expect(() =>
      v.photos(Array.from({ length: 7 }, () => 'data:image/png;base64,YWJj')),
    ).toThrow();
    expect(() => v.unique(['one', 'one'])).toThrow();
    expect(() => v.rows([])).toThrow();
    expect(() => v.rows(Array.from({ length: 201 }, () => ({})))).toThrow();
  });

  it('treats expiry dates as valid through the Manila calendar day', () => {
    const expiry = new Date('2026-10-15');
    expect(v.isExpired(expiry, new Date('2026-10-15T15:59:59Z'))).toBe(false);
    expect(v.isExpired(expiry, new Date('2026-10-15T16:00:00Z'))).toBe(true);
  });

  it('does not flag ETA today as delayed, including Manila midnight boundaries', () => {
    const shipment = {
      eta: new Date('2026-10-15'),
      revisedEta: null,
      actualArrival: null,
      status: 'In Transit',
    };
    expect(v.shipmentDelay(shipment, new Date('2026-10-15T15:59:59Z'))).toEqual(
      { isDelayed: false, delayDays: 0 },
    );
    expect(v.shipmentDelay(shipment, new Date('2026-10-15T16:00:00Z'))).toEqual(
      { isDelayed: true, delayDays: 1 },
    );
    expect(
      v.shipmentDelay(
        { ...shipment, revisedEta: new Date('2026-10-17') },
        new Date('2026-10-16'),
      ),
    ).toEqual({ isDelayed: false, delayDays: 0 });
    expect(
      v.shipmentDelay(
        { ...shipment, status: 'Closed' },
        new Date('2026-10-17'),
      ),
    ).toEqual({ isDelayed: false, delayDays: 2 });
  });
});
