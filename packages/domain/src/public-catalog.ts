import { lockOrderForPreparation, refreshOrderPreparation } from "./order-preparation.ts";
import type { Pool } from "pg";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { ApiError } from "./api.ts";
import { createTenantTransaction } from "./database.ts";
import { parseInteger, positive, priceByGrams, priceByUnits, sumMinor } from "./quantities.ts";

import { validateOfferQuantity } from "../../../lib/cart.ts";

type PublicStore = { storeId: string; organizationId: string; storeName: string; storeSlug: string };
type PublicOffer = {
  id: string; productId: string; productName: string; offerName: string; preparationName: string; sku: string;
  saleUnit: "G" | "UNIT" | "FIXED_PACKAGE"; amountMinor: string; currency: string;
  minWeightG: string | null; maxWeightG: string | null; weightStepG: string | null; defaultWeightG: string | null;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireSlug(slug: string): void {
  if (!SLUG.test(slug)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid store slug");
}
function requireUuid(value: string, field: string): void {
  if (!UUID.test(value)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
}
function quantity(value: unknown, field: string): bigint {
  try { return positive(parseInteger(value)); } catch { throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`); }
}

async function resolveStore(pool: Pool, slug: string): Promise<PublicStore> {
  requireSlug(slug);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config($1, $2, true)", ["role", "acougue_runtime"]);
    const result = await client.query<PublicStore>("SELECT store_id AS \"storeId\", organization_id AS \"organizationId\", store_name AS \"storeName\", store_slug AS \"storeSlug\" FROM app.public_store_by_slug($1)", [slug]);
    await client.query("COMMIT");
    const store = result.rows[0];
    if (!store) throw new ApiError(404, "NOT_FOUND", "Loja não encontrada.");
    return store;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listPublicCatalog(pool: Pool, slug: string): Promise<{ store: { id: string; name: string; slug: string }; offers: PublicOffer[] }> {
  const store = await resolveStore(pool, slug);
  const result = await createTenantTransaction(pool)(store.organizationId, async client => client.query<PublicOffer>(`SELECT
      o.id, o.product_id AS "productId", p.name AS "productName", o.sku AS "offerName",
      prep.name AS "preparationName", o.sku, o.sale_unit AS "saleUnit",
      pp.amount_minor::text AS "amountMinor", pp.currency,
      o.min_weight_g::text AS "minWeightG", o.max_weight_g::text AS "maxWeightG",
      o.weight_step_g::text AS "weightStepG", o.default_weight_g::text AS "defaultWeightG"
    FROM app.catalog_offer o
    JOIN app.product p ON p.organization_id = o.organization_id AND p.id = o.product_id AND p.active = true
    JOIN app.preparation_option prep ON prep.organization_id = o.organization_id AND prep.id = o.preparation_option_id AND prep.active = true
    JOIN LATERAL (
      SELECT amount_minor, currency FROM app.product_price price
      WHERE price.organization_id = o.organization_id AND price.store_id = $1
        AND price.product_id = o.product_id AND price.channel = 'STOREFRONT'
      ORDER BY revision DESC LIMIT 1
    ) pp ON true
    WHERE o.organization_id = $2 AND o.active = true AND o.public_visible = true
    ORDER BY p.name, prep.name, o.id`, [store.storeId, store.organizationId]).then(result => result.rows));
  return { store: { id: store.storeId, name: store.storeName, slug: store.storeSlug }, offers: result };
}

export type PublicQuoteInput = { offerId: string; requestedQty: string };
export async function quotePublicCatalog(pool: Pool, slug: string, input: readonly PublicQuoteInput[]): Promise<{ currency: string; items: unknown[]; estimatedTotalMinor: string }> {
  const store = await resolveStore(pool, slug);
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) throw new ApiError(400, "VALIDATION_ERROR", "Informe entre 1 e 100 itens.");
  return createTenantTransaction(pool)(store.organizationId, async client => {
    const ids = new Set<string>();
    const items: Array<{ offerId: string; requestedQty: string; estimatedTotalMinor: string; amountMinor: string; currency: string }> = [];
    for (const line of input) {
      if (!line || typeof line !== "object" || typeof line.offerId !== "string" || !UUID.test(line.offerId) || ids.has(line.offerId)) throw new ApiError(400, "VALIDATION_ERROR", "Oferta inválida ou repetida.");
      if (typeof line.requestedQty !== "string") throw new ApiError(400, "VALIDATION_ERROR", "Quantidade inválida.");
      ids.add(line.offerId);
      const requestedQty = quantity(line.requestedQty, "requestedQty");
      const result = await client.query<PublicOffer>(`SELECT o.id, o.product_id AS "productId", p.name AS "productName", o.sku AS "offerName",
          prep.name AS "preparationName", o.sku, o.sale_unit AS "saleUnit", pp.amount_minor::text AS "amountMinor", pp.currency,
          o.min_weight_g::text AS "minWeightG", o.max_weight_g::text AS "maxWeightG", o.weight_step_g::text AS "weightStepG", o.default_weight_g::text AS "defaultWeightG"
        FROM app.catalog_offer o JOIN app.product p ON p.organization_id=o.organization_id AND p.id=o.product_id AND p.active=true
        JOIN app.preparation_option prep ON prep.organization_id=o.organization_id AND prep.id=o.preparation_option_id AND prep.active=true
        JOIN LATERAL (SELECT amount_minor,currency FROM app.product_price price WHERE price.organization_id=o.organization_id AND price.store_id=$1 AND price.product_id=o.product_id AND price.channel='STOREFRONT' ORDER BY revision DESC LIMIT 1) pp ON true
        WHERE o.organization_id=$2 AND o.id=$3 AND o.active=true AND o.public_visible=true`, [store.storeId, store.organizationId, line.offerId]);
      const offer = result.rows[0];
      if (!offer) throw new ApiError(409, "CONFLICT", "Oferta indisponível ou sem preço atual.");
      validateQuantity(offer, line.requestedQty);
      const total = offer.saleUnit === "G" ? priceByGrams(BigInt(offer.amountMinor), requestedQty) : priceByUnits(BigInt(offer.amountMinor), requestedQty);
      items.push({ offerId: offer.id, requestedQty: requestedQty.toString(), estimatedTotalMinor: total.toString(), amountMinor: offer.amountMinor, currency: offer.currency });
    }
    const currencies = new Set(items.map(item => item.currency));
    if (currencies.size !== 1) throw new ApiError(409, "CONFLICT", "As ofertas possuem moedas incompatíveis.");
    return { currency: items[0]!.currency, items, estimatedTotalMinor: sumMinor(items.map(item => BigInt(item.estimatedTotalMinor))).toString() };
  });
}
function validateQuantity(offer: PublicOffer, value: string): void {
  try { validateOfferQuantity(offer, value); } catch (error) { throw new ApiError(400, "VALIDATION_ERROR", error instanceof Error ? error.message : "Quantidade inválida."); }
}
function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
  return value.trim();
}
function accessToken(secret: string, organizationId: string, idempotencyKey: string): string {
  return createHmac("sha256", secret).update(`${organizationId}:${idempotencyKey}`).digest("base64url");
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type PublicCheckoutItem = { id: string; offerId: string; requestedQty: string; customerNote?: string | null };
export type PublicCheckoutInput = {
  idempotencyKey: string;
  requestHash: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: "PICKUP" | "DELIVERY";
  currency: string;
  customerNote?: string | null;
  items: readonly PublicCheckoutItem[];
};

export async function createPublicOrder(pool: Pool, slug: string, input: PublicCheckoutInput): Promise<{ orderId: string; publicNumber: string; accessToken: string; estimatedTotalMinor: string }> {
  const store = await resolveStore(pool, slug);
  const secret = process.env.ORDER_ACCESS_SECRET;
  if (!secret || secret.length < 32) throw new ApiError(503, "PRECONDITION_REQUIRED", "O acompanhamento público ainda não está configurado.");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) throw new ApiError(400, "VALIDATION_ERROR", "Idempotency-Key inválida.");
  if (!/^[a-f0-9]{64}$/.test(input.requestHash)) throw new ApiError(400, "VALIDATION_ERROR", "Hash da requisição inválido.");
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new ApiError(400, "VALIDATION_ERROR", "Informe entre 1 e 100 itens.");
  const customerName = requiredText(input.customerName, "customerName", 200);
  const customerPhone = requiredText(input.customerPhone, "customerPhone", 40);
  if (input.fulfillmentType !== "PICKUP" && input.fulfillmentType !== "DELIVERY") throw new ApiError(400, "VALIDATION_ERROR", "Tipo de atendimento inválido.");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ApiError(400, "VALIDATION_ERROR", "Moeda inválida.");
  const scopedKey = hash(`${store.storeId}:${input.idempotencyKey}`);
  const token = accessToken(secret, store.organizationId, scopedKey);
  const tokenHash = hash(token);

  return createTenantTransaction(pool)(store.organizationId, async client => {
    const idempotency = await client.query<{ id: string; requestHash: string; orderId: string | null; publicNumber: string | null }>(`INSERT INTO app.idempotency_record
      (id, organization_id, idempotency_key, operation, request_hash, response_status)
      VALUES ($1, $2, $3, 'PUBLIC_ORDER_CREATE', $4, 201)
      ON CONFLICT (organization_id, idempotency_key, operation) DO NOTHING
      RETURNING id, request_hash AS "requestHash", order_id AS "orderId", public_number AS "publicNumber"`,
      [randomUUID(), store.organizationId, scopedKey, input.requestHash]);
    const record = idempotency.rows[0] ?? (await client.query<{ id: string; requestHash: string; orderId: string | null; publicNumber: string | null }>(`SELECT id, request_hash AS "requestHash", order_id AS "orderId", public_number AS "publicNumber" FROM app.idempotency_record WHERE organization_id=$1 AND idempotency_key=$2 AND operation='PUBLIC_ORDER_CREATE' FOR UPDATE`, [store.organizationId, scopedKey])).rows[0];
    if (!record) throw new ApiError(409, "CONFLICT", "Não foi possível reservar a chave idempotente.");
    if (record.requestHash !== input.requestHash) throw new ApiError(409, "CONFLICT", "A chave idempotente foi reutilizada com dados diferentes.");
    if (record.orderId && record.publicNumber) {
      const existing = await client.query<{ estimatedTotalMinor: string }>(`SELECT estimated_total_minor::text AS "estimatedTotalMinor" FROM app.sales_order WHERE organization_id=$1 AND id=$2`, [store.organizationId, record.orderId]);
      return { orderId: record.orderId, publicNumber: record.publicNumber, accessToken: token, estimatedTotalMinor: existing.rows[0]?.estimatedTotalMinor ?? "0" };
    }

    const ids = new Set<string>();
    const offerIds = new Set<string>();
    const lines: Array<{ item: PublicCheckoutItem; inventoryItemId: string; productName: string; offerName: string; preparationName: string; sku: string; pricingType: string; unitPriceMinor: bigint; requestedQty: bigint; estimatedTotalMinor: bigint }> = [];
    for (const item of input.items) {
      if (!item || typeof item !== "object" || !UUID.test(item.id) || !UUID.test(item.offerId) || ids.has(item.id) || offerIds.has(item.offerId)) throw new ApiError(400, "VALIDATION_ERROR", "Item inválido ou repetido.");
      ids.add(item.id);
      offerIds.add(item.offerId);
      const requestedQty = quantity(item.requestedQty, "requestedQty");
      const offer = (await client.query<PublicOffer & { inventoryItemId: string; baseUnit: string }>(`SELECT o.inventory_item_id AS "inventoryItemId", p.name AS "productName", o.sku AS "offerName", prep.name AS "preparationName", o.sku, o.sale_unit AS "saleUnit", pp.amount_minor::text AS "amountMinor", pp.currency, inv.base_unit AS "baseUnit", o.min_weight_g::text AS "minWeightG", o.max_weight_g::text AS "maxWeightG", o.weight_step_g::text AS "weightStepG"
        FROM app.catalog_offer o JOIN app.product p ON p.organization_id=o.organization_id AND p.id=o.product_id AND p.active=true
        JOIN app.preparation_option prep ON prep.organization_id=o.organization_id AND prep.id=o.preparation_option_id AND prep.active=true
        JOIN app.inventory_item inv ON inv.organization_id=o.organization_id AND inv.id=o.inventory_item_id AND inv.active=true
        JOIN LATERAL (SELECT amount_minor,currency FROM app.product_price price WHERE price.organization_id=o.organization_id AND price.store_id=$1 AND price.product_id=o.product_id AND price.channel='STOREFRONT' ORDER BY revision DESC LIMIT 1) pp ON true
        WHERE o.organization_id=$2 AND o.id=$3 AND o.active=true AND o.public_visible=true`, [store.storeId, store.organizationId, item.offerId])).rows[0];
      if (!offer) throw new ApiError(409, "CONFLICT", "Uma oferta está indisponível ou sem preço atual.");
      validateQuantity(offer, item.requestedQty);
      if (offer.currency !== input.currency) throw new ApiError(409, "CONFLICT", "A moeda da oferta mudou. Atualize o carrinho.");
      if (offer.baseUnit !== offer.saleUnit) throw new ApiError(409, "CONFLICT", "A unidade de estoque desta oferta é incompatível.");
      const pricingType = offer.saleUnit === "G" ? "PER_KG" : offer.saleUnit === "UNIT" ? "PER_UNIT" : "FIXED_PACKAGE";
      const unitPriceMinor = BigInt(offer.amountMinor);
      const estimatedTotalMinor = offer.saleUnit === "G" ? priceByGrams(unitPriceMinor, requestedQty) : priceByUnits(unitPriceMinor, requestedQty);
      lines.push({ item, inventoryItemId: offer.inventoryItemId, productName: offer.productName, offerName: offer.offerName, preparationName: offer.preparationName, sku: offer.sku, pricingType, unitPriceMinor, requestedQty, estimatedTotalMinor });
    }
    const estimatedSubtotalMinor = sumMinor(lines.map(line => line.estimatedTotalMinor));
    const orderId = input.orderId;
    requireUuid(orderId, "orderId");
    await client.query(`INSERT INTO app.sales_order (id, organization_id, store_id, public_access_token_hash, fulfillment_type, customer_name, customer_phone, customer_note, currency, estimated_subtotal_minor, estimated_total_minor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`, [orderId, store.organizationId, store.storeId, tokenHash, input.fulfillmentType, customerName, customerPhone, input.customerNote ?? null, input.currency, estimatedSubtotalMinor.toString()]);
    for (const line of lines) {
      await client.query(`INSERT INTO app.order_item (id, organization_id, order_id, offer_id, inventory_item_id, product_name_snapshot, offer_name_snapshot, preparation_name_snapshot, sku_snapshot, pricing_type_snapshot, unit_price_minor_snapshot, requested_qty, reserved_qty, estimated_total_minor, customer_note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14)`, [line.item.id, store.organizationId, orderId, line.item.offerId, line.inventoryItemId, line.productName, line.offerName, line.preparationName, line.sku, line.pricingType, line.unitPriceMinor.toString(), line.requestedQty.toString(), line.estimatedTotalMinor.toString(), line.item.customerNote ?? null]);
      const reserved = await client.query(`UPDATE app.inventory_balance SET reserved_qty=reserved_qty+$4, version=version+1, updated_at=now() WHERE organization_id=$1 AND store_id=$2 AND inventory_item_id=$3 AND on_hand_qty-reserved_qty >= $4`, [store.organizationId, store.storeId, line.inventoryItemId, line.requestedQty.toString()]);
      if (reserved.rowCount !== 1) throw new ApiError(409, "CONFLICT", "Estoque insuficiente para um dos itens.");
      await client.query(`INSERT INTO app.inventory_reservation (id, organization_id, store_id, inventory_item_id, reserved_qty, status, reference_type, reference_id, order_id, order_item_id) VALUES ($1,$2,$3,$4,$5,'ACTIVE','ORDER_ITEM',$6,$7,$6)`, [randomUUID(), store.organizationId, store.storeId, line.inventoryItemId, line.requestedQty.toString(), line.item.id, orderId]);
    }
    await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload) VALUES ($1,$2,$3,'ORDER_CREATED',$4::jsonb)`, [randomUUID(), store.organizationId, orderId, JSON.stringify({ public: true, itemCount: lines.length })]);
    const created = await client.query<{ publicNumber: string }>(`SELECT public_number::text AS "publicNumber" FROM app.sales_order WHERE organization_id=$1 AND id=$2`, [store.organizationId, orderId]);
    const publicNumber = created.rows[0]!.publicNumber;
    await client.query(`UPDATE app.idempotency_record SET order_id=$1, public_number=$2 WHERE id=$3`, [orderId, publicNumber, record.id]);
    return { orderId, publicNumber, accessToken: token, estimatedTotalMinor: estimatedSubtotalMinor.toString() };
  });
}

export async function getPublicOrder(pool: Pool, slug: string, publicNumber: string, token: string): Promise<{ publicNumber: string; status: string; fulfillmentStatus: string; estimatedTotalMinor: string; finalTotalMinor: string | null; items: unknown[] }> {
  const store = await resolveStore(pool, slug);
  if (!/^\d{1,20}$/.test(publicNumber) || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new ApiError(404, "NOT_FOUND", "Pedido não encontrado.");
  const tokenHash = hash(token);
  return createTenantTransaction(pool)(store.organizationId, async client => {
    const order = await client.query<{ publicNumber: string; status: string; fulfillmentStatus: string; estimatedTotalMinor: string; finalTotalMinor: string | null }>(`SELECT public_number::text AS "publicNumber", order_status AS status, fulfillment_status AS "fulfillmentStatus", estimated_total_minor::text AS "estimatedTotalMinor", final_total_minor::text AS "finalTotalMinor"
      FROM app.sales_order WHERE organization_id=$1 AND store_id=$2 AND public_number=$3 AND public_access_token_hash=$4`, [store.organizationId, store.storeId, publicNumber, tokenHash]);
    const found = order.rows[0];
    if (!found) throw new ApiError(404, "NOT_FOUND", "Pedido não encontrado.");
    const items = await client.query(`SELECT id, product_name_snapshot AS "productName", preparation_name_snapshot AS "preparationName", requested_qty::text AS "requestedQty", final_qty::text AS "finalQty", estimated_total_minor::text AS "estimatedTotalMinor", final_total_minor::text AS "finalTotalMinor", status FROM app.order_item WHERE organization_id=$1 AND order_id=(SELECT id FROM app.sales_order WHERE organization_id=$1 AND public_number=$2 AND public_access_token_hash=$3) ORDER BY created_at,id`, [store.organizationId, publicNumber, tokenHash]);
    return { ...found, items: items.rows };
  });
}

export async function approvePublicOrderItem(pool: Pool, slug: string, publicNumber: string, token: string, orderItemId: string): Promise<{ finalTotalMinor: string | null }> {
  const store = await resolveStore(pool, slug);
  requireUuid(orderItemId, "orderItemId");
  if (!/^\d{1,20}$/.test(publicNumber) || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new ApiError(404, "NOT_FOUND", "Pedido não encontrado.");
  return createTenantTransaction(pool)(store.organizationId, async client => {
    const order = await client.query<{ id: string }>(`SELECT id FROM app.sales_order WHERE organization_id=$1 AND store_id=$2 AND public_number=$3 AND public_access_token_hash=$4 FOR UPDATE`, [store.organizationId,store.storeId,publicNumber,hash(token)]);
    if (!order.rows[0]) throw new ApiError(404, "NOT_FOUND", "Pedido não encontrado.");
    await lockOrderForPreparation(client, store.organizationId, order.rows[0].id);
    const item = await client.query<{ finalTotalMinor: string | null; orderId: string }>(`UPDATE app.order_item item SET status='RESOLVED', updated_at=now()
      WHERE item.organization_id=$1 AND item.id=$2 AND item.status='WAITING_CUSTOMER_APPROVAL'
        AND item.order_id=(SELECT id FROM app.sales_order WHERE organization_id=$1 AND store_id=$3 AND public_number=$4 AND public_access_token_hash=$5)
      RETURNING item.final_total_minor::text AS "finalTotalMinor", item.order_id AS "orderId"`, [store.organizationId, orderItemId, store.storeId, publicNumber, hash(token)]);
    const resolved = item.rows[0];
    if (!resolved) throw new ApiError(409, "CONFLICT", "Este item não está aguardando aprovação.");
    await refreshOrderPreparation(client, store.organizationId, resolved.orderId);
    await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload) VALUES ($1,$2,$3,'ORDER_ITEM_APPROVED',$4::jsonb)`, [randomUUID(), store.organizationId, resolved.orderId, JSON.stringify({ orderItemId, public: true })]);
    return { finalTotalMinor: resolved.finalTotalMinor };
  });
}