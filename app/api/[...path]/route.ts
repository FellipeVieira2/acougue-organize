import { NextRequest, NextResponse } from 'next/server.js';
import { randomUUID } from 'node:crypto';
import { ApiError, apiErrorResponse, parseCreateProductRequest, parseCreatePriceRequest } from '../../../packages/domain/src/api.ts';
import { withMembershipTransaction } from '../../../packages/domain/src/membership.ts';
import { login, logout, register, session, SESSION_SECONDS } from '../../../lib/auth.ts';
import { database, readBody, requireOrigin, strictBody } from '../../../lib/web.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const cookieName = process.env.NODE_ENV === 'production' ? '__Host-acougue_session' : 'acougue_session';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function handle(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const path = request.nextUrl.pathname;
    const token = request.cookies.get(cookieName)?.value;
    if (request.method === 'POST') {
      requireOrigin(request);
      const body = await readBody(request);
      if (path === '/api/auth/login' || path === '/api/auth/register') {
        strictBody(body, path.endsWith('register') ? ['email', 'password', 'name'] : ['email', 'password']);
        if (typeof body.password !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Informe sua senha.');
        if (path.endsWith('register') && process.env.ALLOW_SIGNUP !== 'true') throw new ApiError(403, 'FORBIDDEN', 'Novos cadastros ainda não estão habilitados.');
        const newToken = path.endsWith('register')
          ? await register(database(), { email: body.email, password: body.password, name: typeof body.name === 'string' ? body.name : '' })
          : await login(database(), { email: body.email, password: body.password });
        const response = json({ ok: true });
        response.cookies.set(cookieName, newToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_SECONDS });
        return response;
      }
      if (path === '/api/auth/logout') {
        await logout(database(), token);
        const response = json({ ok: true });
        response.cookies.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
        return response;
      }
      const identity = await session(database(), token);
      if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
      if (path === '/api/products') {
        strictBody(body, ['name', 'sku', 'stockUnit', 'amountMinor']);
        const product = parseCreateProductRequest({ id: randomUUID(), organizationId: identity.organizationId, name: body.name, sku: body.sku, stockUnit: body.stockUnit, saleStrategy: body.stockUnit === 'UNIT' ? 'UNIT' : 'WEIGHT_FREE' });
        await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'MANAGER', async client => {
          const store = (await client.query('SELECT id FROM app.store WHERE active=true ORDER BY created_at,id LIMIT 1')).rows[0];
          if (!store) throw new ApiError(409, 'CONFLICT', 'Cadastre uma loja ativa antes de incluir produtos.');
          const price = parseCreatePriceRequest({ id: randomUUID(), organizationId: identity.organizationId, storeId: store.id, productId: product.id, channel: 'POS', amountMinor: body.amountMinor, currency: 'BRL', revision: '1' });
          await client.query(`INSERT INTO app.product(id,organization_id,sku,name,stock_unit,sale_strategy) VALUES ($1,$2,$3,$4,$5,$6)`, [product.id, identity.organizationId, product.sku, product.name, product.stockUnit, product.saleStrategy]);
          await client.query(`INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'POS',$5,'BRL',1)`, [price.id, identity.organizationId, store.id, product.id, price.amountMinor]);
          await client.query(`INSERT INTO app.audit_log(id,organization_id,actor_id,action,entity_id,correlation_id) VALUES ($1,$2,$3,'product.created',$4,$5)`, [randomUUID(), identity.organizationId, identity.actorId, product.id, requestId]);
        });
        return json({ id: product.id }, 201);
      }
    } else {
      const identity = await session(database(), token);
      if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
      if (path === '/api/workspace') {
        return await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'VIEWER', async client => {
          const organization = (await client.query('SELECT name,status FROM app.organization WHERE id=$1', [identity.organizationId])).rows[0];
          if (!organization || organization.status !== 'ACTIVE') throw new ApiError(403, 'FORBIDDEN', 'Esta empresa não está ativa.');
          const products = (await client.query(`SELECT p.id,p.sku,p.name,p.stock_unit AS "stockUnit",p.active,p.created_at AS "createdAt",
            price.amount_minor AS "amountMinor" FROM app.product p LEFT JOIN LATERAL (
              SELECT amount_minor FROM app.product_price pp WHERE pp.product_id=p.id AND pp.channel='POS'
              AND pp.store_id=(SELECT id FROM app.store WHERE active=true ORDER BY created_at,id LIMIT 1)
              ORDER BY revision DESC LIMIT 1
            ) price ON true ORDER BY p.created_at DESC,p.id LIMIT 200`)).rows;
          return json({ organization: organization.name, email: identity.email, products });
        });
      }
    }
    throw new ApiError(404, 'NOT_FOUND', 'Rota não encontrada.');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return json({ error: { message: 'Esse código já está cadastrado. Use outro SKU.', requestId } }, 409);
    const result = apiErrorResponse(error, requestId);
    return json(result.body, result.status);
  }
}

export const GET = handle;
export const POST = handle;
