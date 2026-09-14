import type { Pool } from 'pg';
import { ApiError } from '../packages/domain/src/api.ts';
import { canPerform, withMembershipTransaction } from '../packages/domain/src/membership.ts';
import type { Session } from './auth.ts';

export async function orderDetails(pool: Pool, identity: Session, orderId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) throw new ApiError(400,'VALIDATION_ERROR','Pedido inválido.');
  return withMembershipTransaction(pool,identity.organizationId,identity.actorId,'VIEWER',async(client,membership)=>{
    const order=(await client.query(`SELECT id,public_number::text AS "publicNumber",customer_name AS "customerName",fulfillment_status AS "fulfillmentStatus",order_status AS status,currency,estimated_total_minor::text AS "estimatedTotalMinor",final_total_minor::text AS "finalTotalMinor" FROM app.sales_order WHERE organization_id=$1 AND id=$2 FOR SHARE`,[identity.organizationId,orderId])).rows[0];
    if(!order) throw new ApiError(404,'NOT_FOUND','Pedido não encontrado.');
    const items=(await client.query(`SELECT id,product_name_snapshot AS "productName",preparation_name_snapshot AS "preparationName",pricing_type_snapshot AS "pricingType",requested_qty::text AS "requestedQty",reserved_qty::text AS "reservedQty",final_qty::text AS "finalQty",estimated_total_minor::text AS "estimatedTotalMinor",final_total_minor::text AS "finalTotalMinor",customer_note AS "customerNote",status FROM app.order_item WHERE organization_id=$1 AND order_id=$2 ORDER BY created_at,id`,[identity.organizationId,orderId])).rows;
    return {order,items,canWeigh:canPerform(membership.role,'OPERATOR') && !['CANCELED','COMPLETED'].includes(order.status) && ['SEPARATING','WEIGHING','WAITING_CUSTOMER_APPROVAL'].includes(order.fulfillmentStatus)};
  });
}
