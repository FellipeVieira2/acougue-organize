import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptAmounts } from '../src/receiving.ts';
import { DomainError, MAX_DB_INTEGER } from '../src/quantities.ts';

test('recebimento conserva quantidade e custo exatos, inclusive acima de Number seguro', () => {
  assert.deepEqual(parseReceiptAmounts('1375', '5211'), { quantity: 1375n, totalCostMinor: 5211n });
  assert.deepEqual(parseReceiptAmounts('9007199254740993', MAX_DB_INTEGER.toString()), {
    quantity: 9007199254740993n, totalCostMinor: MAX_DB_INTEGER,
  });
  assert.deepEqual(parseReceiptAmounts('1', '0'), { quantity: 1n, totalCostMinor: 0n });
  assert.equal(parseReceiptAmounts(MAX_DB_INTEGER.toString(), '1').quantity, MAX_DB_INTEGER);
});

test('recebimento rejeita quantidade zero e valores ambíguos ou fora do limite', () => {
  assert.throws(() => parseReceiptAmounts('0', '1'), DomainError);
  for (const value of [null, undefined, 1, 1n, '', '-1', '01', '1.5', '1e3', ' 1', '1 ', '9223372036854775808']) {
    assert.throws(() => parseReceiptAmounts(value, '1'), DomainError);
    assert.throws(() => parseReceiptAmounts('1', value), DomainError);
  }
});
