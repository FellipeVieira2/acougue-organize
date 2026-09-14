import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStock } from '../../../lib/stock.ts';
const body={storeId:'11111111-1111-4111-8111-111111111111',productId:'22222222-2222-4222-8222-222222222222',quantity:'0',expectedVersion:null,reason:'Contagem física'};
test('saldo físico aceita zero e bigint exato e rejeita números ambíguos',()=>{
 assert.equal(parseStock(body).quantity,0n);
 assert.equal(parseStock({...body,quantity:'9007199254740993',expectedVersion:'1'}).quantity,9007199254740993n);
 for(const quantity of [1,'-1','1.5','01','9223372036854775808'])assert.throws(()=>parseStock({...body,quantity}));
 for(const expectedVersion of [undefined,'0',1,'9223372036854775807'])assert.throws(()=>parseStock({...body,expectedVersion}));
 assert.throws(()=>parseStock({...body,organizationId:body.storeId}));
});
