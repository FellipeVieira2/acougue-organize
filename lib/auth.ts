import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '../packages/domain/src/api.ts';
import { createTenantTransaction } from '../packages/domain/src/database.ts';
import { createOrganizationInTransaction } from '../packages/domain/src/onboarding.ts';

export const SESSION_SECONDS = 8 * 60 * 60;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const key = (password: string, salt: string): Promise<Buffer> => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result));
});

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 256) throw new ApiError(400, 'VALIDATION_ERROR', 'Use uma senha com pelo menos 12 caracteres e até 256 bytes.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await key(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 256) return false;
  const [version, salt, encoded] = stored.split(':');
  if (version !== 'scrypt-v1' || !salt || !encoded || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(encoded)) return false;
  return timingSafeEqual(await key(password, salt), Buffer.from(encoded, 'hex'));
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe um e-mail válido.');
  return value.trim().toLowerCase();
}

async function identityTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE acougue_runtime');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

// Persisted outside the login transaction so failed credentials still consume attempts.
async function throttle(pool: Pool, email: string): Promise<void> {
  const attempts = await identityTransaction(pool, async client => {
    const result = await client.query(`INSERT INTO identity.login_limit(key_hash) VALUES ($1)
      ON CONFLICT(key_hash) DO UPDATE SET
        attempts = CASE WHEN identity.login_limit.window_start < now() - interval '15 minutes' THEN 1 ELSE identity.login_limit.attempts + 1 END,
        window_start = CASE WHEN identity.login_limit.window_start < now() - interval '15 minutes' THEN now() ELSE identity.login_limit.window_start END
      RETURNING attempts`, [digest(email)]);
    return result.rows[0].attempts as number;
  });
  if (attempts > 10) throw new ApiError(429, 'FORBIDDEN', 'Muitas tentativas. Aguarde 15 minutos.');
}

async function createSession(client: PoolClient, actorId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await client.query("INSERT INTO identity.session(token_hash, actor_id, expires_at) VALUES ($1,$2,now() + interval '8 hours')", [digest(token), actorId]);
  return token;
}

export async function register(pool: Pool, input: { email: unknown; password: string; name: string }): Promise<string> {
  const email = normalizeEmail(input.email);
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe o nome do açougue.');
  await throttle(pool, email);
  const passwordHash = await hashPassword(input.password);
  const actorId = randomUUID(), organizationId = randomUUID(), storeId = randomUUID();
  try {
    return await createTenantTransaction(pool)(organizationId, async client => {
      await createOrganizationInTransaction(client, { actorId, organizationId, storeId, name: input.name, storeName: 'Matriz', storeSlug: `loja-${storeId}`, auditId: randomUUID(), correlationId: randomUUID() });
      await client.query('INSERT INTO identity.account(id,email,password_hash,organization_id) VALUES ($1,$2,$3,$4)', [actorId, email, passwordHash, organizationId]);
      return createSession(client, actorId);
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') throw new ApiError(409, 'CONFLICT', 'Não foi possível criar a conta com esses dados. Tente entrar.');
    throw error;
  }
}

export async function login(pool: Pool, input: { email: unknown; password: string }): Promise<string> {
  const email = normalizeEmail(input.email);
  await throttle(pool, email);
  const account = await identityTransaction(pool, async client => (await client.query('SELECT id,password_hash FROM identity.account WHERE email=$1', [email])).rows[0]);
  const fallback = `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
  const valid = await verifyPassword(input.password, account?.password_hash ?? fallback);
  if (!account || !valid) throw new ApiError(401, 'UNAUTHORIZED', 'E-mail ou senha incorretos.');
  return identityTransaction(pool, client => createSession(client, account.id));
}

export type Session = { actorId: string; organizationId: string; email: string };
export async function session(pool: Pool, token: string | undefined): Promise<Session | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return identityTransaction(pool, async client => {
    const result = await client.query<Session>(`SELECT a.id AS "actorId", a.organization_id AS "organizationId", a.email
      FROM identity.session s JOIN identity.account a ON a.id=s.actor_id
      WHERE s.token_hash=$1 AND s.expires_at > now()`, [digest(token)]);
    return result.rows[0] ?? null;
  });
}

export async function logout(pool: Pool, token: string | undefined): Promise<void> {
  if (!token) return;
  await identityTransaction(pool, async client => { await client.query('DELETE FROM identity.session WHERE token_hash=$1', [digest(token)]); });
}
