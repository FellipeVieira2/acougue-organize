import assert from 'node:assert/strict';
import test from 'node:test';
import { handleCatalogRequest, requestHeaders } from '../src/http.ts';
const organizationId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const authenticated = (permissions: string[]) => ({ authenticate: async () => ({ organizationId, actorId, permissions }) });
const request = { method: 'POST', path: '/products', headers: { 'idempotency-key': 'key' }, requestId: 'req-1', body: { id: '33333333-3333-4333-8333-333333333333', organizationId, sku: 'BOV-001', name: 'Picanha', stockUnit: 'G', saleStrategy: 'WEIGHT_FREE' } };
test('rejects catalog writes without authentication, even with forged identity headers', async () => {
  const response = await handleCatalogRequest({ ...request, headers: { ...request.headers, 'x-organization-id': organizationId, 'x-actor-id': actorId, 'x-permissions': 'product.create' } }, {});
  assert.equal(response.status, 401);
  assert.equal(requestHeaders(new Headers({ 'x-permissions': 'product.create' }))['x-permissions'], undefined);
});
test('rejects catalog writes without verified permission', async () => {
  assert.equal((await handleCatalogRequest(request, authenticated([]))).status, 403);
});
test('validates and delegates product creation with verified identity', async () => {
  let delegated = false;
  const response = await handleCatalogRequest(request, { ...authenticated(['product.create']), createProduct: async (input, context) => { delegated = input.name === 'Picanha' && context.actorId === actorId; return { id: input.id }; } });
  assert.equal(response.status, 201); assert.equal(delegated, true);
});
test('rejects a body belonging to another organization', async () => {
  assert.equal((await handleCatalogRequest({ ...request, body: { ...request.body, organizationId: '44444444-4444-4444-8444-444444444444' } }, authenticated(['product.create']))).status, 403);
});
test('requires If-Match for price writes', async () => {
  assert.equal((await handleCatalogRequest({ ...request, path: '/stores/44444444-4444-4444-8444-444444444444/prices', body: {} }, authenticated(['product.change_price']))).status, 428);
});
