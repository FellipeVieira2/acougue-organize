import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { ApiError } from "./api.ts";

export type RateLimitConfig = { namespace: string; limit: number; windowSeconds: number };
const integerEnv = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export const publicRateLimits = {
  checkoutIpBurst: { namespace: "public-checkout:ip:burst", limit: integerEnv("PUBLIC_CHECKOUT_IP_BURST_LIMIT", 5), windowSeconds: integerEnv("PUBLIC_CHECKOUT_IP_BURST_WINDOW_SECONDS", 60) },
  checkoutIpHour: { namespace: "public-checkout:ip:hour", limit: integerEnv("PUBLIC_CHECKOUT_IP_HOURLY_LIMIT", 20), windowSeconds: integerEnv("PUBLIC_CHECKOUT_IP_HOURLY_WINDOW_SECONDS", 3600) },
  checkoutCustomer: { namespace: "public-checkout:customer:hour", limit: integerEnv("PUBLIC_CHECKOUT_CUSTOMER_LIMIT", 5), windowSeconds: integerEnv("PUBLIC_CHECKOUT_CUSTOMER_WINDOW_SECONDS", 3600) },
  checkoutStore: { namespace: "public-checkout:store:burst", limit: integerEnv("PUBLIC_CHECKOUT_STORE_LIMIT", 100), windowSeconds: integerEnv("PUBLIC_CHECKOUT_STORE_WINDOW_SECONDS", 300) },
  quoteIp: { namespace: "public-quote:ip", limit: integerEnv("PUBLIC_QUOTE_IP_LIMIT", 30), windowSeconds: integerEnv("PUBLIC_QUOTE_IP_WINDOW_SECONDS", 60) },
  approvalIp: { namespace: "public-approval:ip", limit: integerEnv("PUBLIC_APPROVAL_IP_LIMIT", 10), windowSeconds: integerEnv("PUBLIC_APPROVAL_IP_WINDOW_SECONDS", 60) },
} as const;

export const publicMaxActiveOrders = () => integerEnv("PUBLIC_CHECKOUT_MAX_ACTIVE_ORDERS", 3);

export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new ApiError(400, "VALIDATION_ERROR", "Telefone inválido.");
  return digits;
}

export function hashRateLimitSubject(subject: string): string {
  const secret = process.env.RATE_LIMIT_SECRET ?? process.env.ORDER_ACCESS_SECRET ?? "development-rate-limit-secret";
  return createHash("sha256").update(`${secret}:${subject}`).digest("hex");
}

export async function consumeRateLimit(client: PoolClient, organizationId: string, storeId: string, subject: string, config: RateLimitConfig): Promise<number> {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const windowStartedAt = new Date(Math.floor(now / windowMs) * windowMs);
  const expiresAt = new Date(windowStartedAt.getTime() + windowMs);
  const result = await client.query<{ count: number; expiresAt: Date }>(`INSERT INTO app.rate_limit_bucket
      (organization_id, store_id, namespace, subject_hash, window_started_at, count, expires_at)
      VALUES ($1,$2,$3,$4,$5,1,$6)
      ON CONFLICT (organization_id, store_id, namespace, subject_hash, window_started_at)
      DO UPDATE SET count = app.rate_limit_bucket.count + 1
      WHERE app.rate_limit_bucket.count < $7
      RETURNING count, expires_at AS "expiresAt"`, [organizationId, storeId, config.namespace, hashRateLimitSubject(subject), windowStartedAt, expiresAt, config.limit]);
  if (result.rows[0]) return Math.max(1, Math.ceil((result.rows[0].expiresAt.getTime() - now) / 1000));
  throw new ApiError(429, "RATE_LIMITED", "Muitas tentativas de pedido. Aguarde um pouco e tente novamente.", undefined, Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)), config.namespace);
}

export async function assertActiveOrderLimit(client: PoolClient, organizationId: string, storeId: string, phone: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`active-orders:${organizationId}:${storeId}:${phone}`]);
  const result = await client.query<{ count: string }>(`SELECT count(DISTINCT o.id)::text AS count
    FROM app.sales_order o JOIN app.inventory_reservation r ON r.organization_id=o.organization_id AND r.order_id=o.id
    WHERE o.organization_id=$1 AND o.store_id=$2 AND regexp_replace(o.customer_phone, '\\D', '', 'g')=$3
      AND o.order_status NOT IN ('CANCELED','COMPLETED') AND r.status='ACTIVE' AND (r.expires_at IS NULL OR r.expires_at > now())`, [organizationId, storeId, phone]);
  if (Number(result.rows[0]?.count ?? 0) >= publicMaxActiveOrders()) throw new ApiError(429, "RATE_LIMITED", "Muitas tentativas de pedido. Aguarde um pouco e tente novamente.", undefined, 60, "active-orders");
}

export async function cleanupRateLimitBuckets(client: PoolClient, batchSize = 500): Promise<number> {
  const result = await client.query(`DELETE FROM app.rate_limit_bucket WHERE ctid IN (SELECT ctid FROM app.rate_limit_bucket WHERE expires_at < now() - interval '1 hour' LIMIT $1)`, [batchSize]);
  return result.rowCount ?? 0;
}