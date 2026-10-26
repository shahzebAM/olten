// Exact decimal half-up cents for the approved OS/PO preview rule. No payroll imports.
function ratio(value: number | string): [bigint, bigint] {
  const text = String(value || 0);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || !Number.isFinite(Number(value))) return [0n, 1n];
  const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  if (Math.abs(scale) > 320) return [0n, 1n];
  const coefficient = BigInt(`${match[2]}${match[3] ?? ''}`) * (match[1] === '-' ? -1n : 1n);
  return scale >= 0 ? [coefficient, 10n ** BigInt(scale)] : [coefficient * 10n ** BigInt(-scale), 1n];
}

function halfUp(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < 0n ? -numerator : numerator;
  const rounded = magnitude / denominator + (magnitude % denominator * 2n >= denominator ? 1n : 0n);
  return numerator < 0n ? -rounded : rounded;
}

export function roundSalesLine(quantity: number | string, unitPrice: number | string): number {
  const [q, qScale] = ratio(quantity);
  const [p, pScale] = ratio(unitPrice);
  return Number(halfUp(q * p * 100n, qScale * pScale)) / 100;
}

export function salesTotals(lineAmounts: (number | string)[], vatApplied: boolean, vatRate: number | string = 0.12) {
  const subtotalCents = lineAmounts.reduce((sum, amount) => {
    const [n, d] = ratio(amount);
    return sum + halfUp(n * 100n, d);
  }, 0n);
  const [rate, scale] = ratio(vatRate);
  const vatCents = vatApplied ? halfUp(subtotalCents * rate, scale) : 0n;
  return { subtotal: Number(subtotalCents) / 100, vatAmount: Number(vatCents) / 100, grandTotal: Number(subtotalCents + vatCents) / 100 };
}
