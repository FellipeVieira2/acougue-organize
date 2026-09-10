import { allocateMinor, nonNegative, positive, requireRule } from './quantities.ts';

export interface ProductionOutput { id: string; grams: bigint; relativeValue: bigint }

export function closeProduction(inputGrams: bigint, lossGrams: bigint, totalCostMinor: bigint, outputs: readonly ProductionOutput[], toleranceGrams: bigint, strategy: 'WEIGHT_PROPORTIONAL' | 'MARKET_VALUE_RELATIVE') {
  positive(inputGrams);
  nonNegative(lossGrams);
  nonNegative(totalCostMinor);
  nonNegative(toleranceGrams);
  requireRule(toleranceGrams < inputGrams, 'INVALID_TOLERANCE', 'A tolerância deve ser menor que a massa de entrada.');
  requireRule(strategy === 'WEIGHT_PROPORTIONAL' || strategy === 'MARKET_VALUE_RELATIVE', 'INVALID_STRATEGY', 'Método de rateio não suportado.');
  requireRule(outputs.length > 0, 'INVALID_OUTPUTS', 'Registre as saídas da produção.');
  const outputGrams = outputs.reduce((sum, output) => sum + positive(output.grams), 0n);
  nonNegative(outputGrams);
  const difference = inputGrams - outputGrams - lossGrams;
  const abs = difference < 0n ? -difference : difference;
  requireRule(abs <= toleranceGrams, 'MASS_MISMATCH', 'A soma das saídas e perdas não confere com a entrada.');
  const weights = outputs.map(output => ({ id: output.id, weight: strategy === 'WEIGHT_PROPORTIONAL' ? output.grams : nonNegative(output.relativeValue) }));
  const costs = allocateMinor(totalCostMinor, weights);
  return { inputGrams, outputGrams, lossGrams, differenceGrams: difference, totalCostMinor, costs, strategy };
}
