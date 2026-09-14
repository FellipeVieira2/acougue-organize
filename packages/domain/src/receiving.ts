import { parseInteger, positive } from './quantities.ts';

/** Quantities use the inventory item's base unit; costs are total acquisition cents. */
export function parseReceiptAmounts(quantity: unknown, totalCostMinor: unknown) {
  return {
    quantity: positive(parseInteger(quantity)),
    totalCostMinor: parseInteger(totalCostMinor),
  };
}
