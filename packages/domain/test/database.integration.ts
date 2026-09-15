import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { applyMigrations } from '../src/migrations.ts';
import { createOrganizationWithStore } from '../src/onboarding.ts';
import { addMembership, getMembership, withMembershipTransaction } from '../src/membership.ts';
import { appendProductPriceAuthorized, createCatalogOfferAuthorized, createProductAuthorized, publishCatalogOfferAuthorized, unpublishCatalogOfferAuthorized } from '../src/catalog.ts';
import { digest, login, logout, register, session } from '../../../lib/auth.ts';
import { setStock } from '../../../lib/stock.ts';

const url = process.env.DATABASE_TEST_URL;
if (!url) throw new Error('DATABASE_TEST_URL é obrigatória; testes de banco não podem ser ignorados.');
if (!new URL(url).pathname.endsWith('_test')) throw new Error('Use exclusivamente um banco efêmero com nome terminado em _test.');
const pool = new pg.Pool({ connectionString: url, max: 2 });
const tenantA = randomUUID();
const tenantB = randomUUID();
const storeA = randomUUID();
const storeB = randomUUID();
const productA = randomUUID();
const productB = randomUUID();

async function inTenant<T>(tenant: string | null, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE acougue_runtime');
    if (tenant) await client.query("SELECT set_config('app.organization_id', $1, true)", [tenant]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

before(async () => {
  const existing = await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='app'");
  assert.equal(existing.rowCount, 0, 'A suíte exige banco vazio e não remove dados existentes.');
  const migrations = await Promise.all(['0001_tenant_foundation.sql', '0002_migration_metadata.sql', '0003_organization_membership.sql', '0004_web_identity.sql', '0005_butcher_catalog_inventory.sql', '0005_organization_invitations.sql', '0006_orders.sql', '0007_public_catalog.sql', '0008_guest_checkout.sql'].map(async name => ({
    name, sql: await readFile(new URL(`../../../database/migrations/${name}`, import.meta.url), 'utf8'),
  })));
  await assert.rejects(applyMigrations(pool, [...migrations, { name: '9999_failure.sql', sql: 'SELECT missing_migration_function()' }]));
  assert.equal((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='app'")).rowCount, 0, 'Falha deve desfazer toda a instalação');
  await Promise.all([applyMigrations(pool, migrations), applyMigrations(pool, migrations)]);
  assert.equal((await pool.query('SELECT * FROM public.schema_migrations')).rowCount, 9);
  await assert.rejects(applyMigrations(pool, [{ ...migrations[0]!, sql: migrations[0]!.sql + '\n-- changed' }]), /checksum mismatch/);
  for (const [tenant, store, product] of [[tenantA, storeA, productA], [tenantB, storeB, productB]] as const) {
    await inTenant(tenant, async client => {
      await client.query("INSERT INTO app.organization(id,name,status) VALUES ($1,'Açougue de teste','ACTIVE')", [tenant]);
      await client.query("INSERT INTO app.store(id,organization_id,name,slug) VALUES ($1,$2,'Loja de teste',$3)", [store, tenant, `teste-${store}`]);
      await client.query("INSERT INTO app.product(id,organization_id,sku,name,stock_unit,sale_strategy) VALUES ($1,$2,'P001','Patinho','G','WEIGHT_FREE')", [product, tenant]);
    });
  }
});

after(async () => { await pool.end(); });

test('runtime não tem superuser, ownership ou bypass RLS', async () => {
  const roles = await pool.query("SELECT rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname='acougue_runtime'");
  assert.deepEqual(roles.rows[0], { rolsuper: false, rolbypassrls: false, rolcanlogin: false });
  const tables = await pool.query("SELECT relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='app' AND relkind='r'");
  assert.equal(tables.rowCount, 17);
  for (const row of tables.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.notEqual(row.owner, 'acougue_runtime');
  }
});

test('A e B leem somente produto e loja próprios na mesma suíte', async () => {
  for (const [tenant, store, product] of [[tenantA, storeA, productA], [tenantB, storeB, productB]] as const) {
    await inTenant(tenant, async client => {
      assert.deepEqual((await client.query('SELECT id FROM app.product')).rows, [{ id: product }]);
      assert.deepEqual((await client.query('SELECT id FROM app.store')).rows, [{ id: store }]);
    });
  }
});

test('A não lê nem altera produto B mesmo conhecendo o UUID', async () => {
  await inTenant(tenantA, async client => {
    assert.equal((await client.query('SELECT * FROM app.product WHERE id=$1', [productB])).rowCount, 0);
    assert.equal((await client.query("UPDATE app.product SET name='inválido' WHERE id=$1", [productB])).rowCount, 0);
  });
  const name = await inTenant(tenantB, async client => (await client.query('SELECT name FROM app.product WHERE id=$1', [productB])).rows[0].name);
  assert.equal(name, 'Patinho');
});

test('RLS WITH CHECK rejeita INSERT com tenant B no contexto A', async () => {
  await assert.rejects(inTenant(tenantA, async client => {
    await client.query("INSERT INTO app.product(id,organization_id,sku,name,stock_unit,sale_strategy) VALUES ($1,$2,'P002','Tentativa','G','WEIGHT_FREE')", [randomUUID(), tenantB]);
  }), (error: unknown) => error instanceof pg.DatabaseError && error.code === '42501');
});

test('FK composta rejeita preço de A relacionado a produto ou loja B', async () => {
  for (const [store, product] of [[storeA, productB], [storeB, productA]] as const) {
    await assert.rejects(inTenant(tenantA, async client => {
      await client.query("INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'POS',3790,'BRL',1)", [randomUUID(), tenantA, store, product]);
    }), (error: unknown) => error instanceof pg.DatabaseError && error.code === '23503');
  }
});

test('sem contexto não há dados e pool não herda tenant após commit/rollback', async () => {
  await inTenant(tenantA, async client => { assert.equal((await client.query('SELECT id FROM app.product')).rowCount, 1); });
  await inTenant(null, async client => { assert.equal((await client.query('SELECT id FROM app.product')).rowCount, 0); });
  await assert.rejects(inTenant(tenantB, async () => { throw new Error('rollback intencional'); }));
  await inTenant(null, async client => { assert.equal((await client.query('SELECT id FROM app.product')).rowCount, 0); });
});

test('preço negativo é rejeitado e revisão válida permanece histórica', async () => {
  await assert.rejects(inTenant(tenantA, async client => {
    await client.query("INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'POS',-1,'BRL',1)", [randomUUID(), tenantA, storeA, productA]);
  }), (error: unknown) => error instanceof pg.DatabaseError && error.code === '23514');
  await inTenant(tenantA, async client => {
    await client.query("INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'POS',3790,'BRL',1)", [randomUUID(), tenantA, storeA, productA]);
  });
  await assert.rejects(inTenant(tenantA, async client => { await client.query('UPDATE app.product_price SET amount_minor=1'); }),
    (error: unknown) => error instanceof pg.DatabaseError && error.code === '42501');
});

test('ajuste de estoque cria apenas item físico e não publica o catálogo', async () => {
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  await createOrganizationWithStore(pool, {
    organizationId,
    actorId,
    storeId,
    auditId: randomUUID(),
    correlationId: randomUUID(),
    name: 'Estoque isolado',
    storeName: 'Loja Isolada',
    storeSlug: `isolada-${organizationId}`,
  });
  await createProductAuthorized(pool, actorId, {
    id: productId,
    organizationId,
    sku: 'EST-001',
    name: 'Picanha',
    stockUnit: 'G',
    saleStrategy: 'WEIGHT_FREE',
  });

  await setStock(pool, { actorId, organizationId, email: 'gerente@example.test' }, {
    storeId,
    productId,
    quantity: '30000',
    expectedVersion: null,
    reason: 'Recebimento inicial',
  }, randomUUID());

  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT count(*)::int AS total FROM app.inventory_item WHERE organization_id = $1', [organizationId])).rows[0].total, 1);
    assert.equal((await client.query('SELECT count(*)::int AS total FROM app.catalog_offer WHERE organization_id = $1', [organizationId])).rows[0].total, 0);
    assert.equal((await client.query('SELECT count(*)::int AS total FROM app.product_price WHERE organization_id = $1 AND store_id = $2 AND channel = $3', [organizationId, storeId, 'STOREFRONT'])).rows[0].total, 0);
    assert.equal((await client.query('SELECT on_hand_qty::text AS qty FROM app.inventory_balance WHERE organization_id = $1 AND store_id = $2', [organizationId, storeId])).rows[0].qty, '30000');
  });
});

test('publicação online é explícita e não altera estoque', async () => {
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  const inventoryItemId = randomUUID();
  const preparationOptionId = randomUUID();
  const offerId = randomUUID();
  await createOrganizationWithStore(pool, {
    organizationId,
    actorId,
    storeId,
    auditId: randomUUID(),
    correlationId: randomUUID(),
    name: 'Catálogo explícito',
    storeName: 'Loja do catálogo',
    storeSlug: `catalog-${organizationId}`,
  });
  await createProductAuthorized(pool, actorId, { id: productId, organizationId, sku: 'CAT-001', name: 'Picanha', stockUnit: 'G', saleStrategy: 'WEIGHT_FREE' });
  await inTenant(organizationId, async client => {
    await client.query("INSERT INTO app.inventory_item(id, organization_id, name, sku, base_unit) VALUES ($1, $2, 'Picanha física', 'INV-CAT', 'G')", [inventoryItemId, organizationId]);
    await client.query("INSERT INTO app.preparation_option(id, organization_id, code, name) VALUES ($1, $2, 'CAT', 'Peça inteira')", [preparationOptionId, organizationId]);
    await client.query("INSERT INTO app.product_price(id, organization_id, store_id, product_id, channel, amount_minor, currency, revision) VALUES ($1, $2, $3, $4, 'POS', 6990, 'BRL', 1)", [randomUUID(), organizationId, storeId, productId]);
    await client.query("INSERT INTO app.product_price(id, organization_id, store_id, product_id, channel, amount_minor, currency, revision) VALUES ($1, $2, $3, $4, 'STOREFRONT', 7990, 'BRL', 1)", [randomUUID(), organizationId, storeId, productId]);
    await client.query("INSERT INTO app.inventory_balance(id, organization_id, store_id, inventory_item_id, on_hand_qty) VALUES ($1, $2, $3, $4, 30000)", [randomUUID(), organizationId, storeId, inventoryItemId]);
  });

  await createCatalogOfferAuthorized(pool, actorId, {
    id: offerId,
    organizationId,
    productId,
    inventoryItemId,
    preparationOptionId,
    sku: 'CAT-OFFER',
    saleUnit: 'G',
    minWeightG: '250',
    maxWeightG: '5000',
    weightStepG: '100',
    defaultWeightG: '1000',
  });

  await assert.rejects(() => publishCatalogOfferAuthorized(pool, actorId, organizationId, offerId), /FALTA|incompleta|CONFLICT/);

  await inTenant(organizationId, async client => {
    await client.query("UPDATE app.product_price SET amount_minor = 7990 WHERE organization_id = $1 AND product_id = $2 AND channel = 'STOREFRONT'", [organizationId, productId]);
    assert.equal((await client.query('SELECT on_hand_qty::text AS qty FROM app.inventory_balance WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3', [organizationId, storeId, inventoryItemId])).rows[0].qty, '30000');
  });

  await publishCatalogOfferAuthorized(pool, actorId, organizationId, offerId);
  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT public_visible FROM app.catalog_offer WHERE id = $1', [offerId])).rows[0].public_visible, true);
    assert.equal((await client.query('SELECT on_hand_qty::text AS qty FROM app.inventory_balance WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3', [organizationId, storeId, inventoryItemId])).rows[0].qty, '30000');
  });

  await unpublishCatalogOfferAuthorized(pool, actorId, organizationId, offerId);
  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT public_visible FROM app.catalog_offer WHERE id = $1', [offerId])).rows[0].public_visible, false);
    assert.equal((await client.query('SELECT on_hand_qty::text AS qty FROM app.inventory_balance WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3', [organizationId, storeId, inventoryItemId])).rows[0].qty, '30000');
  });
});

test('catálogo público só expõe oferta explicitamente publicada', async () => {
  const { listPublicCatalog } = await import('../src/public-catalog.ts');
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  const inventoryItemId = randomUUID();
  const preparationOptionId = randomUUID();
  const offerId = randomUUID();
  const slug = `catalog-public-${organizationId}`;

  await createOrganizationWithStore(pool, {
    organizationId,
    actorId,
    storeId,
    auditId: randomUUID(),
    correlationId: randomUUID(),
    name: 'Visibilidade pública',
    storeName: 'Loja pública',
    storeSlug: slug,
  });

  await createProductAuthorized(pool, actorId, {
    id: productId,
    organizationId,
    sku: 'PUB-001',
    name: 'Picanha visível',
    stockUnit: 'G',
    saleStrategy: 'WEIGHT_FREE',
  });

  await inTenant(organizationId, async client => {
    await client.query("INSERT INTO app.inventory_item(id, organization_id, name, sku, base_unit) VALUES ($1, $2, 'Picanha física', 'INV-PUB-1', 'G')", [inventoryItemId, organizationId]);
    await client.query("INSERT INTO app.preparation_option(id, organization_id, code, name) VALUES ($1, $2, 'PUBP', 'Peça inteira')", [preparationOptionId, organizationId]);
    await client.query("INSERT INTO app.product_price(id, organization_id, store_id, product_id, channel, amount_minor, currency, revision) VALUES ($1, $2, $3, $4, 'POS', 6990, 'BRL', 1)", [randomUUID(), organizationId, storeId, productId]);
    await client.query("INSERT INTO app.product_price(id, organization_id, store_id, product_id, channel, amount_minor, currency, revision) VALUES ($1, $2, $3, $4, 'STOREFRONT', 7990, 'BRL', 1)", [randomUUID(), organizationId, storeId, productId]);
    await client.query("INSERT INTO app.inventory_balance(id, organization_id, store_id, inventory_item_id, on_hand_qty) VALUES ($1, $2, $3, $4, 30000)", [randomUUID(), organizationId, storeId, inventoryItemId]);
  });

  const emptyCatalog = await listPublicCatalog(pool, slug);
  assert.equal(emptyCatalog.offers.length, 0);

  await createCatalogOfferAuthorized(pool, actorId, {
    id: offerId,
    organizationId,
    productId,
    inventoryItemId,
    preparationOptionId,
    sku: 'PUB-OFFER',
    saleUnit: 'G',
    minWeightG: '250',
    maxWeightG: '5000',
    weightStepG: '100',
    defaultWeightG: '1000',
  });

  const hiddenCatalog = await listPublicCatalog(pool, slug);
  assert.equal(hiddenCatalog.offers.filter((offer) => offer.productId === productId).length, 0);

  await publishCatalogOfferAuthorized(pool, actorId, organizationId, offerId);

  const publishedCatalog = await listPublicCatalog(pool, slug);
  assert.equal(publishedCatalog.offers.length, 1);
  assert.equal(publishedCatalog.offers[0]?.productId, productId);
  assert.equal(publishedCatalog.offers[0]?.offerName, 'PUB-OFFER');

  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT on_hand_qty::text AS qty FROM app.inventory_balance WHERE organization_id = $1 AND store_id = $2 AND inventory_item_id = $3', [organizationId, storeId, inventoryItemId])).rows[0].qty, '30000');
  });
});

test('auditoria é append-only para a role de aplicação', async () => {
  await inTenant(tenantA, async client => {
    await client.query("INSERT INTO app.audit_log(id,organization_id,actor_id,action,entity_id,correlation_id) VALUES ($1,$2,$3,'product.create',$4,$5)", [randomUUID(), tenantA, randomUUID(), productA, randomUUID()]);
  });
  for (const query of ['UPDATE app.audit_log SET reason=\'alterado\'', 'DELETE FROM app.audit_log']) {
    await assert.rejects(inTenant(tenantA, async client => { await client.query(query); }),
      (error: unknown) => error instanceof pg.DatabaseError && error.code === '42501');
  }
  await inTenant(tenantB, async client => { assert.equal((await client.query('SELECT * FROM app.audit_log')).rowCount, 0); });
});

test('onboarding cria proprietário ativo e permite catálogo com precisão bigint', async () => {
  const organizationId = randomUUID();
  const actorId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  await createOrganizationWithStore(pool, { organizationId, actorId, storeId, auditId: randomUUID(), correlationId: randomUUID(), name: 'Nova empresa', storeName: 'Matriz', storeSlug: `loja-${storeId}` });
  assert.deepEqual(await getMembership(pool, organizationId, actorId), { organizationId, actorId, role: 'OWNER', status: 'ACTIVE' });
  await createProductAuthorized(pool, actorId, { id: productId, organizationId, sku: 'N001', name: 'Produto', stockUnit: 'UNIT', saleStrategy: 'UNIT' });
  await appendProductPriceAuthorized(pool, actorId, { id: randomUUID(), organizationId, storeId, productId, channel: 'POS', amountMinor: '9007199254740993', currency: 'BRL', revision: '1' });
  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT amount_minor FROM app.product_price')).rows[0].amount_minor, '9007199254740993');
  });
  await assert.rejects(createProductAuthorized(pool, randomUUID(), { id: randomUUID(), organizationId, sku: 'N002', name: 'Negado', stockUnit: 'UNIT', saleStrategy: 'UNIT' }), /FORBIDDEN/);
});

test('onboarding com slug ocupado não deixa empresa ou proprietário parcial', async () => {
  const organizationId = randomUUID();
  const actorId = randomUUID();
  await assert.rejects(createOrganizationWithStore(pool, { organizationId, actorId, storeId: randomUUID(), auditId: randomUUID(), correlationId: randomUUID(), name: 'Falha', storeName: 'Matriz', storeSlug: `teste-${storeA}` }),
    (error: unknown) => error instanceof pg.DatabaseError && error.code === '23505');
  assert.equal(await getMembership(pool, organizationId, actorId), null);
  await inTenant(organizationId, async client => {
    assert.equal((await client.query('SELECT id FROM app.organization')).rowCount, 0);
    assert.equal((await client.query('SELECT id FROM app.audit_log')).rowCount, 0);
  });
});

test('membros exigem administrador, impedem elevação de privilégio e auditam o autor', async () => {
  const organizationId = randomUUID(), owner = randomUUID(), admin = randomUUID(), viewer = randomUUID();
  await createOrganizationWithStore(pool, { organizationId, actorId: owner, storeId: randomUUID(), auditId: randomUUID(), correlationId: randomUUID(), name: 'Permissões', storeName: 'Matriz', storeSlug: `permissoes-${organizationId}` });
  await addMembership(pool, owner, { organizationId, actorId: admin, role: 'ADMIN', status: 'ACTIVE' }, randomUUID(), randomUUID());
  await addMembership(pool, admin, { organizationId, actorId: viewer, role: 'VIEWER', status: 'ACTIVE' }, randomUUID(), randomUUID());
  for (const requester of [viewer, randomUUID()]) {
    await assert.rejects(addMembership(pool, requester, { organizationId, actorId: randomUUID(), role: 'VIEWER', status: 'ACTIVE' }, randomUUID(), randomUUID()), /FORBIDDEN/);
  }
  for (const role of ['OWNER', 'ADMIN'] as const) {
    await assert.rejects(addMembership(pool, admin, { organizationId, actorId: randomUUID(), role, status: 'ACTIVE' }, randomUUID(), randomUUID()), /FORBIDDEN/);
  }
  await inTenant(organizationId, async client => {
    const audit = await client.query("SELECT actor_id FROM app.audit_log WHERE action='membership.created' AND entity_id=$1", [viewer]);
    assert.equal(audit.rows[0].actor_id, admin);
  });
  await assert.rejects(createProductAuthorized(pool, viewer, { id: randomUUID(), organizationId, sku: 'NEG', name: 'Negado', stockUnit: 'UNIT', saleStrategy: 'UNIT' }), /FORBIDDEN/);
});

test('permissão fica protegida contra revogação concorrente até finalizar a operação', async () => {
  const organizationId = randomUUID(), actorId = randomUUID();
  await createOrganizationWithStore(pool, { organizationId, actorId, storeId: randomUUID(), auditId: randomUUID(), correlationId: randomUUID(), name: 'Concorrência', storeName: 'Matriz', storeSlug: `lock-${organizationId}` });
  await withMembershipTransaction(pool, organizationId, actorId, 'MANAGER', async () => {
    await assert.rejects(inTenant(organizationId, async client => {
      await client.query("SET LOCAL lock_timeout = '100ms'");
      await client.query("UPDATE app.organization_membership SET status='REVOKED' WHERE actor_id=$1", [actorId]);
    }), (error: unknown) => error instanceof pg.DatabaseError && error.code === '55P03');
  });
  await inTenant(organizationId, async client => {
    await client.query("UPDATE app.organization_membership SET status='REVOKED' WHERE actor_id=$1", [actorId]);
  });
  await assert.rejects(withMembershipTransaction(pool, organizationId, actorId, 'VIEWER', async () => undefined), /FORBIDDEN/);
});

test('cadastro web é atômico, usa senha derivada e sessão revogável', async () => {
  const email = `web-${randomUUID()}@example.test`, password = 'uma-senha-longa-para-teste';
  const token = await register(pool, { email, password, name: 'Empresa web' });
  const identity = await session(pool, token);
  assert.ok(identity);
  assert.equal(identity.email, email);
  const account = (await pool.query('SELECT password_hash FROM identity.account WHERE id=$1', [identity.actorId])).rows[0];
  assert.notEqual(account.password_hash, password);
  assert.match(account.password_hash, /^scrypt-v1:/);
  assert.equal((await pool.query('SELECT token_hash FROM identity.session WHERE actor_id=$1', [identity.actorId])).rows[0].token_hash, digest(token));
  assert.equal((await getMembership(pool, identity.organizationId, identity.actorId))?.role, 'OWNER');
  const beforeCount = (await pool.query('SELECT count(*) FROM app.organization')).rows[0].count;
  await assert.rejects(register(pool, { email, password, name: 'Duplicada' }));
  assert.equal((await pool.query('SELECT count(*) FROM app.organization')).rows[0].count, beforeCount);
  await assert.rejects(login(pool, { email, password: 'senha-incorreta' }), /E-mail ou senha/);
  const secondToken = await login(pool, { email: email.toUpperCase(), password });
  assert.notEqual(secondToken, token);
  await logout(pool, token);
  assert.equal(await session(pool, token), null);
  assert.ok(await session(pool, secondToken));
  await pool.query("UPDATE identity.session SET expires_at=now() - interval '1 minute' WHERE token_hash=$1", [digest(secondToken)]);
  assert.equal(await session(pool, secondToken), null);
  await pool.query('UPDATE identity.login_limit SET attempts=10 WHERE key_hash=$1', [digest(email)]);
  await assert.rejects(login(pool, { email, password }), /Muitas tentativas/);
});

test('edição de produto bloqueia consulta e vínculo revogado sem alterar dados ou auditoria', async () => {
  const { updateProduct } = await import('../../../lib/products.ts');
  const organizationId=randomUUID(), owner=randomUUID(), viewer=randomUUID(), id=randomUUID();
  await createOrganizationWithStore(pool, { organizationId, actorId:owner, storeId:randomUUID(), auditId:randomUUID(), correlationId:randomUUID(), name:'Permissão de edição', storeName:'Matriz', storeSlug:`edit-${organizationId}` });
  await createProductAuthorized(pool,owner,{id,organizationId,sku:'EDIT',name:'Original',stockUnit:'UNIT',saleStrategy:'UNIT'});
  await addMembership(pool,owner,{organizationId,actorId:viewer,role:'VIEWER',status:'ACTIVE'},randomUUID(),randomUUID());
  const changes={name:'Alterado',active:false,expectedVersion:'1'};
  await assert.rejects(updateProduct(pool,{organizationId,actorId:viewer,email:'viewer@example.test'},id,changes,randomUUID()),/FORBIDDEN/);
  await inTenant(organizationId,async client => { await client.query("UPDATE app.organization_membership SET status='REVOKED' WHERE actor_id=$1",[owner]); });
  await assert.rejects(updateProduct(pool,{organizationId,actorId:owner,email:'owner@example.test'},id,changes,randomUUID()),/FORBIDDEN/);
  await inTenant(organizationId,async client => {
    assert.deepEqual((await client.query('SELECT name,active,version FROM app.product WHERE id=$1',[id])).rows[0],{name:'Original',active:true,version:'1'});
    assert.equal((await client.query("SELECT id FROM app.audit_log WHERE action='product.updated'")).rowCount,0);
  });
});

test('checkout público valida peso e moeda, reserva uma vez e isola chaves por loja', async () => {
  const { createPublicOrder, quotePublicCatalog, getPublicOrder } = await import('../src/public-catalog.ts');
  process.env.ORDER_ACCESS_SECRET = 'local-test-only-secret-with-at-least-32-characters';
  const inventory = randomUUID(), preparation = randomUUID(), offer = randomUUID(), secondStore = randomUUID();
  const slug = `teste-${storeA}`, otherSlug = `teste-${secondStore}`;
  await inTenant(tenantA, async client => {
    await client.query("INSERT INTO app.store(id,organization_id,name,slug) VALUES ($1,$2,'Segunda loja',$3)", [secondStore,tenantA,otherSlug]);
    await client.query("INSERT INTO app.inventory_item(id,organization_id,name,sku,base_unit) VALUES ($1,$2,'Patinho','INV-PUB','G')", [inventory,tenantA]);
    await client.query("INSERT INTO app.preparation_option(id,organization_id,code,name) VALUES ($1,$2,'BIFE','Bife')", [preparation,tenantA]);
    await client.query("INSERT INTO app.catalog_offer(id,organization_id,product_id,inventory_item_id,preparation_option_id,sku,sale_unit,min_weight_g,max_weight_g,weight_step_g,public_visible) VALUES ($1,$2,$3,$4,$5,'PUB','G',250,2000,125,true)",[offer,tenantA,productA,inventory,preparation]);
    for (const store of [storeA, secondStore]) {
      await client.query("INSERT INTO app.inventory_balance(id,organization_id,store_id,inventory_item_id,on_hand_qty) VALUES ($1,$2,$3,$4,5000)",[randomUUID(),tenantA,store,inventory]);
      await client.query("INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'STOREFRONT',3790,'BRL',1)",[randomUUID(),tenantA,store,productA]);
    }
  });
  const input = { idempotencyKey: randomUUID(), requestHash:'a'.repeat(64), orderId:randomUUID(), customerName:'Cliente de teste',customerPhone:'11999990000',fulfillmentType:'PICKUP' as const,currency:'BRL',items:[{id:randomUUID(),offerId:offer,requestedQty:'1375'}] };
  assert.equal((await quotePublicCatalog(pool,slug,[{offerId:offer,requestedQty:'1375'}])).estimatedTotalMinor,'5211');
  for (const requestedQty of ['249','300','2125']) {
    await assert.rejects(quotePublicCatalog(pool,slug,[{offerId:offer,requestedQty}]), {status:400});
    await assert.rejects(createPublicOrder(pool,slug,{...input,items:[{...input.items[0]!,requestedQty}]}), {status:400});
  }
  await assert.rejects(createPublicOrder(pool,slug,{...input,currency:'USD'}), {status:409});
  const [created, retried] = await Promise.all([createPublicOrder(pool,slug,input), createPublicOrder(pool,slug,{...input,orderId:randomUUID()})]);
  assert.deepEqual(created,retried);
  assert.equal(created.estimatedTotalMinor,'5211');
  assert.equal((await inTenant(tenantA,async client => (await client.query('SELECT reserved_qty::text AS qty FROM app.inventory_balance WHERE store_id=$1 AND inventory_item_id=$2',[storeA,inventory])).rows[0])).qty,'1375');
  await assert.rejects(createPublicOrder(pool,slug,{...input,requestHash:'b'.repeat(64)}), {status:409});
  const other = await createPublicOrder(pool,otherSlug,{...input,orderId:randomUUID(),items:[{...input.items[0]!,id:randomUUID()}]});
  assert.notEqual(other.accessToken,created.accessToken);
  await assert.rejects(getPublicOrder(pool,otherSlug,created.publicNumber,created.accessToken), {status:404});
  assert.equal((await getPublicOrder(pool,slug,created.publicNumber,created.accessToken)).estimatedTotalMinor,'5211');
  delete process.env.ORDER_ACCESS_SECRET;
});

test('pesagem e aprovação concorrentes mantêm total, estoque e estado do pedido', async () => {
  const { createOrderAuthorized, weighOrderItemAuthorized, approveOrderItemAuthorized } = await import('../src/ordering.ts');
  const { approvePublicOrderItem } = await import('../src/public-catalog.ts');
  const { createHash } = await import('node:crypto');
  const actorId=randomUUID(), inventory=randomUUID(), preparation=randomUUID(), offer=randomUUID();
  await inTenant(tenantA,async client => {
    await client.query("INSERT INTO app.organization_membership(organization_id,actor_id,role,status) VALUES ($1,$2,'OPERATOR','ACTIVE')",[tenantA,actorId]);
    await client.query("INSERT INTO app.inventory_item(id,organization_id,name,sku,base_unit) VALUES ($1,$2,'Estoque pesagem','INV-WEIGH','G')",[inventory,tenantA]);
    await client.query("INSERT INTO app.preparation_option(id,organization_id,code,name) VALUES ($1,$2,'WEIGH','Pesagem')",[preparation,tenantA]);
    await client.query("INSERT INTO app.catalog_offer(id,organization_id,product_id,inventory_item_id,preparation_option_id,sku,sale_unit,public_visible) VALUES ($1,$2,$3,$4,$5,'WEIGH','G',true)",[offer,tenantA,productA,inventory,preparation]);
    await client.query("INSERT INTO app.inventory_balance(id,organization_id,store_id,inventory_item_id,on_hand_qty) VALUES ($1,$2,$3,$4,10000)",[randomUUID(),tenantA,storeA,inventory]);
  });
  async function makeOrder() {
    const orderId=randomUUID(),items=[randomUUID(),randomUUID()];
    const order=await createOrderAuthorized(pool,{organizationId:tenantA,storeId:storeA,orderId,actorId,customerName:'Teste pesagem',customerPhone:'11900000000',fulfillmentType:'PICKUP',currency:'BRL',items:items.map(id=>({id,offerId:offer,requestedQty:'500',reservedQty:'500'}))});
    return {...order,items};
  }
  const first=await makeOrder();
  const weigh=(orderId:string,orderItemId:string,finalQty='500')=>weighOrderItemAuthorized(pool,{organizationId:tenantA,actorId,orderId,orderItemId,finalQty});
  await assert.rejects(weigh(first.orderId,first.items[0]!),{status:409});
  await inTenant(tenantA,async client=>{await client.query("UPDATE app.sales_order SET fulfillment_status='SEPARATING',order_status='CONFIRMED' WHERE id=$1",[first.orderId]);});
  await Promise.all(first.items.map(id=>weigh(first.orderId,id)));
  const summary=()=>inTenant(tenantA,async client=>(await client.query('SELECT fulfillment_status AS status,final_total_minor::text AS total FROM app.sales_order WHERE id=$1',[first.orderId])).rows[0]);
  assert.deepEqual(await summary(),{status:'WEIGHT_ADJUSTED',total:'3790'});
  await assert.rejects(weigh(first.orderId,first.items[0]!),{status:409});
  const second=await makeOrder();
  const token='a'.repeat(43);
  await inTenant(tenantA,async client=>{await client.query("UPDATE app.sales_order SET fulfillment_status='SEPARATING',order_status='CONFIRMED',public_access_token_hash=$2 WHERE id=$1",[second.orderId,createHash('sha256').update(token).digest('hex')]);});
  await weigh(second.orderId,second.items[0]!);
  assert.equal((await inTenant(tenantA,async client=>(await client.query('SELECT fulfillment_status AS status FROM app.sales_order WHERE id=$1',[second.orderId])).rows[0])).status,'WEIGHING');
  await weigh(second.orderId,second.items[1]!,'450');
  await assert.rejects(weigh(second.orderId,second.items[1]!,'450'),{status:409});
  await assert.rejects(approvePublicOrderItem(pool,`teste-${storeA}`,second.publicNumber,'b'.repeat(43),second.items[1]!),{status:404});
  const results=await Promise.allSettled([
    approveOrderItemAuthorized(pool,{organizationId:tenantA,actorId,orderId:second.orderId,orderItemId:second.items[1]!}),
    approvePublicOrderItem(pool,`teste-${storeA}`,second.publicNumber,token,second.items[1]!)
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await inTenant(tenantA,async client=>(await client.query('SELECT final_total_minor::text AS total FROM app.sales_order WHERE id=$1',[second.orderId])).rows[0])).total,'3601');
  await inTenant(tenantA,async client=>{await client.query("UPDATE app.sales_order SET order_status='CANCELED' WHERE id=$1",[second.orderId]);});
  await assert.rejects(approvePublicOrderItem(pool,`teste-${storeA}`,second.publicNumber,token,second.items[1]!),{status:409});
  const balance=await inTenant(tenantA,async client=>(await client.query('SELECT on_hand_qty::text AS stock,reserved_qty::text AS reserved FROM app.inventory_balance WHERE inventory_item_id=$1',[inventory])).rows[0]);
  assert.deepEqual(balance,{stock:'8050',reserved:'0'});
});
