import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DB_INTEGER, DomainError, parseInteger, priceByGrams, priceByUnits, sumMinor, allocateMinor, withinWeightPolicy, quoteLines, transitionOrder, refundableMinor, resolveEntitlement, requireCapacity, requireDowngradeCapacity, closeProduction } from '../src/index.ts';
import type { OrderGuards, FulfillmentStatus } from '../src/index.ts';

function throwsCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof DomainError && error.code === code);
}

test('R$37,90 por kg e 1.375g resulta em R$52,11', () => {
  assert.equal(priceByGrams(3790n, 1375n), 5211n);
  assert.equal(priceByGrams(6990n, 1084n), 7577n);
});

test('arredondamento half-up por linha, inclusive meio centavo', () => {
  assert.equal(priceByGrams(1n, 499n), 0n);
  assert.equal(priceByGrams(1n, 500n), 1n);
  assert.equal(sumMinor([priceByGrams(1n, 500n), priceByGrams(1n, 500n)]), 2n);
  assert.equal(priceByUnits(759n, 3n), 2277n);
});

test('API rejeita float, expoente, whitespace, número JS, sinal e excesso de bigint', () => {
  for (const value of ['1.375', '1e3', ' 10', '01', '-1', '+1', '', 1000, null, {}, '9'.repeat(100)]) {
    throwsCode(() => parseInteger(value), 'INVALID_INTEGER');
  }
  assert.equal(parseInteger('0'), 0n);
  assert.equal(parseInteger(MAX_DB_INTEGER.toString()), MAX_DB_INTEGER);
  throwsCode(() => parseInteger((MAX_DB_INTEGER + 1n).toString()), 'INVALID_QUANTITY');
});

test('negativos, quantidade zero e overflow não chegam à cobrança', () => {
  throwsCode(() => priceByGrams(-1n, 1000n), 'INVALID_QUANTITY');
  throwsCode(() => priceByGrams(1000n, 0n), 'INVALID_QUANTITY');
  throwsCode(() => priceByUnits(MAX_DB_INTEGER, 2n), 'INVALID_QUANTITY');
  throwsCode(() => sumMinor([MAX_DB_INTEGER, 1n]), 'INVALID_QUANTITY');
  assert.equal(priceByGrams(MAX_DB_INTEGER, 1000n), MAX_DB_INTEGER);
});

test('rateio conserva centavos e desempata por id independentemente da ordem', () => {
  assert.deepEqual(allocateMinor(100n, [{ id: 'c', weight: 1n }, { id: 'a', weight: 1n }, { id: 'b', weight: 1n }]), { a: 34n, b: 33n, c: 33n });
  assert.deepEqual(allocateMinor(1n, [{ id: 'b', weight: 0n }, { id: 'a', weight: 1n }]), { a: 1n, b: 0n });
  for (let cents = 0n; cents <= 200n; cents++) {
    const result = allocateMinor(cents, [{ id: 'a', weight: 5n }, { id: 'b', weight: 3n }, { id: 'c', weight: 1n }]);
    assert.equal(Object.values(result).reduce((a, b) => a + b, 0n), cents);
    assert.ok(Object.values(result).every(value => value >= 0n));
  }
});

test('rateio rejeita base zero, id duplicado e peso negativo', () => {
  throwsCode(() => allocateMinor(1n, []), 'INVALID_ALLOCATION');
  throwsCode(() => allocateMinor(1n, [{ id: 'a', weight: 0n }]), 'INVALID_ALLOCATION');
  throwsCode(() => allocateMinor(1n, [{ id: 'a', weight: 1n }, { id: 'a', weight: 1n }]), 'INVALID_ALLOCATION');
  throwsCode(() => allocateMinor(1n, [{ id: 'a', weight: -1n }]), 'INVALID_QUANTITY');
});

test('tolerância compara inteiros e inclui exatamente a fronteira', () => {
  const policy = { toleranceBps: 1000, onlyLower: false };
  assert.equal(withinWeightPolicy(1000n, 900n, policy), true);
  assert.equal(withinWeightPolicy(1000n, 1100n, policy), true);
  assert.equal(withinWeightPolicy(1000n, 1101n, policy), false);
  assert.equal(withinWeightPolicy(1000n, 899n, policy), false);
  assert.equal(withinWeightPolicy(1000n, 1001n, { ...policy, onlyLower: true }), false);
  throwsCode(() => withinWeightPolicy(1000n, 1000n, { toleranceBps: NaN, onlyLower: false }), 'INVALID_POLICY');
});

test('carrinho misto preserva estimativa e sinaliza diferença fora da política', () => {
  const lines = [
    { id: 'carne', unit: 'G' as const, requestedQuantity: 1000n, actualQuantity: 1375n, priceMinorSnapshot: 3790n, policy: { toleranceBps: 1000, onlyLower: false } },
    { id: 'carvao', unit: 'UNIT' as const, requestedQuantity: 2n, actualQuantity: 2n, priceMinorSnapshot: 1500n, policy: { toleranceBps: 0, onlyLower: false } },
  ];
  const quoted = quoteLines(lines);
  assert.equal(quoted.estimatedTotalMinor, 6790n);
  assert.equal(quoted.finalTotalMinor, 8211n);
  assert.equal(quoted.requiresApproval, true);
  assert.equal(lines[0]!.requestedQuantity, 1000n);
  assert.equal(lines[0]!.priceMinorSnapshot, 3790n);
  throwsCode(() => quoteLines([lines[0]!, lines[0]!]), 'INVALID_ITEMS');
});

function readyGuards(): OrderGuards {
  return { itemsResolved: true, requiresApproval: true, quoteRevision: 2n, approvedRevision: 2n,
    finalTotalMinor: 5211n, capturedMinor: 5211n, refundedMinor: 0n, deliveryStatus: 'PICKED_UP' };
}

test('pedido não pula separação/pesagem e não reabre estado terminal', () => {
  throwsCode(() => transitionOrder('RECEIVED', 'READY', readyGuards()), 'INVALID_TRANSITION');
  for (const terminal of ['COMPLETED', 'CANCELED'] as const) {
    for (const target of ['RECEIVED', 'CONFIRMED', 'SEPARATING', 'WEIGHING', 'WAITING_CUSTOMER_APPROVAL', 'WEIGHT_ADJUSTED', 'READY', 'COMPLETED', 'CANCELED'] as FulfillmentStatus[]) {
      throwsCode(() => transitionOrder(terminal, target, readyGuards()), 'INVALID_TRANSITION');
    }
  }
  assert.equal(transitionOrder('RECEIVED', 'CONFIRMED', readyGuards()), 'CONFIRMED');
});

test('aprovação antiga ou peso não resolvido impede liberação', () => {
  throwsCode(() => transitionOrder('WEIGHING', 'WEIGHT_ADJUSTED', { ...readyGuards(), approvedRevision: 1n }), 'APPROVAL_REQUIRED');
  throwsCode(() => transitionOrder('WEIGHT_ADJUSTED', 'READY', { ...readyGuards(), itemsResolved: false }), 'UNRESOLVED_ITEMS');
  assert.equal(transitionOrder('WEIGHING', 'WEIGHT_ADJUSTED', readyGuards()), 'WEIGHT_ADJUSTED');
});

test('conclusão exige saldo recebido e entrega/retirada', () => {
  throwsCode(() => transitionOrder('READY', 'COMPLETED', { ...readyGuards(), capturedMinor: 5210n }), 'PAYMENT_REQUIRED');
  throwsCode(() => transitionOrder('READY', 'COMPLETED', { ...readyGuards(), refundedMinor: 1n }), 'PAYMENT_REQUIRED');
  throwsCode(() => transitionOrder('READY', 'COMPLETED', { ...readyGuards(), deliveryStatus: 'OUT_FOR_DELIVERY' }), 'DELIVERY_REQUIRED');
  assert.equal(transitionOrder('READY', 'COMPLETED', readyGuards()), 'COMPLETED');
});

test('cancelamento não deixa pagamento retido e refund não excede capturado', () => {
  throwsCode(() => transitionOrder('READY', 'CANCELED', readyGuards()), 'REFUND_REQUIRED');
  assert.equal(transitionOrder('READY', 'CANCELED', { ...readyGuards(), refundedMinor: 5211n }), 'CANCELED');
  assert.equal(refundableMinor(100n, 40n, 60n), 100n);
  throwsCode(() => refundableMinor(100n, 40n, 61n), 'REFUND_EXCEEDED');
  throwsCode(() => refundableMinor(100n, 101n, 1n), 'REFUND_EXCEEDED');
});

test('override vigente prevalece; expiração volta ao plano e addons confirmados', () => {
  const base = { kind: 'BOOLEAN' as const, enabled: false };
  const override = { entitlement: { kind: 'BOOLEAN' as const, enabled: true }, startsAt: 100, endsAt: 200, reason: 'Piloto acordado' };
  assert.deepEqual(resolveEntitlement(base, [], override, 99), base);
  assert.deepEqual(resolveEntitlement(base, [], override, 100), { kind: 'BOOLEAN', enabled: true });
  assert.deepEqual(resolveEntitlement(base, [], override, 200), base);
  assert.deepEqual(resolveEntitlement(base, [{ kind: 'BOOLEAN', enabled: true }], null, 300), { kind: 'BOOLEAN', enabled: true });
});

test('limites somam addons e ilimitado é explícito', () => {
  assert.deepEqual(resolveEntitlement({ kind: 'LIMIT', value: 1n }, [{ kind: 'LIMIT', value: 2n }], null, 0), { kind: 'LIMIT', value: 3n });
  assert.deepEqual(resolveEntitlement({ kind: 'LIMIT', value: 1n }, [{ kind: 'LIMIT', value: null }], null, 0), { kind: 'LIMIT', value: null });
  assert.equal(requireCapacity({ kind: 'LIMIT', value: 3n }, 2n, 1n), 3n);
  throwsCode(() => requireCapacity({ kind: 'LIMIT', value: 3n }, 3n, 1n), 'PLAN_LIMIT_REACHED');
  throwsCode(() => requireCapacity({ kind: 'BOOLEAN', enabled: true }, 0n, 1n), 'INVALID_ENTITLEMENT');
});

test('downgrade verifica uso atual e nunca considera dado ausente como zero', () => {
  throwsCode(() => requireDowngradeCapacity({ stores: 1n }, { stores: 4n }), 'DOWNGRADE_BLOCKED');
  throwsCode(() => requireDowngradeCapacity({ stores: 1n }, {}), 'USAGE_REQUIRED');
  assert.doesNotThrow(() => requireDowngradeCapacity({ stores: 1n }, { stores: 1n }));
});

test('desossa conserva massa e custo total incluindo centavos residuais', () => {
  const result = closeProduction(10000n, 1000n, 1001n, [
    { id: 'a', grams: 3000n, relativeValue: 1n }, { id: 'b', grams: 6000n, relativeValue: 1n },
  ], 0n, 'WEIGHT_PROPORTIONAL');
  assert.equal(result.differenceGrams, 0n);
  assert.equal(result.outputGrams, 9000n);
  assert.deepEqual(result.costs, { a: 334n, b: 667n });
});

test('desossa por valor relativo e divergência de massa', () => {
  const outputs = [{ id: 'a', grams: 3000n, relativeValue: 1n }, { id: 'b', grams: 6000n, relativeValue: 3n }];
  assert.deepEqual(closeProduction(10000n, 1000n, 1000n, outputs, 0n, 'MARKET_VALUE_RELATIVE').costs, { a: 250n, b: 750n });
  throwsCode(() => closeProduction(10000n, 999n, 1000n, outputs, 0n, 'WEIGHT_PROPORTIONAL'), 'MASS_MISMATCH');
  throwsCode(() => closeProduction(10000n, 1000n, 1000n, outputs, 10000n, 'WEIGHT_PROPORTIONAL'), 'INVALID_TOLERANCE');
});
