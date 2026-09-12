import type { Pool, PoolClient } from "pg";
import { createTenantTransaction } from "./database.ts";

export type CreateOrganizationInput = {
  organizationId: string;
  storeId: string;
  actorId: string;
  auditId: string;
  correlationId: string;
  name: string;
  storeName: string;
  storeSlug: string;
};

const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID`);
}

function requireText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

export async function createOrganizationWithStore(
  pool: Pool,
  input: CreateOrganizationInput,
): Promise<void> {
  await createTenantTransaction(pool)(input.organizationId, client => createOrganizationInTransaction(client, input));
}

/** Internal registration composition; caller owns the tenant transaction. */
export async function createOrganizationInTransaction(client: PoolClient, input: CreateOrganizationInput): Promise<void> {
  requireUuid(input.organizationId, "organizationId");
  requireUuid(input.storeId, "storeId");
  requireUuid(input.actorId, "actorId");
  requireUuid(input.auditId, "auditId");
  requireUuid(input.correlationId, "correlationId");
  const name = requireText(input.name, "name", 200);
  const storeName = requireText(input.storeName, "storeName", 200);
  const storeSlug = requireText(input.storeSlug, "storeSlug", 200);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(storeSlug)) {
    throw new Error("storeSlug must be a lowercase slug");
  }

    await client.query(
      `INSERT INTO app.organization (id, name, status)
       VALUES ($1, $2, 'ACTIVE')`,
      [input.organizationId, name],
    );
    await client.query(
      `INSERT INTO app.store (id, organization_id, name, slug)
       VALUES ($1, $2, $3, $4)`,
      [input.storeId, input.organizationId, storeName, storeSlug],
    );
    await client.query(
      `INSERT INTO app.organization_membership (organization_id, actor_id, role, status)
       VALUES ($1, $2, 'OWNER', 'ACTIVE')`,
      [input.organizationId, input.actorId],
    );
    await client.query(
      `INSERT INTO app.audit_log
        (id, organization_id, actor_id, action, entity_id, reason, correlation_id)
       VALUES ($1, $2, $3, 'organization.created', $2, $4, $5)`,
      [input.auditId, input.organizationId, input.actorId, "Initial organization onboarding", input.correlationId],
    );
}
