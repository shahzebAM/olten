import { BadRequestException } from '@nestjs/common';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A valid request object is required.');
  }
  return value as Record<string, unknown>;
}

export function text(
  value: unknown,
  field: string,
  required = true,
  max = 2000,
): string | undefined {
  if (!required && (value === undefined || value === null || value === ''))
    return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(
      `${field} is required and must contain at most ${max} characters.`,
    );
  }
  return value.trim();
}

export function integer(value: unknown, field: string, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 2147483647
  ) {
    throw new BadRequestException(
      `${field} must be a whole number of at least ${minimum}.`,
    );
  }
  return value;
}

export function amount(
  value: unknown,
  field: string,
  positive = false,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value >= 1e12 ||
    (positive && value === 0)
  ) {
    throw new BadRequestException(
      `${field} must be a valid ${positive ? 'positive' : 'non-negative'} amount.`,
    );
  }
  return value;
}

export function date(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    throw new BadRequestException(`${field} must be an ISO date.`);
  const result = new Date(value);
  if (!Number.isFinite(result.getTime()))
    throw new BadRequestException(`${field} must be a valid date.`);
  if (
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) !==
    value.slice(0, 10)
  )
    throw new BadRequestException(`${field} must be a valid calendar date.`);
  return result;
}

export function choice(
  value: unknown,
  options: readonly string[],
  field: string,
): string {
  if (typeof value !== 'string' || !options.includes(value))
    throw new BadRequestException(
      `Invalid ${field}. Allowed: ${options.join(', ')}.`,
    );
  return value;
}

export function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200)
    throw new BadRequestException('Provide between 1 and 200 items.');
  return value.map(object);
}

export function unique(values: (string | number)[]) {
  if (new Set(values).size !== values.length)
    throw new BadRequestException('Duplicate items are not allowed.');
}

export function currency(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))
    throw new BadRequestException(
      'Currency must be a three-letter uppercase code.',
    );
  return value;
}

export function qcQuantities(
  input: Record<string, unknown>,
  received: number,
  placed = 0,
) {
  const acceptedQty = integer(input.acceptedQty, 'Accepted quantity');
  const rejectedQty = integer(input.rejectedQty, 'Rejected quantity');
  const heldQty = integer(input.heldQty, 'Held quantity');
  if (acceptedQty + rejectedQty + heldQty !== received)
    throw new BadRequestException(
      'Accepted, rejected, and held quantities must equal received quantity.',
    );
  if (acceptedQty < placed)
    throw new BadRequestException(
      'Accepted quantity cannot be below stock already placed.',
    );
  return { acceptedQty, rejectedQty, heldQty };
}

export function photos(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 6)
    throw new BadRequestException('Attach at most six damage photos.');
  return value.map((entry) => {
    if (
      typeof entry !== 'string' ||
      entry.length > 1500000 ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(entry)
    ) {
      throw new BadRequestException(
        'Photos must be JPEG, PNG, or WebP data images smaller than 1 MB.',
      );
    }
    return entry;
  });
}

export function manilaDay(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function isExpired(value: Date, now = new Date()) {
  return manilaDay(value) < manilaDay(now);
}

export function shipmentDelay(
  shipment: {
    eta: Date | null;
    revisedEta: Date | null;
    actualArrival: Date | null;
    status: string;
  },
  now = new Date(),
) {
  const expected = shipment.revisedEta ?? shipment.eta;
  const overdue = expected
    ? new Date(manilaDay(shipment.actualArrival ?? now)).getTime() -
      new Date(manilaDay(expected)).getTime()
    : 0;
  return {
    isDelayed: shipment.status !== 'Closed' && overdue > 0,
    delayDays: Math.max(0, Math.round(overdue / 86400000)),
  };
}
