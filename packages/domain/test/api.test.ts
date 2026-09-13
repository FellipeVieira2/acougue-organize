import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApiError, parseCreateCatalogOfferRequest, parseCreateInventoryItemRequest, parseCreatePreparationOptionRequest, parseCreatePriceRequest, parseCreateProductRequest, parseIfMatch } from '../src/api.ts';

const price = { id: randomUUID(), organizationId: randomUUID(), storeId: randomUUID(), productId: randomUUID(), channel: 'POS', amountMinor: '3790', currency: 'BRL', revision: '1' };

test('preço aceita todo bigint suportado sem conversão para number', () => {
  for (const amountMinor of ['0', '9007199254740993', '9223372036854775807']) {
    assert.equal(parseCreatePriceRequest({ ...price, amountMinor }).amountMinor, amountMinor);
  }
});

test('preço rejeita overflow, representação ambígua e revisão zero com erro 400', () => {
  const invalid: unknown[] = ['9223372036854775808', '01', ' 1', '1 ', '1.0', '1e3', '-1', 3790, null];
  for (const field of ['amountMinor', 'revision']) {
    for (const value of [...invalid, ...(field === 'revision' ? ['0'] : [])]) {
      assert.throws(() => parseCreatePriceRequest({ ...price, [field]: value }), (error: unknown) => error instanceof ApiError && error.status === 400);
    }
  }
});

test('DTO rejeita campos adicionais e combinação incompatível de venda', () => {
  assert.throws(() => parseCreatePriceRequest({ ...price, role: 'OWNER' }), ApiError);
  assert.throws(() => parseCreateProductRequest({ id: price.id, organizationId: price.organizationId, sku: 'A', name: 'Produto', stockUnit: 'G', saleStrategy: 'UNIT' }), ApiError);
});

test('If-Match exige versão positiva e representável', () => {
  assert.equal(parseIfMatch('"12"'), 12);
  for (const value of [null, '12', '"0"', '"9007199254740992"']) assert.throws(() => parseIfMatch(value), ApiError);
});

test('parsers do açougue preservam preparo, estoque físico e limites de peso', () => {
  const organizationId = '11111111-1111-4111-8111-111111111111';
  assert.equal(parseCreatePreparationOptionRequest({ id: '22222222-2222-4222-8222-222222222222', organizationId, code: 'MOIDO', name: 'Moído' }).code, 'MOIDO');
  assert.equal(parseCreateInventoryItemRequest({ id: '33333333-3333-4333-8333-333333333333', organizationId, name: 'Acém bovino', sku: 'ACEM-FISICO', baseUnit: 'G' }).baseUnit, 'G');
  assert.equal(parseCreateCatalogOfferRequest({ id: '44444444-4444-4444-8444-444444444444', organizationId, productId: '55555555-5555-4555-8555-555555555555', inventoryItemId: '33333333-3333-4333-8333-333333333333', preparationOptionId: '22222222-2222-4222-8222-222222222222', sku: 'ACEM-MOIDO', saleUnit: 'G', minWeightG: '900', maxWeightG: '1100', defaultWeightG: '1000' }).maxWeightG, '1100');
  assert.throws(() => parseCreatePreparationOptionRequest({ id: '22222222-2222-4222-8222-222222222222', organizationId, code: 'moido', name: 'Moído' }), ApiError);
});
