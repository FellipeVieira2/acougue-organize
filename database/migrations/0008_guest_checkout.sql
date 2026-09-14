BEGIN;

ALTER TABLE app.sales_order ADD COLUMN public_access_token_hash text UNIQUE;

CREATE TABLE app.idempotency_record (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 100),
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  order_id uuid,
  public_number bigint,
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key, operation),
  FOREIGN KEY (organization_id, order_id) REFERENCES app.sales_order(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX idempotency_expiry ON app.idempotency_record (created_at);

ALTER TABLE app.idempotency_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.idempotency_record FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_isolation ON app.idempotency_record TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

GRANT SELECT, INSERT, UPDATE ON app.idempotency_record TO acougue_runtime;

COMMIT;