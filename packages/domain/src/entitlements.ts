import { nonNegative, positive, requireRule } from './quantities.ts';

export type Entitlement = { kind: 'BOOLEAN'; enabled: boolean } | { kind: 'LIMIT'; value: bigint | null };
export interface EntitlementOverride {
  entitlement: Entitlement;
  startsAt: number;
  endsAt: number;
  reason: string;
}

function validate(entitlement: Entitlement): void {
  requireRule(entitlement.kind === 'BOOLEAN' || entitlement.kind === 'LIMIT', 'INVALID_ENTITLEMENT', 'Tipo de recurso inválido.');
  if (entitlement.kind === 'LIMIT' && entitlement.value !== null) nonNegative(entitlement.value);
  if (entitlement.kind === 'BOOLEAN') requireRule(typeof entitlement.enabled === 'boolean', 'INVALID_ENTITLEMENT', 'Permissão inválida.');
}

/** Input add-ons must already be confirmed and of the same registered key/type. */
export function resolveEntitlement(base: Entitlement, confirmedAddons: readonly Entitlement[], override: EntitlementOverride | null, now: number): Entitlement {
  validate(base);
  requireRule(Number.isFinite(now), 'INVALID_TIME', 'Horário de avaliação inválido.');
  for (const item of confirmedAddons) {
    validate(item);
    requireRule(item.kind === base.kind, 'INVALID_ENTITLEMENT', 'Tipos incompatíveis para o mesmo recurso.');
  }
  if (override) {
    validate(override.entitlement);
    requireRule(override.entitlement.kind === base.kind && Number.isFinite(override.startsAt) && Number.isFinite(override.endsAt)
      && override.endsAt > override.startsAt && override.reason.trim().length > 0,
    'INVALID_OVERRIDE', 'A liberação precisa de tipo, período e justificativa válidos.');
    if (now >= override.startsAt && now < override.endsAt) return { ...override.entitlement };
  }
  if (base.kind === 'BOOLEAN') return { kind: 'BOOLEAN', enabled: base.enabled || confirmedAddons.some(item => item.kind === 'BOOLEAN' && item.enabled) };
  let value = base.value;
  for (const item of confirmedAddons) {
    if (item.kind === 'LIMIT') value = value === null || item.value === null ? null : nonNegative(value + item.value);
  }
  return { kind: 'LIMIT', value };
}

/** Call while holding the tenant's quota lock; this pure function is not a lock. */
export function requireCapacity(limit: Entitlement, used: bigint, requested: bigint): bigint {
  validate(limit);
  nonNegative(used);
  positive(requested);
  requireRule(limit.kind === 'LIMIT', 'INVALID_ENTITLEMENT', 'Este recurso não é um limite.');
  const next = nonNegative(used + requested);
  requireRule(limit.value === null || next <= limit.value, 'PLAN_LIMIT_REACHED', 'O limite do plano foi atingido. Revise o uso ou altere o plano.');
  return next;
}

export function requireDowngradeCapacity(targetLimits: Readonly<Record<string, bigint | null>>, usage: Readonly<Record<string, bigint>>): void {
  for (const [key, limit] of Object.entries(targetLimits)) {
    const used = usage[key];
    requireRule(used !== undefined, 'USAGE_REQUIRED', 'O uso atual deve ser conferido antes da mudança de plano.');
    nonNegative(used);
    if (limit !== null) {
      nonNegative(limit);
      requireRule(used <= limit, 'DOWNGRADE_BLOCKED', `Reduza o uso do recurso ${key} antes de mudar de plano.`);
    }
  }
}
