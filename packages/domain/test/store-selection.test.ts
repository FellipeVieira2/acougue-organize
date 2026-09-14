import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSelectedStore } from '../../../lib/store.ts';

test('resolveSelectedStore prioriza a loja escolhida e cai para a ativa', () => {
  const stores = [
    { id: 'a', active: true, name: 'Matriz' },
    { id: 'b', active: true, name: 'Filial' },
    { id: 'c', active: false, name: 'Inativa' },
  ];

  assert.deepEqual(resolveSelectedStore(stores, 'b'), { id: 'b', active: true, name: 'Filial' });
  assert.deepEqual(resolveSelectedStore(stores, null), { id: 'a', active: true, name: 'Matriz' });
  assert.deepEqual(resolveSelectedStore([{ id: 'x', active: false, name: 'Somente inativa' }], 'x'), { id: 'x', active: false, name: 'Somente inativa' });
  assert.equal(resolveSelectedStore([], 'x'), null);
});
