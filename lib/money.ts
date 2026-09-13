/** BRL values stay integral from input to storage and display. */
export function priceToMinor(value: string): string {
  if (!/^\d{1,16}(?:[,.]\d{1,2})?$/.test(value.trim())) throw new Error('Informe um preço válido, como 39,90.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > 9223372036854775807n) throw new Error('O preço informado é muito alto.');
  return minor.toString();
}
export function formatBRL(value: string | null): string {
  if (value === null) return 'Sem preço';
  const minor = BigInt(value);
  return `R$ ${(minor / 100n).toLocaleString('pt-BR')},${(minor % 100n).toString().padStart(2, '0')}`;
}
