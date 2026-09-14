import { parseInteger, positive, priceByGrams, priceByUnits, sumMinor, requireRule } from '../packages/domain/src/quantities.ts';

export type CartOffer = { saleUnit: 'G' | 'UNIT' | 'FIXED_PACKAGE'; amountMinor: string; minWeightG: string | null; maxWeightG: string | null; weightStepG: string | null; defaultWeightG?: string | null };
export function validateOfferQuantity(offer: CartOffer, value: string): bigint {
  const qty = positive(parseInteger(value));
  requireRule(offer.saleUnit !== 'FIXED_PACKAGE', 'INVALID_QUANTITY', 'Esta embalagem ainda não está disponível para pedidos online.');
  if (offer.saleUnit === 'G') {
    const minimum = offer.minWeightG ? positive(parseInteger(offer.minWeightG)) : 0n;
    requireRule(qty >= minimum && (!offer.maxWeightG || qty <= positive(parseInteger(offer.maxWeightG))), 'INVALID_QUANTITY', 'Escolha um peso dentro dos limites da oferta.');
    if (offer.weightStepG) requireRule((qty - minimum) % positive(parseInteger(offer.weightStepG)) === 0n, 'INVALID_QUANTITY', 'Escolha um peso no intervalo permitido pela oferta.');
  }
  return qty;
}
export function cartTotalMinor(lines: readonly { offer: CartOffer; quantity: string }[]): string {
  return sumMinor(lines.map(({offer, quantity}) => offer.saleUnit === 'G'
    ? priceByGrams(parseInteger(offer.amountMinor), positive(parseInteger(quantity)))
    : priceByUnits(parseInteger(offer.amountMinor), positive(parseInteger(quantity))))).toString();
}

export function formatMinor(minor: string, currency = 'BRL'): string {
  const value = parseInteger(minor);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).formatToParts(value / 100n)
    .map(part => part.type === 'fraction' ? (value % 100n).toString().padStart(2, '0') : part.value).join('');
}
