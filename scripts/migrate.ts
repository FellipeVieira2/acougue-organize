import { readdir, readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { applyMigrations } from '../packages/domain/src/migrations.ts';
if (!process.env.DATABASE_MIGRATION_URL) throw new Error('Defina DATABASE_MIGRATION_URL para uma conexão administrativa.');
const directory = new URL('../database/migrations/', import.meta.url);
const migrations = await Promise.all((await readdir(directory)).filter(name => name.endsWith('.sql')).map(async name => ({ name, sql: await readFile(new URL(name, directory), 'utf8') })));
const pool = new Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, max: 1 });
try { await applyMigrations(pool, migrations); console.log('Migrações aplicadas.'); }
finally { await pool.end(); }
