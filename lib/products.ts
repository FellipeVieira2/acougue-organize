import { ApiError } from '../packages/domain/src/api.ts';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withMembershipTransaction } from '../packages/domain/src/membership.ts';
import { strictBody } from './web.ts';
import type { Session } from './auth.ts';

export function parseProductUpdate(body: Record<string, unknown>) {
  strictBody(body, ['name', 'active', 'expectedVersion']);
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) throw new ApiError(400, 'VALIDATION_ERROR', 'Informe um nome de até 200 caracteres.');
  if (typeof body.active !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'Informe o status do produto.');
  if (typeof body.expectedVersion !== 'string' || !/^[1-9][0-9]{0,18}$/.test(body.expectedVersion) || BigInt(body.expectedVersion) >= 9223372036854775807n) throw new ApiError(400, 'VALIDATION_ERROR', 'Versão do produto inválida. Recarregue o catálogo.');
  return { name: body.name.trim(), active: body.active, expectedVersion: body.expectedVersion };
}
export async function updateProduct(pool: Pool, identity: Session, id: string, body: Record<string, unknown>, requestId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError(400, 'VALIDATION_ERROR', 'Produto inválido.');
  const input = parseProductUpdate(body);
  return withMembershipTransaction(pool, identity.organizationId, identity.actorId, 'MANAGER', async client => {
    const current = (await client.query('SELECT id FROM app.product WHERE id=$1', [id])).rows[0];
    if (!current) throw new ApiError(404, 'NOT_FOUND', 'Produto não encontrado.');
    const result = await client.query(`UPDATE app.product SET name=$1,active=$2,version=version+1,updated_at=now()
      WHERE id=$3 AND version=$4 RETURNING id,name,active,version`, [input.name,input.active,id,input.expectedVersion]);
    if (!result.rows[0]) throw new ApiError(409, 'CONFLICT', 'Este produto foi alterado por outra pessoa. Recarregue os dados antes de editar novamente.');
    await client.query(`INSERT INTO app.audit_log(id,organization_id,actor_id,action,entity_id,correlation_id)
      VALUES ($1,$2,$3,'product.updated',$4,$5)`, [randomUUID(),identity.organizationId,identity.actorId,id,requestId]);
    return result.rows[0];
  });
}
