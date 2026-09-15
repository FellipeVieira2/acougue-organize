import { orderDetails } from "../../../lib/order-details.ts";
import { listStock, setStock } from '../../../lib/stock.ts';
import { cancelOrderAuthorized, completeDeliveryAuthorized, completePickupAuthorized, markOrderReadyAuthorized, weighOrderItemAuthorized } from "../../../packages/domain/src/ordering.ts";
import { NextRequest, NextResponse } from 'next/server.js';
import { updateProduct } from '../../../lib/products.ts';
import { createHash, randomUUID } from 'node:crypto';
import { ApiError, apiErrorResponse, parseCreateProductRequest, parseCreatePriceRequest, parseCreateCatalogOfferRequest } from '../../../packages/domain/src/api.ts';
import { withMembershipTransaction } from '../../../packages/domain/src/membership.ts';
import { login, logout, register, session, SESSION_SECONDS } from '../../../lib/auth.ts';
import { database, getTrustedClientIp, readBody, requireOrigin, strictBody } from '../../../lib/web.ts';
import { approvePublicOrderItem, createPublicOrder, getPublicOrder, limitPublicApproval, listPublicCatalog, quotePublicCatalog } from '../../../packages/domain/src/public-catalog.ts';
import { createCatalogOfferAuthorized, publishCatalogOfferAuthorized, unpublishCatalogOfferAuthorized } from '../../../packages/domain/src/catalog.ts';
import { canTransitionOrder } from '../../../packages/domain/src/orders.ts';
import { timingSafeEqual } from 'node:crypto';
import { expireExpiredReservations } from '../../../packages/domain/src/reservation-expiration.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
const cookieName = process.env.NODE_ENV === 'production' ? '__Host-acougue_session' : 'acougue_session';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
} });

async function handle(request: NextRequest): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const path = request.nextUrl.pathname;
    const token = request.cookies.get(cookieName)?.value;
    const publicCatalogMatch = /^\/api\/public\/stores\/([^/]+)\/catalog$/.exec(path);
    const publicQuoteMatch = /^\/api\/public\/stores\/([^/]+)\/quote$/.exec(path);
    const publicOrderMatch = /^\/api\/public\/stores\/([^/]+)\/orders$/.exec(path);
    const publicOrderLookupMatch = /^\/api\/public\/stores\/([^/]+)\/orders\/([^/]+)$/.exec(path);
    const publicOrderApproveMatch = /^\/api\/public\/stores\/([^/]+)\/orders\/([^/]+)\/approve$/.exec(path);
    if (path === '/api/internal/jobs/expire-reservations' && (request.method === 'GET' || request.method === 'POST')) {
      const configuredSecret = process.env.CRON_SECRET;
      const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
      const suppliedBytes = Buffer.from(supplied);
      const configuredBytes = Buffer.from(configuredSecret ?? '');
      if (!configuredSecret || suppliedBytes.length !== configuredBytes.length || !timingSafeEqual(suppliedBytes, configuredBytes)) {
        return json({ error: { code: 'UNAUTHORIZED', message: 'Não autorizado.' } }, 401);
      }
      const metrics = await expireExpiredReservations(database());
      console.log(JSON.stringify({ job: 'expire-reservations', ...metrics }));
      return json(metrics);
    }
    if (publicCatalogMatch && request.method === 'GET') {
      return json(await listPublicCatalog(database(), decodeURIComponent(publicCatalogMatch[1]!)));
    }
    if (publicOrderLookupMatch && request.method === 'GET') {
      const accessToken = request.nextUrl.searchParams.get('token');
      if (!accessToken) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
      return json(await getPublicOrder(database(), decodeURIComponent(publicOrderLookupMatch[1]!), decodeURIComponent(publicOrderLookupMatch[2]!), accessToken));
    }
    if (publicOrderApproveMatch && request.method === 'POST') {
      requireOrigin(request);
      const accessToken = request.headers.get('x-order-token');
      if (!accessToken) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
      const body = await readBody(request);
      strictBody(body, ['orderItemId']);
      if (typeof body.orderItemId !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Item inválido.');
      const clientIp = getTrustedClientIp(request);
      await limitPublicApproval(database(), decodeURIComponent(publicOrderApproveMatch[1]!), clientIp);
      return json(await approvePublicOrderItem(database(), decodeURIComponent(publicOrderApproveMatch[1]!), decodeURIComponent(publicOrderApproveMatch[2]!), accessToken, body.orderItemId));
    }
    if (publicQuoteMatch && request.method === 'POST') {
      requireOrigin(request);
      const body = await readBody(request);
      strictBody(body, ['items']);
      if (!Array.isArray(body.items)) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe os itens da cotação.');
      return json(await quotePublicCatalog(database(), decodeURIComponent(publicQuoteMatch[1]!), body.items as { offerId: string; requestedQty: string }[], getTrustedClientIp(request)));
    }
    if (publicOrderMatch && request.method === 'POST') {
      requireOrigin(request);
      const body = await readBody(request);
      strictBody(body, ['customerName', 'customerPhone', 'fulfillmentType', 'currency', 'customerNote', 'items']);
      if (!Array.isArray(body.items)) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe os itens do pedido.');
      const idempotencyKey = request.headers.get('idempotency-key');
      if (!idempotencyKey) throw new ApiError(400, 'VALIDATION_ERROR', 'Idempotency-Key é obrigatória.');
      const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const items = body.items.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ApiError(400, 'VALIDATION_ERROR', 'Item de pedido inválido.');
        const value = item as Record<string, unknown>;
        return { id: randomUUID(), offerId: value.offerId as string, requestedQty: value.requestedQty as string, customerNote: (value.customerNote ?? null) as string | null };
      });
      return json(await createPublicOrder(database(), decodeURIComponent(publicOrderMatch[1]!), {
        idempotencyKey, requestHash, orderId: randomUUID(), customerName: body.customerName as string, customerPhone: body.customerPhone as string,
        fulfillmentType: body.fulfillmentType as 'PICKUP' | 'DELIVERY', currency: body.currency as string, customerNote: (body.customerNote ?? null) as string | null, items, clientIp: getTrustedClientIp(request),
      }), 201);
    }
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
        response.cookies.set(cookieName, newToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS, priority: 'high' });
        return response;
      }
      if (path === '/api/auth/logout') {
        await logout(database(), token);
        const response = json({ ok: true });
        response.cookies.set(cookieName, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 0, priority: 'high' });
        return response;
      }
      const identity = await session(database(), token);
      if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
      const weighMatch = /^\/api\/orders\/([^/]+)\/items\/([^/]+)\/weigh$/.exec(path);
      if (weighMatch) {
        strictBody(body, ['finalQty']);
        if (typeof body.finalQty !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Informe a quantidade em gramas ou unidades inteiras.');
        return json(await weighOrderItemAuthorized(database(), { organizationId: identity.organizationId, actorId: identity.actorId, orderId: weighMatch[1]!, orderItemId: weighMatch[2]!, finalQty: body.finalQty }));
      }
      const cancelOrderMatch = /^\/api\/orders\/([^/]+)\/cancel$/.exec(path);
      if (cancelOrderMatch) {
        strictBody(body, ['reason']);
        if (typeof body.reason !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Informe o motivo do cancelamento.');
        return json(await cancelOrderAuthorized(database(), { organizationId: identity.organizationId, actorId: identity.actorId, orderId: cancelOrderMatch[1]!, reason: body.reason }));
      }
      const readyOrderMatch = /^\/api\/orders\/([^/]+)\/ready$/.exec(path);
      if (readyOrderMatch) {
        strictBody(body, []);
        return json(await markOrderReadyAuthorized(database(), { organizationId: identity.organizationId, actorId: identity.actorId, orderId: readyOrderMatch[1]! }));
      }
      const completeOrderMatch = /^\/api\/orders\/([^/]+)\/complete$/.exec(path);
      if (completeOrderMatch) {
        strictBody(body, ['fulfillmentType']);
        if (body.fulfillmentType !== 'PICKUP' && body.fulfillmentType !== 'DELIVERY') throw new ApiError(400, 'VALIDATION_ERROR', 'Tipo de atendimento inválido.');
        const input = { organizationId: identity.organizationId, actorId: identity.actorId, orderId: completeOrderMatch[1]!, fulfillmentType: body.fulfillmentType } as const;
        return json(await (body.fulfillmentType === 'DELIVERY' ? completeDeliveryAuthorized(database(), input) : completePickupAuthorized(database(), input)));
      }
      const orderStatusMatch = /^\/api\/orders\/([^/]+)\/status$/.exec(path);
      if (orderStatusMatch && path.startsWith('/api/orders/')) {
        strictBody(body, ['status']);
        const status = typeof body.status === 'string' ? body.status : null;
        const allowed = ['RECEIVED', 'CONFIRMED', 'SEPARATING', 'WEIGHING', 'WAITING_CUSTOMER_APPROVAL', 'WEIGHT_ADJUSTED', 'READY', 'COMPLETED', 'CANCELED'] as const;
        if (!status || !allowed.includes(status as (typeof allowed)[number])) throw new ApiError(400, 'VALIDATION_ERROR', 'Status de operação inválido.');
        return json(await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'OPERATOR', async client => {
          const current = await client.query<{ status: string }>('SELECT fulfillment_status AS status FROM app.sales_order WHERE organization_id=$1 AND id=$2 FOR UPDATE', [identity.organizationId, orderStatusMatch[1]]);
          const from = current.rows[0]?.status;
          if (!from) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
          if (!canTransitionOrder(from as any, status as any)) throw new ApiError(409, 'CONFLICT', 'Transição de pedido inválida.');
          await client.query('UPDATE app.sales_order SET fulfillment_status=$3, order_status=CASE WHEN $3=\'CONFIRMED\' THEN \'CONFIRMED\' ELSE order_status END, version=version+1, confirmed_at=CASE WHEN $3=\'CONFIRMED\' THEN now() ELSE confirmed_at END, completed_at=CASE WHEN $3=\'COMPLETED\' THEN now() ELSE completed_at END, canceled_at=CASE WHEN $3=\'CANCELED\' THEN now() ELSE canceled_at END, updated_at=now() WHERE organization_id=$1 AND id=$2', [identity.organizationId, orderStatusMatch[1], status]);
          if (status !== 'RECEIVED') await client.query(`UPDATE app.inventory_reservation SET expires_at=NULL WHERE organization_id=$1 AND order_id=$2 AND status='ACTIVE'`, [identity.organizationId, orderStatusMatch[1]]);
          await client.query(`INSERT INTO app.order_event (id, organization_id, order_id, event_type, payload, actor_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`, [randomUUID(), identity.organizationId, orderStatusMatch[1], `ORDER_${status}`, JSON.stringify({ from, to: status }), identity.actorId]);
          return { id: orderStatusMatch[1], fulfillmentStatus: status };
        }));
      }
      const catalogOfferMatch = /^\/api\/catalog\/offers$/.exec(path);
      if (catalogOfferMatch && request.method === 'POST') {
        const payload = parseCreateCatalogOfferRequest({
          id: randomUUID(),
          organizationId: identity.organizationId,
          productId: body.productId,
          inventoryItemId: body.inventoryItemId,
          preparationOptionId: body.preparationOptionId,
          sku: body.sku,
          saleUnit: body.saleUnit,
          minWeightG: body.minWeightG ?? null,
          maxWeightG: body.maxWeightG ?? null,
          weightStepG: body.weightStepG ?? null,
          defaultWeightG: body.defaultWeightG ?? null,
        });
        await createCatalogOfferAuthorized(database(), identity.actorId, payload);
        return json({ ok: true, id: payload.id }, 201);
      }
      const catalogOfferPublishMatch = /^\/api\/catalog\/offers\/([^/]+)\/publish$/.exec(path);
      if (catalogOfferPublishMatch) {
        await publishCatalogOfferAuthorized(database(), identity.actorId, identity.organizationId, catalogOfferPublishMatch[1]!);
        return json({ ok: true });
      }
      const catalogOfferUnpublishMatch = /^\/api\/catalog\/offers\/([^/]+)\/unpublish$/.exec(path);
      if (catalogOfferUnpublishMatch) {
        await unpublishCatalogOfferAuthorized(database(), identity.actorId, identity.organizationId, catalogOfferUnpublishMatch[1]!);
        return json({ ok: true });
      }
      if (path === '/api/stock') return json(await setStock(database(),identity,body,requestId));
      const productMatch = /^\/api\/products\/([^/]+)$/.exec(path);
      if (productMatch) return json(await updateProduct(database(), identity, productMatch[1]!, body, requestId));
      if (path === '/api/products') {
        strictBody(body, ['name', 'sku', 'stockUnit', 'amountMinor', 'storeId']);
        const product = parseCreateProductRequest({ id: randomUUID(), organizationId: identity.organizationId, name: body.name, sku: body.sku, stockUnit: body.stockUnit, saleStrategy: body.stockUnit === 'UNIT' ? 'UNIT' : 'WEIGHT_FREE' });
        await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'MANAGER', async client => {
          const requestedStoreId = typeof body.storeId === 'string' && /^[0-9a-f-]{36}$/i.test(body.storeId) ? body.storeId : null;
          const store = requestedStoreId
            ? (await client.query('SELECT id,name FROM app.store WHERE id=$1 AND organization_id=$2', [requestedStoreId, identity.organizationId])).rows[0]
            : (await client.query('SELECT id,name FROM app.store WHERE active=true AND organization_id=$1 ORDER BY created_at,id LIMIT 1', [identity.organizationId])).rows[0];
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
      if (path === '/api/stock' && request.method === 'GET') return json(await listStock(database(),identity,request.nextUrl.searchParams.get('storeId')??''));
      const orderMatch = /^\/api\/orders\/([^/]+)$/.exec(path);
      if (orderMatch && request.method === 'GET') return json(await orderDetails(database(), identity, orderMatch[1]!));
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
    if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
      console.log(JSON.stringify({ event: 'public_rate_limited', scope: error.rateLimitScope ?? 'unknown', requestId, path: request.nextUrl.pathname }));
    }
    if (typeof error === 'object' && error !== null && 'code' in error && (error.code === '42P01' || error.code === '42883')) {
      return json({ error: { code: 'PRECONDITION_REQUIRED', message: 'O catálogo público ainda não foi ativado neste banco.', requestId } }, 503);
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return json({ error: { message: 'Esse código já está cadastrado. Use outro SKU.', requestId } }, 409);
    const result = apiErrorResponse(error, requestId);
    const response = json(result.body, result.status);
    if (error instanceof ApiError && error.retryAfterSeconds) response.headers.set('Retry-After', String(error.retryAfterSeconds));
    return response;
  }
}

export const GET = handle;
export const POST = handle;
