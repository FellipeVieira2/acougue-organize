import type { Pool } from "pg";
import { ApiError, parseCreatePriceRequest, parseCreateProductRequest, parseCreateStoreRequest, type CreatePriceRequest, type CreateProductRequest, type CreateStoreRequest } from "./api.ts";
import { withMembershipTransaction } from "./membership.ts";

export type CatalogProductInput = CreateProductRequest;
export type CatalogStoreInput = CreateStoreRequest;

export async function createStoreAuthorized(pool: Pool, actorId: string, input: CatalogStoreInput): Promise<void> {
  input = parseCreateStoreRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "ADMIN", async client => {
    await client.query("INSERT INTO app.store (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)",
      [input.id, input.organizationId, input.name, input.slug]);
  });
}

export async function listStoresAuthorized(pool: Pool, organizationId: string, actorId: string): Promise<unknown[]> {
  return withMembershipTransaction(pool, organizationId, actorId, "VIEWER", async client => {
    return (await client.query("SELECT id, name, slug, active, version, created_at FROM app.store ORDER BY created_at, id")).rows;
  });
}

export async function createProductAuthorized(pool: Pool, actorId: string, input: CatalogProductInput): Promise<void> {
  input = parseCreateProductRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "MANAGER", async client => {
    await client.query(`INSERT INTO app.product (id, organization_id, sku, name, stock_unit, sale_strategy)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.organizationId, input.sku, input.name, input.stockUnit, input.saleStrategy]);
  });
}

export async function listProductsAuthorized(pool: Pool, organizationId: string, actorId: string): Promise<unknown[]> {
  return withMembershipTransaction(pool, organizationId, actorId, "VIEWER", async client => {
    return (await client.query(`SELECT id, sku, name, stock_unit, sale_strategy, active, version, created_at, updated_at
      FROM app.product WHERE active = true ORDER BY created_at, id`)).rows;
  });
}

export async function updateProductNameAuthorized(
  pool: Pool, actorId: string, organizationId: string, productId: string, name: string, expectedVersion: number,
): Promise<boolean> {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 200 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid product name or expected version");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid product ID");
  return withMembershipTransaction(pool, organizationId, actorId, "OPERATOR", async client => {
    const result = await client.query(`UPDATE app.product SET name = $1, version = version + 1, updated_at = now()
      WHERE id = $2 AND version = $3 RETURNING id`, [name.trim(), productId, expectedVersion]);
    return result.rowCount === 1;
  });
}

export async function appendProductPriceAuthorized(pool: Pool, actorId: string, input: CreatePriceRequest): Promise<void> {
  input = parseCreatePriceRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "MANAGER", async client => {
    await client.query(`INSERT INTO app.product_price
      (id, organization_id, store_id, product_id, channel, amount_minor, currency, revision)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [input.id, input.organizationId, input.storeId, input.productId, input.channel, input.amountMinor, input.currency, input.revision]);
  });
}

export {
  createStoreAuthorized as createStoreWithPermission,
  createProductAuthorized as createProductWithPermission,
  listStoresAuthorized as listStoresWithPermission,
  listProductsAuthorized as listProductsWithPermission,
  updateProductNameAuthorized as updateProductNameWithPermission,
  appendProductPriceAuthorized as appendProductPriceWithPermission,
};
