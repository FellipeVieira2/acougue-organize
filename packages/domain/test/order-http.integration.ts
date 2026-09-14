import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { session } from '../../../lib/auth.ts';
import { createTenantTransaction } from '../src/database.ts';
import { createOrderAuthorized } from '../src/ordering.ts';
const base=process.env.APP_TEST_URL;
const url=process.env.DATABASE_URL;
if(!base||!['localhost','127.0.0.1'].includes(new URL(base).hostname)||!url||!new URL(url).pathname.endsWith('_test'))throw new Error('Use servidor local e banco com sufixo _test.');
test('HTTP de estoque: publicação inicial, disputa, reservas e isolamento',async()=>{
 const pool=new pg.Pool({connectionString:url,max:2});
 const req=(path:string,body?:unknown,cookie?:string)=>fetch(`${base}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:base!,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  const login=await req('auth/register',{name:'Teste estoque',email:`stock-${randomUUID()}@example.test`,password:'senha-local-para-estoque'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const identity=(await session(pool,cookie.split('=')[1]))!;
  const tx=createTenantTransaction(pool);
  const store=await tx(identity.organizationId,async c=>(await c.query('SELECT id,slug FROM app.store')).rows[0]);
  const created=await req('products',{name:'Acém estoque',sku:'STOCK',stockUnit:'G',amountMinor:'3790',storeId:store.id},cookie);assert.equal(created.status,201);
  const product=(await created.json()).id;
  const input={storeId:store.id,productId:product,quantity:'5000',expectedVersion:null,reason:'Contagem inicial'};
  assert.equal((await req('stock',input)).status,401);
  const attempts=await Promise.all([req('stock',input,cookie),req('stock',input,cookie)]);assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  const catalog=await(await req(`public/stores/${store.slug}/catalog`)).json();assert.equal(catalog.offers.length,1);assert.equal(catalog.offers[0].displayOnly,false);assert.equal(catalog.offers[0].amountMinor,'3790');
  const stock=(await(await req(`stock?storeId=${store.id}`,undefined,cookie)).json())[0];assert.equal(stock.quantity,'5000');
  await tx(identity.organizationId,async c=>{await c.query('UPDATE app.inventory_balance SET reserved_qty=1000 WHERE store_id=$1',[store.id]);});
  assert.equal((await req('stock',{...input,quantity:'999',expectedVersion:stock.version},cookie)).status,409);
  assert.equal((await req('stock',{...input,quantity:'6000',expectedVersion:stock.version},cookie)).status,200);
  const updated=(await(await req(`stock?storeId=${store.id}`,undefined,cookie)).json())[0];assert.equal(updated.reserved,'1000');
  const other=await req('auth/register',{name:'Outra empresa',email:`stock-other-${randomUUID()}@example.test`,password:'senha-local-para-estoque'});const otherCookie=other.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await req(`stock?storeId=${store.id}`,undefined,otherCookie)).status,404);
  await tx(identity.organizationId,async c=>{await c.query("UPDATE app.organization_membership SET role='VIEWER' WHERE actor_id=$1",[identity.actorId]);});
  assert.equal((await req('stock',{...input,quantity:'7000',expectedVersion:updated.version},cookie)).status,403);
  await tx(identity.organizationId,async c=>{assert.equal((await c.query("SELECT * FROM app.audit_log WHERE action='inventory.adjusted'")).rowCount,2);});
 }finally{await pool.end();}
});
test('HTTP de pesagem: sessão, isolamento, permissão e consumo único',async()=>{
 const pool=new pg.Pool({connectionString:url,max:2});
 const req=(path:string,body?:unknown,cookie?:string)=>fetch(`${base}/api/${path}`,{method:body===undefined?'GET':'POST',headers:{Origin:base!,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  const login=await req('auth/register',{name:'Teste bancada',email:`weigh-${randomUUID()}@example.test`,password:'senha-local-para-pesagem'});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
  const identity=(await session(pool,cookie.split('=')[1]))!;
  const transaction=createTenantTransaction(pool);
  const product=randomUUID(),inventory=randomUUID(),preparation=randomUUID(),offer=randomUUID();
  const store=await transaction(identity.organizationId,async client=>{
   const store=(await client.query('SELECT id FROM app.store')).rows[0].id as string;
   await client.query("INSERT INTO app.product(id,organization_id,name,sku,stock_unit,sale_strategy) VALUES ($1,$2,'Patinho teste','WEIGH','G','WEIGHT_FREE')",[product,identity.organizationId]);
   await client.query("INSERT INTO app.inventory_item(id,organization_id,name,sku,base_unit) VALUES ($1,$2,'Patinho teste','WEIGH','G')",[inventory,identity.organizationId]);
   await client.query("INSERT INTO app.preparation_option(id,organization_id,code,name) VALUES ($1,$2,'BIFE','Bife')",[preparation,identity.organizationId]);
   await client.query("INSERT INTO app.catalog_offer(id,organization_id,product_id,inventory_item_id,preparation_option_id,sku,sale_unit,public_visible) VALUES ($1,$2,$3,$4,$5,'WEIGH','G',true)",[offer,identity.organizationId,product,inventory,preparation]);
   await client.query("INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision) VALUES ($1,$2,$3,$4,'STOREFRONT',3790,'BRL',1)",[randomUUID(),identity.organizationId,store,product]);
   await client.query("INSERT INTO app.inventory_balance(id,organization_id,store_id,inventory_item_id,on_hand_qty) VALUES ($1,$2,$3,$4,5000)",[randomUUID(),identity.organizationId,store,inventory]);return store;
  });
  const orderId=randomUUID(),itemId=randomUUID();
  await createOrderAuthorized(pool,{organizationId:identity.organizationId,actorId:identity.actorId,storeId:store,orderId,customerName:'Cliente de teste',customerPhone:'11900000000',fulfillmentType:'PICKUP',currency:'BRL',items:[{id:itemId,offerId:offer,requestedQty:'1000',reservedQty:'1000'}]});
  const path=`orders/${orderId}`,weigh=`${path}/items/${itemId}/weigh`;
  assert.equal((await req(path)).status,401);assert.equal((await req(weigh,{finalQty:'1000'})).status,401);
  const other=await req('auth/register',{name:'Outra empresa',email:`other-${randomUUID()}@example.test`,password:'senha-local-para-pesagem'});const otherCookie=other.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await req(path,undefined,otherCookie)).status,404);assert.equal((await req(weigh,{finalQty:'1000'},otherCookie)).status,404);
  assert.equal((await req(weigh,{finalQty:'1000'},cookie)).status,409);
  for(const status of ['CONFIRMED','SEPARATING'])assert.equal((await req(`${path}/status`,{status},cookie)).status,200);
  const details=await req(path,undefined,cookie);assert.equal(details.headers.get('cache-control'),'no-store');assert.equal((await details.json()).canWeigh,true);
  for(const finalQty of ['0','1001','1.5'])assert.ok([400,409].includes((await req(weigh,{finalQty},cookie)).status));
  await transaction(identity.organizationId,async client=>{await client.query("UPDATE app.organization_membership SET role='VIEWER' WHERE actor_id=$1",[identity.actorId]);});
  assert.equal((await (await req(path,undefined,cookie)).json()).canWeigh,false);
  assert.equal((await req(weigh,{finalQty:'1000'},cookie)).status,403);
  await transaction(identity.organizationId,async client=>{await client.query("UPDATE app.organization_membership SET role='OWNER' WHERE actor_id=$1",[identity.actorId]);});
  const responses=await Promise.all([req(weigh,{finalQty:'1000'},cookie),req(weigh,{finalQty:'1000'},cookie)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const final=await(await req(path,undefined,cookie)).json();assert.equal(final.order.finalTotalMinor,'3790');assert.equal(final.items[0].finalQty,'1000');assert.equal(final.canWeigh,false);
 }finally{await pool.end();}
});
