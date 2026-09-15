import type { Pool } from "pg";
import { ApiError, parseCreateCatalogOfferRequest, parseCreateInventoryItemRequest, parseCreatePreparationOptionRequest, parseCreatePriceRequest, parseCreateProductRequest, parseCreateStoreRequest, type CreateCatalogOfferRequest, type CreateInventoryItemRequest, type CreatePreparationOptionRequest, type CreatePriceRequest, type CreateProductRequest, type CreateStoreRequest } from "./api.ts";
import { withMembershipTransaction } from "./membership.ts";
import { parseInteger, positive } from "./quantities.ts";
import { orderReservationTtlMinutes } from "./reservation-policy.ts";

export type CatalogProductInput = CreateProductRequest;
export type CatalogStoreInput = CreateStoreRequest;
export type CatalogPreparationInput = CreatePreparationOptionRequest;
export type CatalogInventoryInput = CreateInventoryItemRequest;
export type CatalogOfferInput = CreateCatalogOfferRequest;

export type InventoryAdjustmentInput = {
  organizationId: string; storeId: string; inventoryItemId: string; balanceId: string; movementId: string; actorId: string;
  quantityDelta: string; reason: string;
};

export type InventoryReservationInput = {
  organizationId: string; storeId: string; inventoryItemId: string; reservationId: string; referenceId: string;
  reservedQty: string; expiresAt?: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
}

function requireQuantity(value: string, field: string, allowNegative = false): string {
  try {
    const quantity = parseInteger(value);
    if (!allowNegative) return positive(quantity).toString();
    if (quantity === 0n) throw new Error("zero");
    return quantity.toString();
  } catch {
    throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
  }
}

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

export async function createPreparationOptionAuthorized(pool: Pool, actorId: string, input: CatalogPreparationInput): Promise<void> {
  input = parseCreatePreparationOptionRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "MANAGER", async client => {
    await client.query(`INSERT INTO app.preparation_option (id, organization_id, code, name) VALUES ($1, $2, $3, $4)`,
      [input.id, input.organizationId, input.code, input.name]);
  });
}

export async function createInventoryItemAuthorized(pool: Pool, actorId: string, input: CatalogInventoryInput): Promise<void> {
  input = parseCreateInventoryItemRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "MANAGER", async client => {
    await client.query(`INSERT INTO app.inventory_item (id, organization_id, name, sku, base_unit) VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.organizationId, input.name, input.sku, input.baseUnit]);
  });
}

export async function createCatalogOfferAuthorized(pool: Pool, actorId: string, input: CatalogOfferInput): Promise<void> {
  input = parseCreateCatalogOfferRequest(input);
  await withMembershipTransaction(pool, input.organizationId, actorId, "MANAGER", async client => {
    const units = await client.query<{ productUnit: string; inventoryUnit: string }>(`SELECT p.stock_unit AS "productUnit", i.base_unit AS "inventoryUnit"
      FROM app.product p JOIN app.inventory_item i ON i.organization_id = p.organization_id
        AND i.id = $3
      WHERE p.organization_id = $1 AND p.id = $2`, [input.organizationId, input.productId, input.inventoryItemId]);
    const unit = units.rows[0];
    if (!unit || unit.productUnit !== unit.inventoryUnit || (input.saleUnit === "UNIT" && unit.inventoryUnit !== "UNIT") || (input.saleUnit !== "UNIT" && unit.inventoryUnit !== "G")) {
      throw new ApiError(400, "VALIDATION_ERROR", "Offer sale unit does not match product and physical inventory");
    }
    await client.query(`INSERT INTO app.catalog_offer
      (id, organization_id, product_id, inventory_item_id, preparation_option_id, sku, sale_unit, min_weight_g, max_weight_g, weight_step_g, default_weight_g)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [input.id, input.organizationId, input.productId, input.inventoryItemId, input.preparationOptionId, input.sku, input.saleUnit, input.minWeightG, input.maxWeightG, input.weightStepG, input.defaultWeightG]);
  });
}

export async function publishCatalogOfferAuthorized(pool: Pool, actorId: string, organizationId: string, offerId: string): Promise<void> {
  requireUuid(organizationId, "organizationId");
  requireUuid(offerId, "offerId");
  requireUuid(actorId, "actorId");
  await withMembershipTransaction(pool, organizationId, actorId, "MANAGER", async client => {
    const offer = await client.query<{ saleUnit: string; minWeightG: string | null; maxWeightG: string | null; weightStepG: string | null; defaultWeightG: string | null; publicVisible: boolean; productId: string; inventoryItemId: string }>(`SELECT o.id, o.sale_unit AS "saleUnit", o.min_weight_g AS "minWeightG", o.max_weight_g AS "maxWeightG", o.weight_step_g AS "weightStepG", o.default_weight_g AS "defaultWeightG", o.public_visible AS "publicVisible", o.product_id AS "productId", o.inventory_item_id AS "inventoryItemId"
      FROM app.catalog_offer o
      WHERE o.organization_id = $1 AND o.id = $2 AND o.active = true`, [organizationId, offerId]);
    if (!offer.rows[0]) throw new ApiError(404, "NOT_FOUND", "Oferta de catálogo não encontrada.");

    const current = offer.rows[0];
    if (current.publicVisible) return;

    const storefrontPrice = await client.query<{ amount_minor: string }>(`SELECT amount_minor FROM app.product_price
      WHERE organization_id = $1 AND product_id = $2 AND store_id = (SELECT id FROM app.store WHERE organization_id = $1 AND active = true ORDER BY created_at, id LIMIT 1)
        AND channel = 'STOREFRONT' ORDER BY revision DESC LIMIT 1`, [organizationId, current.productId]);
    if (!storefrontPrice.rows[0] || BigInt(storefrontPrice.rows[0].amount_minor) <= 0n) {
      throw new ApiError(409, "CONFLICT", "Oferta incompleta: falta preço STOREFRONT para publicação.");
    }
    if (current.saleUnit === "G") {
      if (!current.minWeightG || !current.maxWeightG || !current.weightStepG || !current.defaultWeightG) {
        throw new ApiError(409, "CONFLICT", "Oferta por peso incompleta: faltam mínimo, máximo, incremento ou peso padrão.");
      }
      if (BigInt(current.minWeightG) > BigInt(current.defaultWeightG) || BigInt(current.defaultWeightG) > BigInt(current.maxWeightG)) {
        throw new ApiError(409, "CONFLICT", "Peso padrão fora da faixa válida desta oferta.");
      }
    }
    await client.query(`UPDATE app.catalog_offer SET public_visible = true, updated_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, offerId]);
    await client.query(`INSERT INTO app.audit_log(id, organization_id, actor_id, action, entity_id, correlation_id, reason)
      VALUES ($1, $2, $3, 'catalog_offer.published', $4, $5, 'Publicação explícita do catálogo')`, [randomUUID(), organizationId, actorId, offerId, randomUUID()]);
  });
}

export async function unpublishCatalogOfferAuthorized(pool: Pool, actorId: string, organizationId: string, offerId: string): Promise<void> {
  requireUuid(organizationId, "organizationId");
  requireUuid(offerId, "offerId");
  requireUuid(actorId, "actorId");
  await withMembershipTransaction(pool, organizationId, actorId, "MANAGER", async client => {
    const offer = await client.query<{ id: string }>(`SELECT id FROM app.catalog_offer WHERE organization_id = $1 AND id = $2 AND active = true`, [organizationId, offerId]);
    if (!offer.rows[0]) throw new ApiError(404, "NOT_FOUND", "Oferta de catálogo não encontrada.");
    await client.query(`UPDATE app.catalog_offer SET public_visible = false, updated_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, offerId]);
    await client.query(`INSERT INTO app.audit_log(id, organization_id, actor_id, action, entity_id, correlation_id, reason)
      VALUES ($1, $2, $3, 'catalog_offer.unpublished', $4, $5, 'Ocultação explícita do catálogo')`, [randomUUID(), organizationId, actorId, offerId, randomUUID()]);
  });
}

export async function adjustInventoryAuthorized(pool: Pool, input: InventoryAdjustmentInput): Promise<void> {
  requireUuid(input.organizationId, "organizationId");
  requireUuid(input.storeId, "storeId");
  requireUuid(input.inventoryItemId, "inventoryItemId");
  requireUuid(input.balanceId, "balanceId");
  requireUuid(input.movementId, "movementId");
  requireUuid(input.actorId, "actorId");
  const quantityDelta = requireQuantity(input.quantityDelta, "quantityDelta", true);
  if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 500) throw new ApiError(400, "VALIDATION_ERROR", "Invalid reason");
  await withMembershipTransaction(pool, input.organizationId, input.actorId, "OPERATOR", async client => {
    const positiveAdjustment = BigInt(quantityDelta) > 0n;
    if (positiveAdjustment) {
      await client.query(`INSERT INTO app.inventory_balance
        (id, organization_id, store_id, inventory_item_id, on_hand_qty)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (organization_id, store_id, inventory_item_id)
        DO UPDATE SET on_hand_qty = app.inventory_balance.on_hand_qty + EXCLUDED.on_hand_qty,
          version = app.inventory_balance.version + 1, updated_at = now()`,
        [input.balanceId, input.organizationId, input.storeId, input.inventoryItemId, quantityDelta]);
    } else {
      const result = await client.query(`UPDATE app.inventory_balance
        SET on_hand_qty = on_hand_qty + $4, version = version + 1, updated_at = now()
        WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3
          AND on_hand_qty + $4 >= reserved_qty`,
        [input.organizationId, input.storeId, input.inventoryItemId, quantityDelta]);
      if (result.rowCount !== 1) throw new ApiError(409, "CONFLICT", "Inventory adjustment would make available stock invalid");
    }
    await client.query(`INSERT INTO app.inventory_movement
      (id, organization_id, store_id, inventory_item_id, movement_type, quantity_delta, reference_type, reference_id, reason, actor_id)
      VALUES ($1, $2, $3, $4, 'ADJUSTMENT', $5, 'MANUAL_ADJUSTMENT', $1, $6, $7)`,
      [input.movementId, input.organizationId, input.storeId, input.inventoryItemId, quantityDelta, input.reason.trim(), input.actorId]);
  });
}

export async function reserveInventoryAuthorized(pool: Pool, actorId: string, input: InventoryReservationInput): Promise<void> {
  requireUuid(actorId, "actorId");
  requireUuid(input.organizationId, "organizationId");
  requireUuid(input.storeId, "storeId");
  requireUuid(input.inventoryItemId, "inventoryItemId");
  requireUuid(input.reservationId, "reservationId");
  requireUuid(input.referenceId, "referenceId");
  const reservedQty = requireQuantity(input.reservedQty, "reservedQty");
  await withMembershipTransaction(pool, input.organizationId, actorId, "OPERATOR", async client => {
    const result = await client.query(`UPDATE app.inventory_balance
      SET reserved_qty = reserved_qty + $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3
        AND on_hand_qty - reserved_qty >= $4`,
      [input.organizationId, input.storeId, input.inventoryItemId, reservedQty]);
    if (result.rowCount !== 1) throw new ApiError(409, "CONFLICT", "Insufficient available inventory");
    await client.query(`INSERT INTO app.inventory_reservation
      (id, organization_id, store_id, inventory_item_id, reserved_qty, status, reference_type, reference_id, expires_at)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'EXTERNAL_REFERENCE', $6, COALESCE($7, now() + make_interval(mins => $8)))`,
      [input.reservationId, input.organizationId, input.storeId, input.inventoryItemId, reservedQty, input.referenceId, input.expiresAt ?? null, orderReservationTtlMinutes()]);
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
  createPreparationOptionAuthorized as createPreparationOptionWithPermission,
  createInventoryItemAuthorized as createInventoryItemWithPermission,
  createCatalogOfferAuthorized as createCatalogOfferWithPermission,
  publishCatalogOfferAuthorized as publishCatalogOfferWithPermission,
  unpublishCatalogOfferAuthorized as unpublishCatalogOfferWithPermission,
  adjustInventoryAuthorized as adjustInventoryWithPermission,
  reserveInventoryAuthorized as reserveInventoryWithPermission,
};
