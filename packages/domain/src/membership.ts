import type { Pool, PoolClient } from "pg";
import { createTenantTransaction } from "./database.ts";

export const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export const MEMBERSHIP_STATUSES = ["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

const ROLE_LEVEL: Record<MembershipRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  MANAGER: 30,
  OPERATOR: 20,
  VIEWER: 10,
};
const UUID_PATTERN = /^[0-9a-f-]{36}$/i;

export type Membership = {
  organizationId: string;
  actorId: string;
  role: MembershipRole;
  status: MembershipStatus;
};

export function canPerform(role: MembershipRole, requiredRole: MembershipRole): boolean {
  return MEMBERSHIP_ROLES.includes(role) && MEMBERSHIP_ROLES.includes(requiredRole)
    && ROLE_LEVEL[role] >= ROLE_LEVEL[requiredRole];
}

export function requirePermission(membership: Membership | null, requiredRole: MembershipRole): Membership {
  if (!membership || membership.status !== "ACTIVE" || !canPerform(membership.role, requiredRole)) {
    throw new Error("FORBIDDEN");
  }
  return membership;
}

function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID`);
}

export async function getMembership(
  pool: Pool,
  organizationId: string,
  actorId: string,
): Promise<Membership | null> {
  requireUuid(organizationId, "organizationId");
  requireUuid(actorId, "actorId");
  const transaction = createTenantTransaction(pool);
  return transaction(organizationId, async (client) => {
    const result = await client.query<Membership>(
      `SELECT organization_id AS "organizationId", actor_id AS "actorId", role, status
       FROM app.organization_membership
       WHERE organization_id = $1 AND actor_id = $2`,
      [organizationId, actorId],
    );
    return result.rows[0] ?? null;
  });
}

export async function addMembership(
  pool: Pool,
  requestingActorId: string,
  membership: Membership,
  auditId: string,
  correlationId: string,
): Promise<void> {
  requireUuid(membership.organizationId, "organizationId");
  requireUuid(membership.actorId, "actorId");
  requireUuid(auditId, "auditId");
  requireUuid(correlationId, "correlationId");
  if (!MEMBERSHIP_ROLES.includes(membership.role) || !MEMBERSHIP_STATUSES.includes(membership.status)) throw new Error("Invalid membership");
  await withMembershipTransaction(pool, membership.organizationId, requestingActorId, "ADMIN", async (client, requester) => {
    if (requester.role !== "OWNER" && ROLE_LEVEL[membership.role] >= ROLE_LEVEL[requester.role]) throw new Error("FORBIDDEN");
    await client.query(
      `INSERT INTO app.organization_membership (organization_id, actor_id, role, status)
       VALUES ($1, $2, $3, $4)`,
      [membership.organizationId, membership.actorId, membership.role, membership.status],
    );
    await client.query(
      `INSERT INTO app.audit_log
        (id, organization_id, actor_id, action, entity_id, reason, correlation_id)
       VALUES ($1, $2, $3, 'membership.created', $4, $5, $6)`,
      [auditId, membership.organizationId, requestingActorId, membership.actorId, `Role ${membership.role}`, correlationId],
    );
  });
}

/** actorId must come from verified server authentication, never request-body identity. */
export async function withMembershipTransaction<T>(
  pool: Pool,
  organizationId: string,
  actorId: string,
  requiredRole: MembershipRole,
  operation: (client: PoolClient, membership: Membership) => Promise<T>,
): Promise<T> {
  requireUuid(actorId, "actorId");
  return createTenantTransaction(pool)(organizationId, async client => {
    const result = await client.query<Membership>(
      `SELECT organization_id AS "organizationId", actor_id AS "actorId", role, status
       FROM app.organization_membership WHERE organization_id = $1 AND actor_id = $2 FOR SHARE`,
      [organizationId, actorId],
    );
    const membership = requirePermission(result.rows[0] ?? null, requiredRole);
    return operation(client, membership);
  });
}
