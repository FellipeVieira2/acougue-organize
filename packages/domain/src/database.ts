import { Pool, type PoolClient, type PoolConfig } from "pg";

export type TenantTransaction = <T>(
  organizationId: string,
  operation: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export function createPool(config: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ...config,
  });
}

export function createTenantTransaction(pool: Pool): TenantTransaction {
  return async (organizationId, operation) => {
    if (!/^[0-9a-f-]{36}$/i.test(organizationId)) {
      throw new Error("organizationId must be a UUID");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config($1, $2, true)", ["role", "acougue_runtime"]);
      await client.query("SELECT set_config($1, $2, true)", ["app.organization_id", organizationId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}

export async function closePool(pool: Pool): Promise<void> {
  await pool.end();
}
