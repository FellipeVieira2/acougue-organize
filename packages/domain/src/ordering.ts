import { lockOrderForPreparation, refreshOrderPreparation } from "./order-preparation.ts";
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { ApiError } from "./api.ts";
import { withMembershipTransaction } from "./membership.ts";
import { parseInteger, positive, priceByGrams, priceByUnits, sumMinor } from "./quantities.ts";

type FulfillmentType = "PICKUP" | "DELIVERY";

type OrderLineInput = {
  id: string;
  offerId: string;
  requestedQty: string;
  reservedQty: string;
  minAcceptableQty?: string | null;
  maxAcceptableQty?: string | null;
  maxTotalMinor?: string | null;
  customerNote?: string | null;
};

export type CreateOrderInput = {
  organizationId: string;
  storeId: string;
  orderId: string;
  actorId: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: FulfillmentType;
  currency: string;
  deliveryFeeMinor?: string;
  discountMinor?: string;
  customerNote?: string | null;
  items: readonly OrderLineInput[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: string, field: string): void {
  if (typeof value !== "string" || !UUID.test(value)) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
}
function quantity(value: string, field: string): bigint {
  try { return positive(parseInteger(value)); } catch { throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`); }
}
function optionalQuantity(value: string | null | undefined, field: string): bigint | null {
  if (value === undefined || value === null) return null;
  return quantity(value, field);
}
function money(value: string | undefined, field: string): bigint {
  try { return parseInteger(value ?? "0"); } catch { throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`); }
}
function text(value: string, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new ApiError(400, "VALIDATION_ERROR", `Invalid ${field}`);
  return value.trim();
}

export async function createOrderAuthorized(pool: Pool, input: CreateOrderInput): Promise<{ orderId: string; publicNumber: string; estimatedTotalMinor: string }> {
  uuid(input.organizationId, "organizationId");
  uuid(input.storeId, "storeId");
  uuid(input.orderId, "orderId");
  uuid(input.actorId, "actorId");
  if (input.fulfillmentType !== "PICKUP" && input.fulfillmentType !== "DELIVERY") throw new ApiError(400, "VALIDATION_ERROR", "Invalid fulfillment type");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new ApiError(400, "VALIDATION_ERROR", "Invalid currency");
  if (!Array.isArray(input.items) || input.items.length === 0 || input.items.length > 500) throw new ApiError(400, "VALIDATION_ERROR", "Order must have between 1 and 500 items");
  const deliveryFeeMinor = money(input.deliveryFeeMinor, "deliveryFeeMinor");
  const discountMinor = money(input.discountMinor, "discountMinor");
  const customerName = text(input.customerName, "customerName", 200);
  const customerPhone = text(input.customerPhone, "customerPhone", 40);

  return withMembershipTransaction(pool, input.organizationId, input.actorId, "OPERATOR", async client => {
    const ids = new Set<string>();
    const lines: Array<{
      input: OrderLineInput; offerId: string; inventoryItemId: string; productName: string; offerName: string;
      preparationName: string; sku: string; pricingType: "PER_KG" | "PER_UNIT" | "FIXED_PACKAGE";
      unitPriceMinor: bigint; requestedQty: bigint; reservedQty: bigint; minQty: bigint | null; maxQty: bigint | null;
      maxTotalMinor: bigint | null; estimatedTotalMinor: bigint;
    }> = [];

    for (const item of input.items) {
      uuid(item.id, "item id");
      uuid(item.offerId, "offer id");
      if (ids.has(item.id)) throw new ApiError(400, "VALIDATION_ERROR", "Order item IDs must be unique");
      ids.add(item.id);
      const requestedQty = quantity(item.requestedQty, "requestedQty");
      const reservedQty = quantity(item.reservedQty, "reservedQty");
      if (reservedQty < requestedQty) throw new ApiError(400, "VALIDATION_ERROR", "Reserved quantity cannot be below requested quantity");
      const minQty = optionalQuantity(item.minAcceptableQty, "minAcceptableQty");
      const maxQty = optionalQuantity(item.maxAcceptableQty, "maxAcceptableQty");
      if (minQty !== null && maxQty !== null && minQty > maxQty) throw new ApiError(400, "VALIDATION_ERROR", "Invalid acceptable quantity range");
      const maxTotalMinor = item.maxTotalMinor === undefined || item.maxTotalMinor === null ? null : money(item.maxTotalMinor, "maxTotalMinor");
      const result = await client.query<{
        inventoryItemId: string; productName: string; offerName: string; preparationName: string; sku: string;
        saleUnit: "G" | "UNIT" | "FIXED_PACKAGE"; inventoryUnit: "G" | "UNIT"; amountMinor: string;
      }>(`SELECT o.inventory_item_id AS "inventoryItemId", p.name AS "productName", o.sku AS "offerName",
          prep.name AS "preparationName", o.sku, o.sale_unit AS "saleUnit", i.base_unit AS "inventoryUnit", pp.amount_minor AS "amountMinor"
        FROM app.catalog_offer o
        JOIN app.product p ON p.organization_id = o.organization_id AND p.id = o.product_id
        JOIN app.preparation_option prep ON prep.organization_id = o.organization_id AND prep.id = o.preparation_option_id
        JOIN app.inventory_item i ON i.organization_id = o.organization_id AND i.id = o.inventory_item_id
        JOIN app.product_price pp ON pp.organization_id = o.organization_id AND pp.product_id = o.product_id AND pp.store_id = $2
          AND pp.channel = 'STOREFRONT'
        WHERE o.organization_id = $1 AND o.id = $3 AND o.active = true AND o.public_visible = true
        ORDER BY pp.revision DESC LIMIT 1`, [input.organizationId, input.storeId, item.offerId]);
      const offer = result.rows[0];
      if (!offer) throw new ApiError(409, "CONFLICT", "Offer is unavailable or has no current storefront price");
      if (offer.inventoryUnit === "UNIT" && offer.saleUnit !== "UNIT") throw new ApiError(409, "CONFLICT", "Offer unit is incompatible with inventory");
      if (offer.inventoryUnit === "G" && offer.saleUnit === "UNIT") throw new ApiError(409, "CONFLICT", "Offer unit is incompatible with inventory");
      const pricingType = offer.saleUnit === "G" ? "PER_KG" : offer.saleUnit === "UNIT" ? "PER_UNIT" : "FIXED_PACKAGE";
      const unitPriceMinor = BigInt(offer.amountMinor);
      const estimatedTotalMinor = pricingType === "PER_KG" ? priceByGrams(unitPriceMinor, requestedQty) : priceByUnits(unitPriceMinor, requestedQty);
      lines.push({ input: item, offerId: item.offerId, inventoryItemId: offer.inventoryItemId, productName: offer.productName, offerName: offer.offerName, preparationName: offer.preparationName, sku: offer.sku, pricingType, unitPriceMinor, requestedQty, reservedQty, minQty, maxQty, maxTotalMinor, estimatedTotalMinor });
    }

    const estimatedSubtotalMinor = sumMinor(lines.map(line => line.estimatedTotalMinor));
    const estimatedTotalMinor = estimatedSubtotalMinor + deliveryFeeMinor - (discountMinor > estimatedSubtotalMinor + deliveryFeeMinor ? estimatedSubtotalMinor + deliveryFeeMinor : discountMinor);
    await client.query(`INSERT INTO app.sales_order
      (id, organization_id, store_id, order_status, fulfillment_status, fulfillment_type, customer_name, customer_phone, customer_note, currency, estimated_subtotal_minor, delivery_fee_minor, discount_minor, estimated_total_minor)
      VALUES ($1, $2, $3, 'RECEIVED', 'RECEIVED', $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [input.orderId, input.organizationId, input.storeId, input.fulfillmentType, customerName, customerPhone, input.customerNote ?? null, input.currency, estimatedSubtotalMinor.toString(), deliveryFeeMinor.toString(), discountMinor.toString(), estimatedTotalMinor.toString()]);

    for (const line of lines) {
      const item = line.input;
      await client.query(`INSERT INTO app.order_item
        (id, organization_id, order_id, offer_id, inventory_item_id, product_name_snapshot, offer_name_snapshot, preparation_name_snapshot, sku_snapshot, pricing_type_snapshot, unit_price_minor_snapshot, requested_qty, reserved_qty, min_acceptable_qty, max_acceptable_qty, max_total_minor, estimated_total_minor, customer_note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [item.id, input.organizationId, input.orderId, line.offerId, line.inventoryItemId, line.productName, line.offerName, line.preparationName, line.sku, line.pricingType, line.unitPriceMinor.toString(), line.requestedQty.toString(), line.reservedQty.toString(), line.minQty?.toString() ?? null, line.maxQty?.toString() ?? null, line.maxTotalMinor?.toString() ?? null, line.estimatedTotalMinor.toString(), item.customerNote ?? null]);
      const reserved = await client.query(`UPDATE app.inventory_balance
        SET reserved_qty = reserved_qty + $4, version = version + 1, updated_at = now()
        WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3
          AND on_hand_qty - reserved_qty >= $4`, [input.organizationId, input.storeId, line.inventoryItemId, line.reservedQty.toString()]);
      if (reserved.rowCount !== 1) throw new ApiError(409, "CONFLICT", "Insufficient available inventory");
      await client.query(`INSERT INTO app.inventory_reservation
        (id, organization_id, store_id, inventory_item_id, reserved_qty, status, reference_type, reference_id, order_id, order_item_id)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'ORDER_ITEM', $6, $7, $8)`,
        [randomUUID(), input.organizationId, input.storeId, line.inventoryItemId, line.reservedQty.toString(), item.id, input.orderId, item.id]);
    }
    await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload, actor_id)
      VALUES ($1, $2, $3, 'ORDER_CREATED', $4::jsonb, $5)`, [randomUUID(), input.organizationId, input.orderId, JSON.stringify({ itemCount: lines.length }), input.actorId]);
    const created = await client.query<{ publicNumber: string }>(`SELECT public_number AS "publicNumber" FROM app.sales_order WHERE organization_id = $1 AND id = $2`, [input.organizationId, input.orderId]);
    return { orderId: input.orderId, publicNumber: created.rows[0]!.publicNumber, estimatedTotalMinor: estimatedTotalMinor.toString() };
  });
}

export type WeighOrderItemInput = {
  organizationId: string;
  orderId: string;
  orderItemId: string;
  actorId: string;
  finalQty: string;
};

export async function weighOrderItemAuthorized(pool: Pool, input: WeighOrderItemInput): Promise<{ finalTotalMinor: string; requiresApproval: boolean }> {
  uuid(input.organizationId, "organizationId");
  uuid(input.orderId, "orderId");
  uuid(input.orderItemId, "orderItemId");
  uuid(input.actorId, "actorId");
  const finalQty = quantity(input.finalQty, "finalQty");

  return withMembershipTransaction(pool, input.organizationId, input.actorId, "OPERATOR", async client => {
    await lockOrderForPreparation(client, input.organizationId, input.orderId);
    const itemResult = await client.query<{
      inventoryItemId: string; requestedQty: string; reservedQty: string; minQty: string | null; maxQty: string | null;
      maxTotalMinor: string | null; unitPriceMinor: string; pricingType: "PER_KG" | "PER_UNIT" | "FIXED_PACKAGE"; status: string;
    }>(`SELECT inventory_item_id AS "inventoryItemId", requested_qty AS "requestedQty", reserved_qty AS "reservedQty",
        min_acceptable_qty AS "minQty", max_acceptable_qty AS "maxQty", max_total_minor AS "maxTotalMinor",
        unit_price_minor_snapshot AS "unitPriceMinor", pricing_type_snapshot AS "pricingType", status
      FROM app.order_item
      WHERE organization_id = $1 AND order_id = $2 AND id = $3
      FOR UPDATE`, [input.organizationId, input.orderId, input.orderItemId]);
    const item = itemResult.rows[0];
    if (!item) throw new ApiError(404, "NOT_FOUND", "Order item not found");
    if (!["PENDING", "SEPARATING", "WEIGHING"].includes(item.status)) throw new ApiError(409, "CONFLICT", "Order item has already been resolved");
    const reservedQty = BigInt(item.reservedQty);
    if (finalQty > reservedQty) throw new ApiError(409, "CONFLICT", "Final quantity exceeds the reservation buffer");
    const minQty = item.minQty === null ? BigInt(item.requestedQty) : BigInt(item.minQty);
    const maxQty = item.maxQty === null ? BigInt(item.requestedQty) : BigInt(item.maxQty);
    const finalTotalMinor = item.pricingType === "PER_KG" ? priceByGrams(BigInt(item.unitPriceMinor), finalQty) : priceByUnits(BigInt(item.unitPriceMinor), finalQty);
    const requiresApproval = finalQty < minQty || finalQty > maxQty || (item.maxTotalMinor !== null && finalTotalMinor > BigInt(item.maxTotalMinor));

    const reservationResult = await client.query<{ id: string }>(`SELECT id FROM app.inventory_reservation
      WHERE organization_id = $1 AND order_id = $2 AND order_item_id = $3 AND status = 'ACTIVE'
      FOR UPDATE`, [input.organizationId, input.orderId, input.orderItemId]);
    const reservation = reservationResult.rows[0];
    if (!reservation) throw new ApiError(409, "CONFLICT", "Active inventory reservation not found");

    const balance = await client.query(`UPDATE app.inventory_balance
      SET on_hand_qty = on_hand_qty - $4, reserved_qty = reserved_qty - $5, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND store_id = (SELECT store_id FROM app.sales_order WHERE organization_id = $1 AND id = $2)
        AND inventory_item_id = $3 AND on_hand_qty >= $4 AND reserved_qty >= $5`,
      [input.organizationId, input.orderId, item.inventoryItemId, finalQty.toString(), reservedQty.toString()]);
    if (balance.rowCount !== 1) throw new ApiError(409, "CONFLICT", "Inventory balance cannot be consumed");
    await client.query(`UPDATE app.inventory_reservation
      SET status = 'CONSUMED', consumed_qty = $4, released_qty = $5, consumed_at = now(), released_at = CASE WHEN $5::bigint > 0 THEN now() ELSE released_at END
      WHERE id = $1 AND organization_id = $2 AND order_item_id = $3 AND status = 'ACTIVE'`,
      [reservation.id, input.organizationId, input.orderItemId, finalQty.toString(), (reservedQty - finalQty).toString()]);
    await client.query(`INSERT INTO app.inventory_movement
      (id, organization_id, store_id, inventory_item_id, movement_type, quantity_delta, reference_type, reference_id, reason, actor_id)
      SELECT $1, $2, store_id, $3, 'SALE', $4, 'ORDER_ITEM', $5, 'Final weighing', $7
      FROM app.sales_order WHERE organization_id = $2 AND id = $6`,
      [randomUUID(), input.organizationId, item.inventoryItemId, (-finalQty).toString(), input.orderItemId, input.orderId, input.actorId]);
    await client.query(`UPDATE app.order_item SET final_qty = $4, final_total_minor = $5, status = $6, updated_at = now()
      WHERE organization_id = $1 AND order_id = $2 AND id = $3`,
      [input.organizationId, input.orderId, input.orderItemId, finalQty.toString(), finalTotalMinor.toString(), requiresApproval ? "WAITING_CUSTOMER_APPROVAL" : "RESOLVED"]);

    await refreshOrderPreparation(client, input.organizationId, input.orderId);
    await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload, actor_id)
      VALUES ($1, $2, $3, 'ORDER_ITEM_WEIGHED', $4::jsonb, $5)`, [randomUUID(), input.organizationId, input.orderId, JSON.stringify({ orderItemId: input.orderItemId, finalQty: finalQty.toString(), requiresApproval }), input.actorId]);
    return { finalTotalMinor: finalTotalMinor.toString(), requiresApproval };
  });
}

export type ApproveOrderItemInput = {
  organizationId: string;
  orderId: string;
  orderItemId: string;
  actorId: string;
};

export async function approveOrderItemAuthorized(pool: Pool, input: ApproveOrderItemInput): Promise<{ finalTotalMinor: string }> {
  uuid(input.organizationId, "organizationId");
  uuid(input.orderId, "orderId");
  uuid(input.orderItemId, "orderItemId");
  uuid(input.actorId, "actorId");
  return withMembershipTransaction(pool, input.organizationId, input.actorId, "OPERATOR", async client => {
    await lockOrderForPreparation(client, input.organizationId, input.orderId);
    const updated = await client.query<{ finalTotalMinor: string }>(`UPDATE app.order_item
      SET status = 'RESOLVED', updated_at = now()
      WHERE organization_id = $1 AND order_id = $2 AND id = $3 AND status = 'WAITING_CUSTOMER_APPROVAL'
      RETURNING final_total_minor AS "finalTotalMinor"`, [input.organizationId, input.orderId, input.orderItemId]);
    const item = updated.rows[0];
    if (!item) throw new ApiError(409, "CONFLICT", "Order item is not waiting for approval");

    await refreshOrderPreparation(client, input.organizationId, input.orderId);
    await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload, actor_id)
      VALUES ($1, $2, $3, 'ORDER_ITEM_APPROVED', $4::jsonb, $5)`, [randomUUID(), input.organizationId, input.orderId, JSON.stringify({ orderItemId: input.orderItemId }), input.actorId]);
    return { finalTotalMinor: item.finalTotalMinor };
  });
}
