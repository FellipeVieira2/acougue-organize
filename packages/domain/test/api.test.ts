import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ApiError, parseCreatePriceRequest, parseCreateProductRequest, parseIfMatch } from '../src/api.ts';

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
