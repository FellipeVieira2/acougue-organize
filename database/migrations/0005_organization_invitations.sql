CREATE TABLE app.organization_invitation (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  role text NOT NULL CHECK (role IN ('ADMIN','MANAGER','OPERATOR','VIEWER')),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX organization_invitation_tenant ON app.organization_invitation (organization_id, created_at DESC);
CREATE INDEX organization_invitation_pending ON app.organization_invitation (organization_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
ALTER TABLE app.organization_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization_invitation FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_invitation_isolation ON app.organization_invitation TO acougue_runtime USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE ON app.organization_invitation TO acougue_runtime;

