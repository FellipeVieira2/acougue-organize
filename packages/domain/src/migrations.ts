import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

export type Migration = { name: string; sql: string };

export function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

export async function applyMigrations(pool: Pool, migrations: Migration[]): Promise<void> {
  const ordered = [...migrations].sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(ordered.map(migration => migration.name)).size !== ordered.length) {
    throw new Error("Duplicate migration names");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734231901)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const migration of ordered) {
      const result = await client.query<{ checksum: string }>(
        "SELECT checksum FROM public.schema_migrations WHERE name = $1",
        [migration.name],
      );
      const expected = checksum(migration.sql);
      const applied = result.rows[0];
      if (applied && applied.checksum !== expected) {
        throw new Error(`Migration checksum mismatch: ${migration.name}`);
      }
      if (applied) continue;

      // The original standalone foundation includes its own transaction envelope.
      // Keep its checksum intact while allowing this runner to own the transaction.
      const sql = migration.name === "0001_tenant_foundation.sql"
        ? migration.sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "")
        : migration.sql;
      await client.query(sql);
      await client.query(
        "INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)",
        [migration.name, expected],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function loadMigration(path: string, name: string): Promise<Migration> {
  return { name, sql: await readFile(path, "utf8") };
}
