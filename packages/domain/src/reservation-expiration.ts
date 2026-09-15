import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { createTenantTransaction } from "./database.ts";
import { cleanupRateLimitBuckets } from "./rate-limit.ts";

const DEFAULT_BATCH_SIZE = 100;

export type ReservationExpirationMetrics = {
  organizations: number;
  candidates: number;
  expiredReservations: number;
  affectedOrders: number;
  canceledOrders: number;
  failed: number;
};

async function expireOrder(client: PoolClient, organizationId: string, orderId: string): Promise<{ expired: number; canceled: number }> {
  const order = (await client.query<{ fulfillmentStatus: string; orderStatus: string; storeId: string }>(
    `SELECT fulfillment_status AS "fulfillmentStatus", order_status AS "orderStatus", store_id AS "storeId"
     FROM app.sales_order WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, orderId])).rows[0];
  if (!order || order.orderStatus === "CANCELED" || order.orderStatus === "COMPLETED" || order.fulfillmentStatus !== "RECEIVED") return { expired: 0, canceled: 0 };

  const reservations = await client.query<{ id: string; inventoryItemId: string; reservedQty: string }>(
    `SELECT id, inventory_item_id AS "inventoryItemId", reserved_qty::text AS "reservedQty"
     FROM app.inventory_reservation
     WHERE organization_id=$1 AND order_id=$2 AND status='ACTIVE'
       AND expires_at IS NOT NULL AND expires_at <= now()
     FOR UPDATE`, [organizationId, orderId]);
  if (reservations.rowCount === 0) return { expired: 0, canceled: 0 };

  for (const reservation of reservations.rows) {
    const balance = await client.query(
      `UPDATE app.inventory_balance SET reserved_qty=reserved_qty-$4, version=version+1, updated_at=now()
       WHERE organization_id=$1 AND store_id=$2 AND inventory_item_id=$3 AND reserved_qty >= $4`,
      [organizationId, order.storeId, reservation.inventoryItemId, reservation.reservedQty]);
    if (balance.rowCount !== 1) throw new Error("Inventory balance cannot release expired reservation");
    await client.query(
      `UPDATE app.inventory_reservation SET status='EXPIRED', released_qty=reserved_qty, released_at=now()
       WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'`, [organizationId, reservation.id]);
  }

  await client.query(`UPDATE app.order_item SET status='CANCELED', updated_at=now() WHERE organization_id=$1 AND order_id=$2 AND status <> 'CANCELED'`, [organizationId, orderId]);
  await client.query(`UPDATE app.sales_order SET order_status='CANCELED', fulfillment_status='CANCELED', version=version+1, updated_at=now(), canceled_at=now() WHERE organization_id=$1 AND id=$2 AND order_status NOT IN ('CANCELED','COMPLETED')`, [organizationId, orderId]);
  await client.query(
    `INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload)
     VALUES ($1,$2,$3,'ORDER_RESERVATION_EXPIRED',$4::jsonb)`,
    [randomUUID(), organizationId, orderId, JSON.stringify({ reservationIds: reservations.rows.map(row => row.id), reason: "automatic_timeout" })]);
  await client.query(
    `INSERT INTO app.audit_log (id, organization_id, actor_id, actor_type, action, entity_id, reason, correlation_id)
     VALUES ($1,$2,NULL,'SYSTEM','order.reservations_expired',$3,$4,$1)`,
    [randomUUID(), organizationId, orderId, "Automatic reservation timeout"]);
  return { expired: reservations.rows.length, canceled: 1 };
}

async function expireStandaloneReservation(client: PoolClient, organizationId: string, reservationId: string): Promise<number> {
  const reservation = (await client.query<{ storeId: string; inventoryItemId: string; reservedQty: string }>(
    `SELECT store_id AS "storeId", inventory_item_id AS "inventoryItemId", reserved_qty::text AS "reservedQty"
     FROM app.inventory_reservation
     WHERE organization_id=$1 AND id=$2 AND status='ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now()
     FOR UPDATE`, [organizationId, reservationId])).rows[0];
  if (!reservation) return 0;
  const balance = await client.query(
    `UPDATE app.inventory_balance SET reserved_qty=reserved_qty-$4, version=version+1, updated_at=now()
     WHERE organization_id=$1 AND store_id=$2 AND inventory_item_id=$3 AND reserved_qty >= $4`,
    [organizationId, reservation.storeId, reservation.inventoryItemId, reservation.reservedQty]);
  if (balance.rowCount !== 1) throw new Error("Inventory balance cannot release expired reservation");
  await client.query(`UPDATE app.inventory_reservation SET status='EXPIRED', released_qty=reserved_qty, released_at=now() WHERE organization_id=$1 AND id=$2 AND status='ACTIVE'`, [organizationId, reservationId]);
  return 1;
}

export async function expireExpiredReservations(pool: Pool, batchSize = DEFAULT_BATCH_SIZE): Promise<ReservationExpirationMetrics> {
  const limit = Number.isInteger(batchSize) && batchSize > 0 ? Math.min(batchSize, 500) : DEFAULT_BATCH_SIZE;
  const organizations = (await pool.query<{ id: string }>(`SELECT id FROM app.expirable_organization_ids()`)).rows;
  const metrics: ReservationExpirationMetrics = { organizations: organizations.length, candidates: 0, expiredReservations: 0, affectedOrders: 0, canceledOrders: 0, failed: 0 };
  for (const organization of organizations) {
    const candidates = (await createTenantTransaction(pool)(organization.id, client => client.query<{ orderId: string }>(
      `SELECT order_id AS "orderId" FROM app.inventory_reservation
       JOIN app.sales_order ON sales_order.organization_id=inventory_reservation.organization_id AND sales_order.id=inventory_reservation.order_id
       WHERE inventory_reservation.organization_id=$1 AND inventory_reservation.status='ACTIVE' AND inventory_reservation.order_id IS NOT NULL
         AND expires_at IS NOT NULL AND expires_at <= now()
         AND sales_order.fulfillment_status='RECEIVED'
       GROUP BY order_id ORDER BY min(expires_at), order_id LIMIT $2`, [organization.id, limit]))).rows;
    metrics.candidates += candidates.length;
    for (const candidate of candidates) {
      try {
        const result = await createTenantTransaction(pool)(organization.id, client => expireOrder(client, organization.id, candidate.orderId));
        metrics.expiredReservations += result.expired;
        if (result.expired > 0) metrics.affectedOrders += 1;
        metrics.canceledOrders += result.canceled;
      } catch (error) {
        metrics.failed += 1;
        console.error(JSON.stringify({ job: "expire-reservations", organizationId: organization.id, orderId: candidate.orderId, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const standalone = (await createTenantTransaction(pool)(organization.id, client => client.query<{ id: string }>(
      `SELECT id FROM app.inventory_reservation
       WHERE organization_id=$1 AND status='ACTIVE' AND order_id IS NULL
         AND expires_at IS NOT NULL AND expires_at <= now()
       ORDER BY expires_at, id LIMIT $2`, [organization.id, limit]))).rows;
    for (const reservation of standalone) {
      try {
        metrics.expiredReservations += await createTenantTransaction(pool)(organization.id, client => expireStandaloneReservation(client, organization.id, reservation.id));
      } catch (error) {
        metrics.failed += 1;
        console.error(JSON.stringify({ job: "expire-reservations", organizationId: organization.id, reservationId: reservation.id, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    try {
      await createTenantTransaction(pool)(organization.id, client => cleanupRateLimitBuckets(client));
    } catch (error) {
      console.error(JSON.stringify({ job: "expire-reservations", organizationId: organization.id, task: "rate-limit-cleanup", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return metrics;
}