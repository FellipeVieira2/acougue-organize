BEGIN;

CREATE TABLE app.rate_limit_bucket (
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE CASCADE,
  store_id uuid NOT NULL,
  namespace text NOT NULL CHECK (length(namespace) BETWEEN 1 AND 100),
  subject_hash text NOT NULL CHECK (length(subject_hash) = 64),
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL CHECK (count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, store_id, namespace, subject_hash, window_started_at),
  FOREIGN KEY (organization_id, store_id) REFERENCES app.store(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX rate_limit_bucket_expiration ON app.rate_limit_bucket (expires_at);
ALTER TABLE app.rate_limit_bucket ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rate_limit_bucket FORCE ROW LEVEL SECURITY;
CREATE POLICY rate_limit_bucket_isolation ON app.rate_limit_bucket TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.rate_limit_bucket TO acougue_runtime;

COMMIT;