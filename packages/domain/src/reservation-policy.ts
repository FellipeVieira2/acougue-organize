const DEFAULT_ORDER_RESERVATION_TTL_MINUTES = 30;

export function orderReservationTtlMinutes(): number {
  const configured = Number(process.env.ORDER_RESERVATION_TTL_MINUTES ?? DEFAULT_ORDER_RESERVATION_TTL_MINUTES);
  return Number.isInteger(configured) && configured > 0 && configured <= 24 * 60 ? configured : DEFAULT_ORDER_RESERVATION_TTL_MINUTES;
}