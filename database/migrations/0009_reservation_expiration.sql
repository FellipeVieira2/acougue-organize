BEGIN;

ALTER TABLE app.audit_log ALTER COLUMN actor_id DROP NOT NULL;
ALTER TABLE app.audit_log ADD COLUMN actor_type text NOT NULL DEFAULT 'USER' CHECK (actor_type IN ('USER','SYSTEM'));
CREATE INDEX inventory_reservation_expiration ON app.inventory_reservation (organization_id, expires_at, order_id) WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

CREATE FUNCTION app.expirable_organization_ids() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_catalog
AS $$
  SELECT o.id
  FROM app.organization o
  WHERE o.status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM app.inventory_reservation r WHERE r.organization_id = o.id AND r.status = 'ACTIVE' AND r.expires_at IS NOT NULL AND r.expires_at <= now());
$$;
REVOKE ALL ON FUNCTION app.expirable_organization_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expirable_organization_ids() TO acougue_runtime;
GRANT UPDATE ON app.audit_log TO acougue_runtime;

COMMIT;