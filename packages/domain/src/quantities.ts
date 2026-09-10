export const MAX_DB_INTEGER = 9_223_372_036_854_775_807n;

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function requireRule(condition: boolean, code: string, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}

export function nonNegative(value: bigint): bigint {
  requireRule(typeof value === 'bigint' && value >= 0n && value <= MAX_DB_INTEGER,
    'INVALID_QUANTITY', 'Informe um inteiro não negativo dentro do limite suportado.');
  return value;
}

export function positive(value: bigint): bigint {
  nonNegative(value);
  requireRule(value > 0n, 'INVALID_QUANTITY', 'A quantidade deve ser maior que zero.');
  return value;
}

/** API integers are canonical digit strings, never IEEE-754 numbers. */
export function parseInteger(value: unknown): bigint {
  requireRule(typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value),
    'INVALID_INTEGER', 'Informe um inteiro em formato de texto, sem casas decimais.');
  return nonNegative(BigInt(value));
}

export function priceByGrams(pricePerKgMinor: bigint, grams: bigint): bigint {
  nonNegative(pricePerKgMinor);
  positive(grams);
  return nonNegative((pricePerKgMinor * grams + 500n) / 1000n);
}

export function priceByUnits(unitPriceMinor: bigint, units: bigint): bigint {
  return nonNegative(nonNegative(unitPriceMinor) * positive(units));
}

export function sumMinor(amounts: readonly bigint[]): bigint {
  return nonNegative(amounts.reduce((sum, amount) => sum + nonNegative(amount), 0n));
}

export interface AllocationWeight { id: string; weight: bigint }

/** Largest remainder: preserve every cent; stable ASCII id breaks ties. */
export function allocateMinor(total: bigint, entries: readonly AllocationWeight[]): Record<string, bigint> {
  nonNegative(total);
  requireRule(entries.length > 0 && entries.length <= 10000, 'INVALID_ALLOCATION', 'Informe os itens do rateio.');
  const ids = new Set<string>();
  for (const entry of entries) {
    requireRule(/^[a-zA-Z0-9_-]+$/.test(entry.id) && !ids.has(entry.id), 'INVALID_ALLOCATION', 'Identificadores de rateio devem ser únicos.');
    ids.add(entry.id);
    nonNegative(entry.weight);
  }
  const sum = entries.reduce((value, entry) => value + entry.weight, 0n);
  requireRule(sum > 0n, 'INVALID_ALLOCATION', 'O rateio precisa ter uma base positiva.');
  const rows = entries.map(entry => ({ ...entry, amount: total * entry.weight / sum, remainder: total * entry.weight % sum }));
  const remaining = total - rows.reduce((value, row) => value + row.amount, 0n);
  rows.sort((a, b) => a.remainder !== b.remainder ? (a.remainder > b.remainder ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let index = 0; index < Number(remaining); index++) rows[index]!.amount += 1n;
  return Object.fromEntries(rows.map(row => [row.id, row.amount]));
}

export interface WeightPolicy { toleranceBps: number; onlyLower: boolean }

export function withinWeightPolicy(requestedGrams: bigint, actualGrams: bigint, policy: WeightPolicy): boolean {
  positive(requestedGrams);
  positive(actualGrams);
  requireRule(Number.isInteger(policy.toleranceBps) && policy.toleranceBps >= 0 && policy.toleranceBps <= 10000
    && typeof policy.onlyLower === 'boolean', 'INVALID_POLICY', 'A tolerância de peso é inválida.');
  if (policy.onlyLower && actualGrams > requestedGrams) return false;
  const difference = actualGrams > requestedGrams ? actualGrams - requestedGrams : requestedGrams - actualGrams;
  return difference * 10000n <= requestedGrams * BigInt(policy.toleranceBps);
}
