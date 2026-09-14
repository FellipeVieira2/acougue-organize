import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductUpdate } from '../../../lib/products.ts';
test('product updates require explicit status and exact positive revision', () => {
  assert.deepEqual(parseProductUpdate({name:' Picanha ',active:false,expectedVersion:'9007199254740993'}),{name:'Picanha',active:false,expectedVersion:'9007199254740993'});
  for (const expectedVersion of [1, '0', '-1', '1e2', '01', '9223372036854775807']) assert.throws(() => parseProductUpdate({name:'Picanha',active:true,expectedVersion}));
  assert.throws(() => parseProductUpdate({name:'Picanha',active:'false',expectedVersion:'1'}));
  assert.throws(() => parseProductUpdate({name:' ',active:true,expectedVersion:'1'}));
  assert.throws(() => parseProductUpdate({name:'Picanha',active:true,expectedVersion:'1',organizationId:'spoofed'}));
});
