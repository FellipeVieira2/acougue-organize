import { Pool } from 'pg';
import { ApiError } from '../packages/domain/src/api.ts';

let pool: Pool | undefined;
export function database(): Pool {
  if (!process.env.DATABASE_URL) throw new ApiError(503, 'PRECONDITION_REQUIRED', 'Conecte o PostgreSQL nas variáveis de ambiente para ativar sua conta.');
  return pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000, allowExitOnIdle: true });
}

export function requireOrigin(request: Request): void {
  const configured = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const allowedOrigins = new Set<string>();
  if (configured) allowedOrigins.add(new URL(configured).origin);
  if (process.env.NODE_ENV !== 'production' || ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) allowedOrigins.add(new URL(request.url).origin);
  if (!allowedOrigins.has(request.headers.get('origin') ?? '')) throw new ApiError(403, 'FORBIDDEN', 'Origem da solicitação não permitida.');
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'VALIDATION_ERROR', 'Envie JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'VALIDATION_ERROR', 'Requisição vazia.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 16384) { await reader.cancel(); throw new ApiError(413, 'VALIDATION_ERROR', 'Requisição muito grande.'); }
    chunks.push(chunk.value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'JSON inválido.'); }
}

export function strictBody(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'VALIDATION_ERROR', 'Há campos não permitidos na requisição.');
}
