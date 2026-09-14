BEGIN;

CREATE TABLE app.preparation_option (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]+$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);

CREATE TABLE app.inventory_item (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 80),
  base_unit text NOT NULL CHECK (base_unit IN ('G','UNIT')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, sku)
);

CREATE TABLE app.catalog_offer (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  preparation_option_id uuid NOT NULL,
  sku text NOT NULL CHECK (length(sku) BETWEEN 1 AND 80),
  sale_unit text NOT NULL CHECK (sale_unit IN ('G','UNIT','FIXED_PACKAGE')),
  min_weight_g bigint CHECK (min_weight_g IS NULL OR min_weight_g > 0),
  max_weight_g bigint CHECK (max_weight_g IS NULL OR max_weight_g > 0),
  weight_step_g bigint CHECK (weight_step_g IS NULL OR weight_step_g > 0),
  default_weight_g bigint CHECK (default_weight_g IS NULL OR default_weight_g > 0),
  active boolean NOT NULL DEFAULT true,
  public_visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, sku),
  FOREIGN KEY (organization_id, product_id) REFERENCES app.product(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES app.inventory_item(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, preparation_option_id) REFERENCES app.preparation_option(organization_id, id) ON DELETE RESTRICT,
  CHECK (min_weight_g IS NULL OR max_weight_g IS NULL OR min_weight_g <= max_weight_g),
  CHECK (default_weight_g IS NULL OR (min_weight_g IS NULL OR default_weight_g >= min_weight_g)),
  CHECK (default_weight_g IS NULL OR (max_weight_g IS NULL OR default_weight_g <= max_weight_g))
);

CREATE TABLE app.inventory_balance (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  on_hand_qty bigint NOT NULL DEFAULT 0 CHECK (on_hand_qty >= 0),
  reserved_qty bigint NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, inventory_item_id),
  FOREIGN KEY (organization_id, store_id) REFERENCES app.store(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES app.inventory_item(organization_id, id) ON DELETE RESTRICT,
  CHECK (reserved_qty <= on_hand_qty)
);

CREATE TABLE app.inventory_movement (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('PURCHASE','SALE','ADJUSTMENT','LOSS','RETURN','TRANSFER_IN','TRANSFER_OUT','PRODUCTION_IN','PRODUCTION_OUT')),
  quantity_delta bigint NOT NULL CHECK (quantity_delta <> 0),
  reference_type text,
  reference_id uuid,
  reason text,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, store_id) REFERENCES app.store(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES app.inventory_item(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE app.inventory_reservation (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  reserved_qty bigint NOT NULL CHECK (reserved_qty > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','CONSUMED','RELEASED','EXPIRED')),
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  consumed_at timestamptz,
  FOREIGN KEY (organization_id, store_id) REFERENCES app.store(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES app.inventory_item(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX preparation_option_tenant ON app.preparation_option (organization_id, active, name);
CREATE INDEX inventory_item_tenant ON app.inventory_item (organization_id, active, name);
CREATE INDEX catalog_offer_public ON app.catalog_offer (organization_id, active, public_visible, created_at, id);
CREATE INDEX inventory_balance_tenant ON app.inventory_balance (organization_id, store_id, inventory_item_id);
CREATE INDEX inventory_movement_tenant ON app.inventory_movement (organization_id, store_id, inventory_item_id, created_at, id);
CREATE INDEX inventory_reservation_tenant ON app.inventory_reservation (organization_id, store_id, status, created_at, id);

ALTER TABLE app.preparation_option ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.preparation_option FORCE ROW LEVEL SECURITY;
CREATE POLICY preparation_option_isolation ON app.preparation_option TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.inventory_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_item FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_item_isolation ON app.inventory_item TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.catalog_offer ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.catalog_offer FORCE ROW LEVEL SECURITY;
CREATE POLICY catalog_offer_isolation ON app.catalog_offer TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.inventory_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_balance_isolation ON app.inventory_balance TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.inventory_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_movement FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_movement_isolation ON app.inventory_movement TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.inventory_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_reservation FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservation_isolation ON app.inventory_reservation TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

GRANT SELECT, INSERT, UPDATE ON app.preparation_option, app.inventory_item, app.catalog_offer TO acougue_runtime;
GRANT SELECT, INSERT, UPDATE ON app.inventory_balance TO acougue_runtime;
GRANT SELECT, INSERT ON app.inventory_movement, app.inventory_reservation TO acougue_runtime;

COMMIT;