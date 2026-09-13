import assert from "node:assert/strict";
import test from "node:test";
import { handleCatalogRequest } from "../src/http.ts";

test("rejects catalog writes without authentication", async () => {
  const response = await handleCatalogRequest({ method: "POST", path: "/products", headers: {}, body: {}, requestId: "req-1" }, {});
  assert.equal(response.status, 401);
});

test("rejects catalog writes without permission", async () => {
  const response = await handleCatalogRequest({ method: "POST", path: "/products", headers: { "x-organization-id": "11111111-1111-4111-8111-111111111111", "x-actor-id": "22222222-2222-4222-8222-222222222222", "idempotency-key": "key" }, body: {}, requestId: "req-2" }, {});
  assert.equal(response.status, 403);
});

test("validates and delegates product creation", async () => {
  let delegated = false;
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const response = await handleCatalogRequest({ method: "POST", path: "/products", headers: { "x-organization-id": organizationId, "x-actor-id": "22222222-2222-4222-8222-222222222222", "x-permissions": "product.create", "idempotency-key": "key" }, body: { id: "33333333-3333-4333-8333-333333333333", organizationId, sku: "BOV-001", name: "Picanha", stockUnit: "G", saleStrategy: "WEIGHT_FREE" }, requestId: "req-3" }, { createProduct: async (input) => { delegated = input.name === "Picanha"; return { id: input.id }; } });
  assert.equal(response.status, 201);
  assert.equal(delegated, true);
});

test("requires If-Match for price writes", async () => {
  const response = await handleCatalogRequest({ method: "POST", path: "/stores/44444444-4444-4444-8444-444444444444/prices", headers: { "x-organization-id": "11111111-1111-4111-8111-111111111111", "x-actor-id": "22222222-2222-4222-8222-222222222222", "x-permissions": "product.change_price", "idempotency-key": "key" }, body: {}, requestId: "req-4" }, {});
  assert.equal(response.status, 428);
});
