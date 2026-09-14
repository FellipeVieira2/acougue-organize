import { NextRequest, NextResponse } from 'next/server.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError, apiErrorResponse, parseCreateProductRequest, parseCreatePriceRequest } from '../../../packages/domain/src/api.ts';
import { withMembershipTransaction } from '../../../packages/domain/src/membership.ts';
import { digest, identityTransaction, login, logout, normalizeEmail, register, session, SESSION_SECONDS } from '../../../lib/auth.ts';
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
      if (path === '/api/store/orders') {
        strictBody(body, ['storeSlug', 'customerName', 'customerPhone', 'fulfillmentType', 'items']);
        const storeSlug = typeof body.storeSlug === 'string' ? body.storeSlug.trim() : '';
        const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
        const customerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '';
        const fulfillmentType = body.fulfillmentType === 'DELIVERY' ? 'DELIVERY' : body.fulfillmentType === 'PICKUP' ? 'PICKUP' : '';
        const items = Array.isArray(body.items) ? body.items : [];
        if (!storeSlug || customerName.length < 2 || customerPhone.length < 8 || !fulfillmentType || items.length < 1 || items.length > 50) throw new ApiError(400, 'VALIDATION_ERROR', 'Confira os dados do pedido.');
        const pool = database();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const store = (await client.query('SELECT id,organization_id FROM app.store WHERE slug=$1 AND active=true LIMIT 1', [storeSlug])).rows[0];
          if (!store) throw new ApiError(404, 'NOT_FOUND', 'Loja não encontrada.');
          const ids = items.map((item: { productId?: unknown }) => item.productId).filter((id): id is string => typeof id === 'string');
          const products = (await client.query(`SELECT p.id,p.name,p.stock_unit,pp.amount_minor FROM app.product p JOIN app.product_price pp ON pp.product_id=p.id AND pp.organization_id=p.organization_id WHERE p.organization_id=$1 AND p.active=true AND p.id=ANY($2::uuid[]) AND pp.store_id=$3 AND pp.channel='POS'`, [store.organization_id, ids, store.id])).rows;
          if (products.length !== items.length) throw new ApiError(400, 'VALIDATION_ERROR', 'Um produto do pedido não está disponível.');
          const orderId = randomUUID(); const code = 'AC-' + randomBytes(3).toString('hex').toUpperCase(); let total = 0;
          const lines = items.map((item: { productId: string; quantity?: unknown }) => { const product = products.find((candidate: { id: string }) => candidate.id === item.productId) as { id: string; name: string; stock_unit: string; amount_minor: string }; const quantity = Number(item.quantity); if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 999) throw new ApiError(400, 'VALIDATION_ERROR', 'Quantidade inválida.'); const subtotal = Number(product.amount_minor) * quantity; total += subtotal; return { product, quantity, subtotal }; });
          await client.query(`INSERT INTO app.online_order(id,organization_id,store_id,public_code,customer_name,customer_phone,fulfillment_type,address,notes,estimated_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [orderId, store.organization_id, store.id, code, customerName, customerPhone, fulfillmentType, typeof body.address === 'string' ? body.address.trim() : null, typeof body.notes === 'string' ? body.notes.trim() : null, total]);
          for (const line of lines) await client.query(`INSERT INTO app.online_order_item(id,order_id,organization_id,product_id,product_name,unit,requested_quantity,price_minor,subtotal_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), orderId, store.organization_id, line.product.id, line.product.name, line.product.stock_unit, line.quantity, line.product.amount_minor, line.subtotal]);
          await client.query(`INSERT INTO app.online_order_event(id,order_id,organization_id,to_status,note) VALUES ($1,$2,$3,'RECEIVED','Pedido recebido pela loja')`, [randomUUID(), orderId, store.organization_id]);
          await client.query('COMMIT'); return json({ orderId, code, status: 'RECEIVED', estimatedTotalMinor: total }, 201);
        } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      }
      if (path === '/api/auth/login' || path === '/api/auth/register') {
        strictBody(body, path.endsWith('register') ? ['email', 'password', 'name'] : ['email', 'password']);
        if (typeof body.password !== 'string') throw new ApiError(400, 'VALIDATION_ERROR', 'Informe sua senha.');
        if (path.endsWith('register') && process.env.ALLOW_SIGNUP === 'false') throw new ApiError(403, 'FORBIDDEN', 'Novos cadastros estão temporariamente desabilitados.');
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
      if (path === '/api/team/invitations') {
        strictBody(body, ['email', 'role']);
        const email = normalizeEmail(body.email);
        const role = typeof body.role === 'string' ? body.role : '';
        if (!['ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER'].includes(role)) throw new ApiError(400, 'VALIDATION_ERROR', 'Função inválida.');
        const invitationToken = randomBytes(32).toString('hex');
        const invitation = await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'ADMIN', async client => {
          const existing = (await client.query('SELECT id FROM identity.account WHERE email=$1', [email])).rows[0];
          if (existing) throw new ApiError(409, 'CONFLICT', 'Esse e-mail já possui uma conta.');
          const row = (await client.query(`INSERT INTO app.organization_invitation(id,organization_id,email,role,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,now()+interval '7 days',$6) RETURNING id,email,role,expires_at AS "expiresAt"`, [randomUUID(), identity.organizationId, email, role, digest(invitationToken), identity.actorId])).rows[0];
          await client.query(`INSERT INTO app.audit_log(id,organization_id,actor_id,action,entity_id,correlation_id) VALUES ($1,$2,$3,'invitation.created',$4,$5)`, [randomUUID(), identity.organizationId, identity.actorId, row.id, requestId]);
          return row;
        });
        return json({ ...invitation, token: invitationToken }, 201);
      }
      if (path === '/api/team/invitations/accept') {
        strictBody(body, ['token']);
        const invitationToken = typeof body.token === 'string' ? body.token : '';
        if (!/^[a-f0-9]{64}$/.test(invitationToken)) throw new ApiError(400, 'VALIDATION_ERROR', 'Convite inválido.');
        const result = await identityTransaction(database(), async client => {
          const account = (await client.query('SELECT id,email FROM identity.account WHERE id=$1', [identity.actorId])).rows[0];
          const invite = (await client.query(`SELECT id,organization_id,role,email FROM app.organization_invitation WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()`, [digest(invitationToken)])).rows[0];
          if (!invite || invite.email !== account.email) throw new ApiError(400, 'VALIDATION_ERROR', 'Convite inválido ou expirado.');
          await client.query('UPDATE app.organization_invitation SET accepted_at=now() WHERE id=$1', [invite.id]);
          await client.query(`INSERT INTO app.organization_membership(id,organization_id,actor_id,role,status) VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT (organization_id,actor_id) DO UPDATE SET role=EXCLUDED.role,status='ACTIVE'`, [randomUUID(), invite.organization_id, identity.actorId, invite.role]);
          return { organizationId: invite.organization_id, role: invite.role };
        });
        return json(result);
      }
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
      if (path === '/api/store/catalog') {
        const slug = request.nextUrl.searchParams.get('slug')?.trim() ?? '';
        if (!slug) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe a loja.');
        const result = await database().query(`SELECT s.name AS "storeName",s.slug,p.id,p.name,p.sku,p.stock_unit AS "stockUnit",pp.amount_minor AS "amountMinor" FROM app.store s JOIN app.product p ON p.organization_id=s.organization_id AND p.active=true JOIN app.product_price pp ON pp.product_id=p.id AND pp.store_id=s.id AND pp.channel='POS' WHERE s.slug=$1 AND s.active=true ORDER BY p.name LIMIT 200`, [slug]);
        const store = result.rows[0];
        return json({ storeName: store?.storeName ?? null, slug, products: result.rows });
      }
      const identity = await session(database(), token);
      if (!identity) throw new ApiError(401, 'UNAUTHORIZED', 'Entre para continuar.');
      if (path === '/api/orders' && request.method === 'GET') {
        return await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'VIEWER', async client => {
          const orders = (await client.query(`SELECT o.id,o.public_code AS "code",o.customer_name AS "customerName",o.customer_phone AS "customerPhone",o.fulfillment_type AS "fulfillmentType",o.status,o.estimated_total_minor AS "estimatedTotalMinor",o.created_at AS "createdAt",COUNT(i.id)::int AS "itemCount" FROM app.online_order o LEFT JOIN app.online_order_item i ON i.order_id=o.id WHERE o.organization_id=$1 GROUP BY o.id ORDER BY o.created_at DESC LIMIT 100`, [identity.organizationId])).rows;
          return json({ orders });
        });
      }
      if (path.startsWith('/api/orders/') && request.method === 'PATCH') {
        const body = await readBody(request);
        strictBody(body, ['status']);
        const nextStatus = typeof body.status === 'string' ? body.status : '';
        const allowed = ['RECEIVED','CONFIRMED','SEPARATING','WEIGHING','WAITING_CUSTOMER_APPROVAL','WEIGHT_ADJUSTED','READY','COMPLETED','CANCELED'];
        if (!allowed.includes(nextStatus)) throw new ApiError(400, 'VALIDATION_ERROR', 'Status inválido.');
        const orderId = path.split('/').pop();
        return await withMembershipTransaction(database(), identity.organizationId, identity.actorId, 'OPERATOR', async client => {
          const current = (await client.query('SELECT id,status FROM app.online_order WHERE id=$1 AND organization_id=$2 FOR UPDATE', [orderId, identity.organizationId])).rows[0];
          if (!current) throw new ApiError(404, 'NOT_FOUND', 'Pedido não encontrado.');
          const transitions: Record<string,string[]> = { RECEIVED:['CONFIRMED','CANCELED'], CONFIRMED:['SEPARATING','CANCELED'], SEPARATING:['WEIGHING','CANCELED'], WEIGHING:['READY','WAITING_CUSTOMER_APPROVAL','CANCELED'], WAITING_CUSTOMER_APPROVAL:['WEIGHING','READY','CANCELED'], READY:['COMPLETED','CANCELED'] };
          if (!transitions[current.status]?.includes(nextStatus)) throw new ApiError(409, 'CONFLICT', 'Essa mudança de etapa não é permitida.');
          await client.query('UPDATE app.online_order SET status=$1,updated_at=now() WHERE id=$2', [nextStatus, orderId]);
          await client.query('INSERT INTO app.online_order_event(id,order_id,organization_id,from_status,to_status,actor_id) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), orderId, identity.organizationId, current.status, nextStatus, identity.actorId]);
          return json({ ok: true, status: nextStatus });
        });
      }
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
