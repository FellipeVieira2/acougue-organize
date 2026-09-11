CREATE TABLE app.organization_membership (
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MANAGER','OPERATOR','VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, actor_id)
);

CREATE INDEX organization_membership_actor
  ON app.organization_membership (actor_id, status, organization_id);

ALTER TABLE app.organization_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_membership FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_isolation ON app.organization_membership
  TO acougue_runtime
  USING (organization_id = app.tenant_id())
  WITH CHECK (organization_id = app.tenant_id());

GRANT SELECT, INSERT, UPDATE ON app.organization_membership TO acougue_runtime;

INSERT INTO public.schema_migrations (name, checksum)
VALUES ('0003_organization_membership.sql', 'applied-through-neon-mcp')
ON CONFLICT (name) DO NOTHING;
