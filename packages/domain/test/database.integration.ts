import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { applyMigrations } from '../src/migrations.ts';
import { createOrganizationWithStore } from '../src/onboarding.ts';
import { getMembership } from '../src/membership.ts';
import { appendProductPriceAuthorized, createProductAuthorized } from '../src/catalog.ts';

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
  const migrations = await Promise.all(['0001_tenant_foundation.sql', '0002_migration_metadata.sql', '0003_organization_membership.sql'].map(async name => ({
    name, sql: await readFile(new URL(`../../../database/migrations/${name}`, import.meta.url), 'utf8'),
  })));
  await assert.rejects(applyMigrations(pool, [...migrations, { name: '9999_failure.sql', sql: 'SELECT missing_migration_function()' }]));
  assert.equal((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='app'")).rowCount, 0, 'Falha deve desfazer toda a instalação');
  await Promise.all([applyMigrations(pool, migrations), applyMigrations(pool, migrations)]);
  assert.equal((await pool.query('SELECT * FROM public.schema_migrations')).rowCount, 3);
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
  assert.equal(tables.rowCount, 6);
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
