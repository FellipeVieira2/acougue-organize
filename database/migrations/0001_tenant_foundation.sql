BEGIN;

CREATE ROLE acougue_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO acougue_runtime;

CREATE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid $$;

CREATE TABLE app.organization (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED','CANCELED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.store (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, id)
);

CREATE TABLE app.product (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 80),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  stock_unit text NOT NULL CHECK (stock_unit IN ('G','UNIT')),
  sale_strategy text NOT NULL CHECK (sale_strategy IN ('WEIGHT_FREE','WEIGHT_INCREMENT','FIXED_PACKAGE','APPROXIMATE_UNIT','MINIMUM_WEIGHT','UNIT')),
  active boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,sku),
  CHECK ((stock_unit = 'UNIT' AND sale_strategy = 'UNIT') OR (stock_unit = 'G' AND sale_strategy <> 'UNIT'))
);

CREATE TABLE app.product_price (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  product_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('POS','STOREFRONT','MANUAL','IFOOD','B2B')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,store_id) REFERENCES app.store(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,product_id) REFERENCES app.product(organization_id,id) ON DELETE RESTRICT,
  UNIQUE (organization_id,store_id,product_id,channel,revision)
);

CREATE TABLE app.audit_log (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_id uuid NOT NULL,
  reason text,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX store_tenant ON app.store (organization_id,created_at,id);
CREATE INDEX product_tenant ON app.product (organization_id,active,created_at,id);
CREATE INDEX product_price_product ON app.product_price (organization_id,product_id);
CREATE INDEX audit_log_tenant ON app.audit_log (organization_id,created_at,id);

ALTER TABLE app.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.organization FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON app.organization
  TO acougue_runtime USING (id = app.tenant_id()) WITH CHECK (id = app.tenant_id());

ALTER TABLE app.store ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.store FORCE ROW LEVEL SECURITY;
CREATE POLICY store_isolation ON app.store
  TO acougue_runtime USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product FORCE ROW LEVEL SECURITY;
CREATE POLICY product_isolation ON app.product
  TO acougue_runtime USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.product_price ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.product_price FORCE ROW LEVEL SECURITY;
CREATE POLICY price_isolation ON app.product_price
  TO acougue_runtime USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_isolation ON app.audit_log
  TO acougue_runtime USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

GRANT SELECT, INSERT, UPDATE ON app.organization, app.store, app.product TO acougue_runtime;
GRANT SELECT, INSERT ON app.product_price, app.audit_log TO acougue_runtime;
REVOKE ALL ON FUNCTION app.tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.tenant_id() TO acougue_runtime;

COMMIT;
