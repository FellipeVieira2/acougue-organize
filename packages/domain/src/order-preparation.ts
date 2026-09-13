import type { PoolClient } from 'pg';
import { ApiError } from './api.ts';

export async function lockOrderForPreparation(client: PoolClient, organizationId: string, orderId: string): Promise<void> {
  const result = await client.query<{ status: string; fulfillment: string }>(`SELECT order_status AS status, fulfillment_status AS fulfillment FROM app.sales_order WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [organizationId, orderId]);
  const order = result.rows[0];
  if (!order) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
  if (['CANCELED','COMPLETED'].includes(order.status) || !['SEPARATING','WEIGHING','WAITING_CUSTOMER_APPROVAL'].includes(order.fulfillment)) throw new ApiError(409, 'CONFLICT', 'O pedido não está em preparação.');
}

/** Caller must hold the parent order lock before changing any of its items. */
export async function refreshOrderPreparation(client: PoolClient, organizationId: string, orderId: string): Promise<void> {
  const result = await client.query<{ pending: string; waiting: string; subtotal: string }>(`SELECT count(*) FILTER (WHERE status NOT IN ('RESOLVED','CANCELED'))::text AS pending, count(*) FILTER (WHERE status='WAITING_CUSTOMER_APPROVAL')::text AS waiting, COALESCE(sum(final_total_minor) FILTER (WHERE status='RESOLVED'),0)::text AS subtotal FROM app.order_item WHERE organization_id=$1 AND order_id=$2`, [organizationId,orderId]);
  const summary = result.rows[0]!;
  const resolved = summary.pending === '0';
  const status = resolved ? 'WEIGHT_ADJUSTED' : summary.waiting !== '0' ? 'WAITING_CUSTOMER_APPROVAL' : 'WEIGHING';
  await client.query(`UPDATE app.sales_order SET fulfillment_status=$3, final_subtotal_minor=CASE WHEN $4 THEN $5::bigint ELSE NULL END, final_total_minor=CASE WHEN $4 THEN GREATEST(0::numeric,$5::numeric+delivery_fee_minor-discount_minor)::bigint ELSE NULL END, version=version+1,updated_at=now() WHERE organization_id=$1 AND id=$2`, [organizationId,orderId,status,resolved,summary.subtotal]);
}
