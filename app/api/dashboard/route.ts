import { NextRequest, NextResponse } from 'next/server.js';
import { randomUUID } from 'node:crypto';
import { ApiError, apiErrorResponse } from '../../../packages/domain/src/api.ts';
import { withMembershipTransaction, canPerform } from '../../../packages/domain/src/membership.ts';
import { session } from '../../../lib/auth.ts';
import { database } from '../../../lib/web.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  try {
    const cookieName = process.env.NODE_ENV === 'production' ? '__Host-acougue_session' : 'acougue_session';
    const token = request.cookies.get(cookieName)?.value;
    if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
    const identity = await session(database(), token);
    if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
    const dashboard = await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'VIEWER', async (client, membership) => {
      const organization = (await client.query('SELECT name,status FROM app.organization WHERE id=$1', [identity.organizationId])).rows[0];
      const stores = (await client.query('SELECT id,name,active FROM app.store ORDER BY created_at,id')).rows;
      const priceStore = stores.find(store => store.active);
      const products = (await client.query(`
        SELECT p.id,p.name,p.sku,p.stock_unit,p.active,price.amount_minor AS "amountMinor",price.currency
        FROM app.product p LEFT JOIN LATERAL (
          SELECT amount_minor,currency FROM app.product_price pp
          WHERE pp.product_id=p.id AND pp.store_id=$1 AND pp.channel='POS'
          ORDER BY revision DESC LIMIT 1
        ) price ON true ORDER BY p.created_at DESC,p.id LIMIT 201
      `, [priceStore?.id ?? null])).rows;
      const activity = (await client.query('SELECT id,action,reason,created_at FROM app.audit_log ORDER BY created_at DESC,id LIMIT 5')).rows;
      return { organization, stores, products: products.slice(0, 200), hasMore: products.length > 200, activity,
        email: identity.email, role: membership.role, canCreateProduct: canPerform(membership.role, 'MANAGER'), priceStore: priceStore?.name ?? null };
    });
    return json(dashboard);
  } catch (error) {
    const result = apiErrorResponse(error, randomUUID());
    return json(result.body, result.status);
  }
}
