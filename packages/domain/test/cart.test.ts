import test from 'node:test';
import assert from 'node:assert/strict';
import { cartTotalMinor, validateOfferQuantity } from '../../../lib/cart.ts';
const offer = { saleUnit: 'G' as const, amountMinor: '3790', minWeightG: '250', maxWeightG: '2000', weightStepG: '125' };
test('carrinho mantém centavos e arredonda cada item como o servidor', () => {
  assert.equal(cartTotalMinor([{ offer, quantity: '1375' }]), '5211');
  assert.equal(cartTotalMinor([{ offer: {...offer, amountMinor:'1'}, quantity:'500' }, { offer: {...offer, amountMinor:'1'}, quantity:'500' }]), '2');
  assert.equal(cartTotalMinor([{ offer: {...offer,saleUnit:'UNIT',amountMinor:'1500'}, quantity:'2' }]), '3000');
});
test('oferta limita peso e incremento a partir do mínimo', () => {
  assert.equal(validateOfferQuantity(offer,'250'),250n);
  assert.equal(validateOfferQuantity(offer,'2000'),2000n);
  for (const qty of ['0','249','2001','300','1.5','01']) assert.throws(() => validateOfferQuantity(offer,qty));
  assert.throws(() => validateOfferQuantity({...offer,saleUnit:'FIXED_PACKAGE'},'1'));
  assert.equal(validateOfferQuantity({...offer,saleUnit:'UNIT'},'1'),1n);
});

test('formatação não perde centavos acima do limite de precisão de Number', async () => {
  const { formatMinor } = await import('../../../lib/cart.ts');
  assert.equal(formatMinor('9007199254740993').replace(/\s/g,''),'R$90.071.992.547.409,93');
  assert.equal(validateOfferQuantity({...offer,minWeightG:null,weightStepG:'100'},'1000'),1000n);
});
