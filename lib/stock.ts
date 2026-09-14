import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { ApiError } from '../packages/domain/src/api.ts';
import { parseInteger, MAX_DB_INTEGER } from '../packages/domain/src/quantities.ts';
import { withMembershipTransaction } from '../packages/domain/src/membership.ts';
import type { Session } from './auth.ts';
import { strictBody } from './web.ts';

function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400,'VALIDATION_ERROR','Identificação inválida.');
}
export function parseStock(body: Record<string, unknown>) {
  strictBody(body,['storeId','productId','quantity','expectedVersion','reason']);
  uuid(body.storeId); uuid(body.productId);
  let quantity: bigint;
  try { quantity=parseInteger(body.quantity); if (body.expectedVersion !== null && (parseInteger(body.expectedVersion)===0n || parseInteger(body.expectedVersion)>=MAX_DB_INTEGER)) throw new Error(); }
  catch { throw new ApiError(400,'VALIDATION_ERROR','Informe quantidade inteira não negativa e versão válida.'); }
  if (typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>500) throw new ApiError(400,'VALIDATION_ERROR','Informe o motivo do ajuste (até 500 caracteres).');
  return {storeId:body.storeId,productId:body.productId,quantity,expectedVersion:body.expectedVersion as string|null,reason:body.reason.trim()};
}
export async function listStock(pool: Pool, identity: Session, storeId: string) {
  uuid(storeId);
  return withMembershipTransaction(pool,identity.organizationId,identity.actorId,'VIEWER',async c=>{
    if (!(await c.query('SELECT id FROM app.store WHERE id=$1 AND active=true',[storeId])).rowCount) throw new ApiError(404,'NOT_FOUND','Loja ativa não encontrada.');
    return (await c.query(`SELECT p.id,p.name,p.stock_unit AS unit,
      count(DISTINCT o.inventory_item_id)::integer AS "inventoryCount",
      max(b.on_hand_qty)::text AS quantity,max(b.reserved_qty)::text AS reserved,max(b.version)::text AS version
      FROM app.product p LEFT JOIN app.catalog_offer o ON o.organization_id=p.organization_id AND o.product_id=p.id
      LEFT JOIN app.inventory_balance b ON b.organization_id=o.organization_id AND b.inventory_item_id=o.inventory_item_id AND b.store_id=$1
      WHERE p.active=true GROUP BY p.id ORDER BY p.name,p.id LIMIT 200`,[storeId])).rows;
  });
}
export async function setStock(pool: Pool,identity:Session,body:Record<string,unknown>,requestId:string) {
  const input=parseStock(body);
  return withMembershipTransaction(pool,identity.organizationId,identity.actorId,'MANAGER',async c=>{
    if (!(await c.query('SELECT id FROM app.store WHERE id=$1 AND active=true FOR SHARE',[input.storeId])).rowCount) throw new ApiError(404,'NOT_FOUND','Loja ativa não encontrada.');
    const p=(await c.query('SELECT id,name,stock_unit FROM app.product WHERE id=$1 AND active=true FOR UPDATE',[input.productId])).rows[0];
    if (!p) throw new ApiError(404,'NOT_FOUND','Produto ativo não encontrado.');
    const ids=(await c.query('SELECT DISTINCT inventory_item_id AS id FROM app.catalog_offer WHERE product_id=$1',[p.id])).rows;
    if (ids.length>1) throw new ApiError(409,'CONFLICT','Este produto possui estoques diferentes por preparo. O ajuste precisa identificar o estoque físico.');
    let inventoryId=ids[0]?.id;
    if (!inventoryId) {
      inventoryId=randomUUID();
      await c.query('INSERT INTO app.inventory_item(id,organization_id,name,sku,base_unit) VALUES ($1,$2,$3,$4,$5)',[inventoryId,identity.organizationId,p.name,`WEB-${inventoryId}`,p.stock_unit]);
      await c.query("INSERT INTO app.preparation_option(id,organization_id,code,name) VALUES ($1,$2,'WEB_STANDARD','Peça') ON CONFLICT (organization_id,code) DO NOTHING",[randomUUID(),identity.organizationId]);
      const prep=(await c.query("SELECT id FROM app.preparation_option WHERE code='WEB_STANDARD' AND active=true")).rows[0];
      if (!prep) throw new ApiError(409,'CONFLICT','O preparo padrão está inativo.');
      await c.query('INSERT INTO app.catalog_offer(id,organization_id,product_id,inventory_item_id,preparation_option_id,sku,sale_unit,public_visible) VALUES ($1,$2,$3,$4,$5,$6,$7,true)',[randomUUID(),identity.organizationId,p.id,inventoryId,prep.id,`WEB-${p.id}`,p.stock_unit]);
      await c.query(`INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision)
        SELECT $1,$2,$3,$4,'STOREFRONT',amount_minor,currency,1 FROM app.product_price
        WHERE product_id=$4 AND store_id=$3 AND channel='POS'
          AND NOT EXISTS(SELECT 1 FROM app.product_price WHERE product_id=$4 AND store_id=$3 AND channel='STOREFRONT')
        ORDER BY revision DESC LIMIT 1`,[randomUUID(),identity.organizationId,input.storeId,p.id]);
    }
    const inv=(await c.query('SELECT base_unit,active FROM app.inventory_item WHERE id=$1 FOR SHARE',[inventoryId])).rows[0];
    if (!inv?.active || inv.base_unit!==p.stock_unit) throw new ApiError(409,'CONFLICT','Estoque físico inativo ou unidade incompatível.');
    // An existing offer can also be stocked in a second store with its own POS price.
    await c.query(`INSERT INTO app.product_price(id,organization_id,store_id,product_id,channel,amount_minor,currency,revision)
      SELECT $1,$2,$3,$4,'STOREFRONT',amount_minor,currency,1 FROM app.product_price
      WHERE product_id=$4 AND store_id=$3 AND channel='POS'
        AND NOT EXISTS(SELECT 1 FROM app.product_price WHERE product_id=$4 AND store_id=$3 AND channel='STOREFRONT')
      ORDER BY revision DESC LIMIT 1`,[randomUUID(),identity.organizationId,input.storeId,p.id]);
    const balance=(await c.query('SELECT on_hand_qty,reserved_qty,version FROM app.inventory_balance WHERE store_id=$1 AND inventory_item_id=$2 FOR UPDATE',[input.storeId,inventoryId])).rows[0];
    if ((balance?.version??null)!==input.expectedVersion) throw new ApiError(409,'CONFLICT','O estoque mudou. Atualize a lista antes de ajustar.');
    if (input.quantity<BigInt(balance?.reserved_qty??'0')) throw new ApiError(409,'CONFLICT','O saldo não pode ser menor que a quantidade reservada em pedidos.');
    const delta=input.quantity-BigInt(balance?.on_hand_qty??'0');
    if (balance) await c.query('UPDATE app.inventory_balance SET on_hand_qty=$3,version=version+1,updated_at=now() WHERE store_id=$1 AND inventory_item_id=$2',[input.storeId,inventoryId,input.quantity.toString()]);
    else await c.query('INSERT INTO app.inventory_balance(id,organization_id,store_id,inventory_item_id,on_hand_qty) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),identity.organizationId,input.storeId,inventoryId,input.quantity.toString()]);
    if (delta!==0n) await c.query("INSERT INTO app.inventory_movement(id,organization_id,store_id,inventory_item_id,movement_type,quantity_delta,reason,actor_id) VALUES ($1,$2,$3,$4,'ADJUSTMENT',$5,$6,$7)",[randomUUID(),identity.organizationId,input.storeId,inventoryId,delta.toString(),input.reason,identity.actorId]);
    await c.query("INSERT INTO app.audit_log(id,organization_id,actor_id,action,entity_id,correlation_id,reason) VALUES ($1,$2,$3,'inventory.adjusted',$4,$5,$6)",[randomUUID(),identity.organizationId,identity.actorId,inventoryId,requestId,input.reason]);
    return {ok:true};
  });
}
