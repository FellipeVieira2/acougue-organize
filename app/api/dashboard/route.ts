import { NextRequest, NextResponse } from 'next/server.js';
import { randomUUID } from 'node:crypto';
import { ApiError, apiErrorResponse } from '../../../packages/domain/src/api.ts';
import { withMembershipTransaction, canPerform } from '../../../packages/domain/src/membership.ts';
import { session } from '../../../lib/auth.ts';
import { resolveSelectedStore } from '../../../lib/store.ts';
import { database } from '../../../lib/web.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} });

export async function GET(request: NextRequest) {
  try {
    const cookieName = process.env.NODE_ENV === 'production' ? '__Host-acougue_session' : 'acougue_session';
    const token = request.cookies.get(cookieName)?.value;
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
    const identity = await session(database(), token);
    if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
    const requestedStoreId = request.nextUrl.searchParams.get('storeId');
    const dashboard = await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'VIEWER', async (client, membership) => {
      const organization = (await client.query('SELECT name,status FROM app.organization WHERE id=$1', [identity.organizationId])).rows[0];
      const stores = (await client.query('SELECT id,name,slug,active FROM app.store ORDER BY created_at,id')).rows;
      const selectedStore = resolveSelectedStore(stores, requestedStoreId)
      const products = (await client.query(`
        SELECT p.id,p.name,p.sku,p.stock_unit,p.active,p.version,price.amount_minor AS "amountMinor",price.currency
        FROM app.product p LEFT JOIN LATERAL (
          SELECT amount_minor,currency FROM app.product_price pp
          WHERE pp.product_id=p.id AND pp.store_id=$1 AND pp.channel='POS'
          ORDER BY revision DESC LIMIT 1
        ) price ON true ORDER BY p.created_at DESC,p.id LIMIT 201
      `, [selectedStore?.id ?? null])).rows;
      const activity = (await client.query('SELECT id,action,reason,created_at FROM app.audit_log ORDER BY created_at DESC,id LIMIT 5')).rows;
      const orders = (await client.query(`SELECT id, public_number::text AS "publicNumber", customer_name AS "customerName", fulfillment_type AS "fulfillmentType", fulfillment_status AS "fulfillmentStatus", estimated_total_minor::text AS "estimatedTotalMinor", final_total_minor::text AS "finalTotalMinor", created_at AS "createdAt"
        FROM app.sales_order WHERE organization_id=$1 AND store_id=$2 AND fulfillment_status NOT IN ('COMPLETED','CANCELED') ORDER BY created_at,id LIMIT 50`, [identity.organizationId, selectedStore?.id ?? null])).rows;
      return { organization, stores, products: products.slice(0, 200), hasMore: products.length > 200, activity,
        orders,
        email: identity.email, role: membership.role, canCreateProduct: canPerform(membership.role, 'MANAGER'),
        selectedStoreId: selectedStore?.id ?? null, selectedStoreName: selectedStore?.name ?? null,
        priceStore: selectedStore?.name ?? null };
    });
    return json(dashboard);
  } catch (error) {
    const result = apiErrorResponse(error, randomUUID());
    return json(result.body, result.status);
  }
}
