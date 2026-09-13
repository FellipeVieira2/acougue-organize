import test from 'node:test';
import assert from 'node:assert/strict';
import { priceToMinor, formatBRL } from '../../../lib/money.ts';
test('prices preserve exact cents beyond Number precision', () => {
  assert.equal(priceToMinor('90071992547409,93'), '9007199254740993');
  assert.equal(formatBRL('9007199254740993'), 'R$ 90.071.992.547.409,93');
  assert.equal(priceToMinor('0'), '0'); assert.equal(formatBRL('0'), 'R$ 0,00');
  assert.equal(priceToMinor('39.9'), '3990');
  for (const value of ['-1', '1e3', '39,999', '1.000,00', '']) assert.throws(() => priceToMinor(value));
});
