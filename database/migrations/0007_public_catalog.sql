BEGIN;

CREATE FUNCTION app.public_store_by_slug(input_slug text)
RETURNS TABLE (store_id uuid, organization_id uuid, store_name text, store_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT s.id, s.organization_id, s.name, s.slug
  FROM app.store s
  JOIN app.organization o ON o.id = s.organization_id
  WHERE s.slug = input_slug AND s.active = true AND o.status = 'ACTIVE'
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION app.public_store_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.public_store_by_slug(text) TO acougue_runtime;

COMMIT;