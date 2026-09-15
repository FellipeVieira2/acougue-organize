import { nonNegative, positive, requireRule, priceByGrams, priceByUnits, sumMinor, withinWeightPolicy } from './quantities.ts';
import type { WeightPolicy } from './quantities.ts';

export type FulfillmentStatus = 'RECEIVED' | 'CONFIRMED' | 'SEPARATING' | 'WEIGHING' | 'WAITING_CUSTOMER_APPROVAL' | 'WEIGHT_ADJUSTED' | 'READY' | 'COMPLETED' | 'CANCELED';
export type DeliveryStatus = 'NOT_REQUIRED' | 'WAITING_PICKUP' | 'SCHEDULED' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'PICKED_UP' | 'FAILED';

const transitions: Readonly<Record<FulfillmentStatus, readonly FulfillmentStatus[]>> = {
  RECEIVED: ['CONFIRMED', 'CANCELED'],
  CONFIRMED: ['SEPARATING', 'CANCELED'],
  SEPARATING: ['WEIGHING', 'CANCELED'],
  WEIGHING: ['WAITING_CUSTOMER_APPROVAL', 'WEIGHT_ADJUSTED', 'CANCELED'],
  WAITING_CUSTOMER_APPROVAL: ['WEIGHING', 'WEIGHT_ADJUSTED', 'CANCELED'],
  WEIGHT_ADJUSTED: ['WEIGHING', 'READY', 'CANCELED'],
  READY: ['COMPLETED', 'CANCELED'],
  COMPLETED: [],
  CANCELED: [],
};

export function isTerminalStatus(status: FulfillmentStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELED';
}

export function canTransitionOrder(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  if (isTerminalStatus(from)) return false;
  return transitions[from]?.includes(to) === true;
}

export interface OrderGuards {
  itemsResolved: boolean;
  requiresApproval: boolean;
  quoteRevision: bigint;
  approvedRevision: bigint | null;
  finalTotalMinor: bigint | null;
  capturedMinor: bigint;
  refundedMinor: bigint;
  deliveryStatus: DeliveryStatus;
}

/** Pure guard only; the application must persist state/history under a version lock. */
export function transitionOrder(from: FulfillmentStatus, to: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  requireRule(canTransitionOrder(from, to), 'INVALID_TRANSITION', 'Esta mudança de etapa não é permitida.');
  nonNegative(guards.capturedMinor);
  nonNegative(guards.refundedMinor);
  requireRule(guards.refundedMinor <= guards.capturedMinor, 'INVALID_PAYMENT', 'O estorno não pode superar o recebimento.');
  positive(guards.quoteRevision);
  if (['WEIGHT_ADJUSTED', 'READY', 'COMPLETED'].includes(to)) {
    requireRule(guards.itemsResolved && guards.finalTotalMinor !== null, 'UNRESOLVED_ITEMS', 'Conclua a pesagem e resolva os itens indisponíveis.');
    nonNegative(guards.finalTotalMinor);
    requireRule(!guards.requiresApproval || guards.approvedRevision === guards.quoteRevision,
      'APPROVAL_REQUIRED', 'O cliente precisa aprovar o valor desta revisão do pedido.');
  }
  if (to === 'COMPLETED') {
    requireRule(guards.finalTotalMinor !== null && guards.capturedMinor - guards.refundedMinor === guards.finalTotalMinor,
      'PAYMENT_REQUIRED', 'Confira o recebimento do valor final do pedido.');
    requireRule(['NOT_REQUIRED', 'DELIVERED', 'PICKED_UP'].includes(guards.deliveryStatus),
      'DELIVERY_REQUIRED', 'Registre a entrega ou retirada antes de concluir.');
  }
  if (to === 'CANCELED') requireRule(guards.capturedMinor === guards.refundedMinor,
    'REFUND_REQUIRED', 'Devolva os valores recebidos antes de cancelar.');
  return to;
}

export function confirmOrder(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'CONFIRMED', guards);
}

export function startOrderSeparation(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'SEPARATING', guards);
}

export function startOrderWeighing(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'WEIGHING', guards);
}

export function requestCustomerApproval(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'WAITING_CUSTOMER_APPROVAL', guards);
}

export function approveOrderWeight(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'WEIGHT_ADJUSTED', guards);
}

export function markOrderReady(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'READY', guards);
}

export function completeOrder(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'COMPLETED', guards);
}

export function cancelOrder(from: FulfillmentStatus, guards: OrderGuards): FulfillmentStatus {
  return transitionOrder(from, 'CANCELED', guards);
}

export interface QuotedLine {
  id: string;
  unit: 'G' | 'UNIT';
  requestedQuantity: bigint;
  actualQuantity: bigint;
  priceMinorSnapshot: bigint;
  policy: WeightPolicy;
}

export function quoteLines(lines: readonly QuotedLine[]) {
  requireRule(lines.length > 0 && lines.length <= 500, 'INVALID_ITEMS', 'Informe entre 1 e 500 itens.');
  const ids = new Set<string>();
  const items = lines.map(line => {
    requireRule(typeof line.id === 'string' && line.id.length > 0 && !ids.has(line.id), 'INVALID_ITEMS', 'Os itens devem ter identificadores únicos.');
    ids.add(line.id);
    requireRule(line.unit === 'G' || line.unit === 'UNIT', 'INVALID_UNIT', 'A unidade de venda é inválida.');
    const calculate = line.unit === 'G' ? priceByGrams : priceByUnits;
    const estimatedSubtotalMinor = calculate(line.priceMinorSnapshot, line.requestedQuantity);
    const finalSubtotalMinor = calculate(line.priceMinorSnapshot, line.actualQuantity);
    const requiresApproval = line.unit === 'G'
      ? !withinWeightPolicy(line.requestedQuantity, line.actualQuantity, line.policy)
      : line.requestedQuantity !== line.actualQuantity;
    return { id: line.id, estimatedSubtotalMinor, finalSubtotalMinor, requiresApproval };
  });
  return {
    items,
    estimatedTotalMinor: sumMinor(items.map(item => item.estimatedSubtotalMinor)),
    finalTotalMinor: sumMinor(items.map(item => item.finalSubtotalMinor)),
    requiresApproval: items.some(item => item.requiresApproval),
  };
}

export function refundableMinor(capturedMinor: bigint, refundedMinor: bigint, requestedRefundMinor: bigint): bigint {
  nonNegative(capturedMinor);
  nonNegative(refundedMinor);
  positive(requestedRefundMinor);
  requireRule(refundedMinor <= capturedMinor && requestedRefundMinor <= capturedMinor - refundedMinor,
    'REFUND_EXCEEDED', 'O estorno solicitado excede o saldo disponível.');
  return refundedMinor + requestedRefundMinor;
}
