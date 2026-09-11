import type { Pool, PoolClient } from "pg";
import { createTenantTransaction } from "./database.ts";
import { getMembership, requirePermission, type MembershipRole } from "./membership.ts";

export type CatalogProductInput = {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  stockUnit: "G" | "UNIT";
  saleStrategy: "WEIGHT_FREE" | "WEIGHT_INCREMENT" | "FIXED_PACKAGE" | "APPROXIMATE_UNIT" | "MINIMUM_WEIGHT" | "UNIT";
};

export type CatalogStoreInput = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
};

function requireUuid(value: string, field: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw new Error(`${field} must be a UUID`);
}

async function requireCatalogPermission(
  pool: Pool,
  organizationId: string,
  actorId: string,
  role: MembershipRole,
): Promise<void> {
  const membership = await getMembership(pool, organizationId, actorId);
  requirePermission(membership, role);
}

export async function createStore(pool: Pool, input: CatalogStoreInput): Promise<void> {
  requireUuid(input.id, "id");
  requireUuid(input.organizationId, "organizationId");
  const transaction = createTenantTransaction(pool);
  await transaction(input.organizationId, async (client) => {
    await client.query(
      "INSERT INTO app.store (id, organization_id, name, slug) VALUES ($1, $2, $3, $4)",
      [input.id, input.organizationId, input.name.trim(), input.slug],
    );
  });
}

export async function createStoreAuthorized(
  pool: Pool,
  actorId: string,
  input: CatalogStoreInput,
): Promise<void> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, input.organizationId, actorId, "ADMIN");
  return createStore(pool, input);
}

export async function listStores(pool: Pool, organizationId: string): Promise<unknown[]> {
  requireUuid(organizationId, "organizationId");
  const transaction = createTenantTransaction(pool);
  return transaction(organizationId, async (client) => {
    const result = await client.query(
      "SELECT id, name, slug, active, version, created_at FROM app.store ORDER BY created_at, id",
    );
    return result.rows;
  });
}

export async function listStoresAuthorized(
  pool: Pool,
  organizationId: string,
  actorId: string,
): Promise<unknown[]> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, organizationId, actorId, "VIEWER");
  return listStores(pool, organizationId);
}

export async function createProduct(pool: Pool, input: CatalogProductInput): Promise<void> {
  for (const [field, value] of Object.entries({ id: input.id, organizationId: input.organizationId })) {
    requireUuid(value, field);
  }
  const transaction = createTenantTransaction(pool);
  await transaction(input.organizationId, async (client) => {
    await client.query(
      `INSERT INTO app.product
        (id, organization_id, sku, name, stock_unit, sale_strategy)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.id, input.organizationId, input.sku.trim(), input.name.trim(), input.stockUnit, input.saleStrategy],
    );
  });
}

export async function createProductAuthorized(
  pool: Pool,
  actorId: string,
  input: CatalogProductInput,
): Promise<void> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, input.organizationId, actorId, "MANAGER");
  return createProduct(pool, input);
}

export async function listProducts(pool: Pool, organizationId: string): Promise<unknown[]> {
  requireUuid(organizationId, "organizationId");
  const transaction = createTenantTransaction(pool);
  return transaction(organizationId, async (client) => {
    const result = await client.query(
      `SELECT id, sku, name, stock_unit, sale_strategy, active, version, created_at, updated_at
       FROM app.product WHERE active = true ORDER BY created_at, id`,
    );
    return result.rows;
  });
}

export async function listProductsAuthorized(
  pool: Pool,
  organizationId: string,
  actorId: string,
): Promise<unknown[]> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, organizationId, actorId, "VIEWER");
  return listProducts(pool, organizationId);
}

export async function updateProductName(
  pool: Pool,
  organizationId: string,
  productId: string,
  name: string,
  expectedVersion: number,
): Promise<boolean> {
  requireUuid(organizationId, "organizationId");
  requireUuid(productId, "productId");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("expectedVersion must be positive");
  const transaction = createTenantTransaction(pool);
  return transaction(organizationId, async (client) => {
    const result = await client.query(
      `UPDATE app.product SET name = $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND version = $3 RETURNING id`,
      [name.trim(), productId, expectedVersion],
    );
    return result.rowCount === 1;
  });
}

export async function updateProductNameAuthorized(
  pool: Pool,
  actorId: string,
  organizationId: string,
  productId: string,
  name: string,
  expectedVersion: number,
): Promise<boolean> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, organizationId, actorId, "OPERATOR");
  return updateProductName(pool, organizationId, productId, name, expectedVersion);
}

export async function appendProductPrice(
  client: PoolClient,
  input: { id: string; organizationId: string; storeId: string; productId: string; channel: string; amountMinor: number; currency: string; revision: number },
): Promise<void> {
  requireUuid(input.id, "id");
  requireUuid(input.organizationId, "organizationId");
  requireUuid(input.storeId, "storeId");
  requireUuid(input.productId, "productId");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw new Error("amountMinor must be a non-negative integer");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error("revision must be positive");
  await client.query(
    `INSERT INTO app.product_price
      (id, organization_id, store_id, product_id, channel, amount_minor, currency, revision)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.id, input.organizationId, input.storeId, input.productId, input.channel, input.amountMinor, input.currency, input.revision],
  );
}

export async function appendProductPriceAuthorized(
  pool: Pool,
  actorId: string,
  input: Parameters<typeof appendProductPrice>[1],
): Promise<void> {
  requireUuid(actorId, "actorId");
  await requireCatalogPermission(pool, input.organizationId, actorId, "MANAGER");
  const transaction = createTenantTransaction(pool);
  await transaction(input.organizationId, (client) => appendProductPrice(client, input));
}

export { requireCatalogPermission };

export type { MembershipRole } from "./membership.ts";

export async function createStoreWithPermission(
  pool: Pool,
  actorId: string,
  input: CatalogStoreInput,
): Promise<void> {
  return createStoreAuthorized(pool, actorId, input);
}

export async function createProductWithPermission(
  pool: Pool,
  actorId: string,
  input: CatalogProductInput,
): Promise<void> {
  return createProductAuthorized(pool, actorId, input);
}

export async function listStoresWithPermission(
  pool: Pool,
  organizationId: string,
  actorId: string,
): Promise<unknown[]> {
  return listStoresAuthorized(pool, organizationId, actorId);
}

export async function listProductsWithPermission(
  pool: Pool,
  organizationId: string,
  actorId: string,
): Promise<unknown[]> {
  return listProductsAuthorized(pool, organizationId, actorId);
}

export async function updateProductNameWithPermission(
  pool: Pool,
  actorId: string,
  organizationId: string,
  productId: string,
  name: string,
  expectedVersion: number,
): Promise<boolean> {
  return updateProductNameAuthorized(pool, actorId, organizationId, productId, name, expectedVersion);
}

export async function appendProductPriceWithPermission(
  pool: Pool,
  actorId: string,
  input: Parameters<typeof appendProductPrice>[1],
): Promise<void> {
  return appendProductPriceAuthorized(pool, actorId, input);
}
