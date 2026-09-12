CREATE SCHEMA identity;
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
GRANT USAGE ON SCHEMA identity TO acougue_runtime;

-- Server-only identity data. Browser clients never receive database credentials.
CREATE TABLE identity.account (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL,
  organization_id uuid NOT NULL REFERENCES app.organization(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity.session (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  actor_id uuid NOT NULL REFERENCES identity.account(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_expiry ON identity.session(expires_at);
CREATE TABLE identity.login_limit (
  key_hash text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0)
);
GRANT SELECT, INSERT ON identity.account TO acougue_runtime;
GRANT SELECT, INSERT, DELETE ON identity.session TO acougue_runtime;
GRANT SELECT, INSERT, UPDATE ON identity.login_limit TO acougue_runtime;
