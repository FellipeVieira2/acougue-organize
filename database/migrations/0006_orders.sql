BEGIN;

CREATE SEQUENCE app.sales_order_number_seq AS bigint START WITH 1000;

CREATE TABLE app.sales_order (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  public_number bigint NOT NULL DEFAULT nextval('app.sales_order_number_seq'),
  order_status text NOT NULL DEFAULT 'RECEIVED' CHECK (order_status IN ('RECEIVED','CONFIRMED','CANCELED','COMPLETED')),
  fulfillment_status text NOT NULL DEFAULT 'RECEIVED' CHECK (fulfillment_status IN ('RECEIVED','CONFIRMED','SEPARATING','WEIGHING','WAITING_CUSTOMER_APPROVAL','WEIGHT_ADJUSTED','READY','COMPLETED','CANCELED')),
  payment_status text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (payment_status IN ('NOT_REQUIRED','PENDING','AUTHORIZED','PARTIALLY_PAID','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
  fulfillment_type text NOT NULL CHECK (fulfillment_type IN ('PICKUP','DELIVERY')),
  customer_name text NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 200),
  customer_phone text NOT NULL CHECK (length(customer_phone) BETWEEN 1 AND 40),
  customer_note text,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  estimated_subtotal_minor bigint NOT NULL CHECK (estimated_subtotal_minor >= 0),
  final_subtotal_minor bigint CHECK (final_subtotal_minor IS NULL OR final_subtotal_minor >= 0),
  delivery_fee_minor bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  estimated_total_minor bigint NOT NULL CHECK (estimated_total_minor >= 0),
  final_total_minor bigint CHECK (final_total_minor IS NULL OR final_total_minor >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  canceled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, store_id, public_number),
  FOREIGN KEY (organization_id, store_id) REFERENCES app.store(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE app.order_item (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  product_name_snapshot text NOT NULL,
  offer_name_snapshot text NOT NULL,
  preparation_name_snapshot text NOT NULL,
  sku_snapshot text NOT NULL,
  pricing_type_snapshot text NOT NULL CHECK (pricing_type_snapshot IN ('PER_KG','PER_UNIT','FIXED_PACKAGE')),
  unit_price_minor_snapshot bigint NOT NULL CHECK (unit_price_minor_snapshot >= 0),
  requested_qty bigint NOT NULL CHECK (requested_qty > 0),
  reserved_qty bigint NOT NULL CHECK (reserved_qty > 0),
  final_qty bigint CHECK (final_qty IS NULL OR final_qty > 0),
  min_acceptable_qty bigint CHECK (min_acceptable_qty IS NULL OR min_acceptable_qty > 0),
  max_acceptable_qty bigint CHECK (max_acceptable_qty IS NULL OR max_acceptable_qty > 0),
  max_total_minor bigint CHECK (max_total_minor IS NULL OR max_total_minor >= 0),
  estimated_total_minor bigint NOT NULL CHECK (estimated_total_minor >= 0),
  final_total_minor bigint CHECK (final_total_minor IS NULL OR final_total_minor >= 0),
  customer_note text,
  operator_note text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SEPARATING','WEIGHING','WAITING_CUSTOMER_APPROVAL','RESOLVED','CANCELED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, order_id) REFERENCES app.sales_order(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, offer_id) REFERENCES app.catalog_offer(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, inventory_item_id) REFERENCES app.inventory_item(organization_id, id) ON DELETE RESTRICT,
  CHECK (min_acceptable_qty IS NULL OR max_acceptable_qty IS NULL OR min_acceptable_qty <= max_acceptable_qty)
);

ALTER TABLE app.inventory_reservation ADD COLUMN order_id uuid;
ALTER TABLE app.inventory_reservation ADD COLUMN order_item_id uuid;
ALTER TABLE app.inventory_reservation ADD COLUMN consumed_qty bigint NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0);
ALTER TABLE app.inventory_reservation ADD COLUMN released_qty bigint NOT NULL DEFAULT 0 CHECK (released_qty >= 0);
ALTER TABLE app.inventory_reservation ADD CONSTRAINT reservation_quantities_sum_ck
  CHECK (consumed_qty + released_qty <= reserved_qty);
ALTER TABLE app.inventory_reservation ADD CONSTRAINT reservation_order_fk
  FOREIGN KEY (organization_id, order_id) REFERENCES app.sales_order(organization_id, id) ON DELETE RESTRICT;
ALTER TABLE app.inventory_reservation ADD CONSTRAINT reservation_order_item_fk
  FOREIGN KEY (organization_id, order_item_id) REFERENCES app.order_item(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE app.order_event (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES app.organization(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, order_id) REFERENCES app.sales_order(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX sales_order_queue ON app.sales_order (organization_id, store_id, fulfillment_status, created_at, id);
CREATE INDEX order_item_order ON app.order_item (organization_id, order_id, created_at, id);
CREATE INDEX order_event_order ON app.order_event (organization_id, order_id, created_at, id);

ALTER TABLE app.sales_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_order FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_order_isolation ON app.sales_order TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.order_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_item FORCE ROW LEVEL SECURITY;
CREATE POLICY order_item_isolation ON app.order_item TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

ALTER TABLE app.order_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.order_event FORCE ROW LEVEL SECURITY;
CREATE POLICY order_event_isolation ON app.order_event TO acougue_runtime
  USING (organization_id = app.tenant_id()) WITH CHECK (organization_id = app.tenant_id());

GRANT SELECT, INSERT, UPDATE ON app.sales_order, app.order_item TO acougue_runtime;
GRANT SELECT, INSERT ON app.order_event TO acougue_runtime;
GRANT UPDATE ON app.inventory_reservation TO acougue_runtime;
GRANT USAGE, SELECT ON SEQUENCE app.sales_order_number_seq TO acougue_runtime;

COMMIT;