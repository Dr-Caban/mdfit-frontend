-- 0001_foundation.sql — tenancy, roles, and the session context RLS keys on.
--
-- Design note that governs every later migration:
--   RLS is BYPASSED by the table owner unless FORCE ROW LEVEL SECURITY is set,
--   and is bypassed unconditionally by superusers. So the application connects
--   as cohort_app, which owns nothing and is not superuser, AND every PHI table
--   additionally sets FORCE. Belt and braces, because the cost of being wrong
--   here is a cross-tenant PHI read.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- The application role. NOLOGIN here; the deploy grants LOGIN + a password.
-- It is deliberately not the owner of any table.
DO $$ BEGIN
  CREATE ROLE cohort_app NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE staff_role       AS ENUM ('owner','clinician','supervisor','manager','frontdesk','assistant');
CREATE TYPE discipline       AS ENUM ('behavioral','medical','nutrition','fitness','bodywork');
CREATE TYPE sensitivity_tier AS ENUM ('t0','t1','t2','t3');

-- ── Session context ──────────────────────────────────────────────────────────
-- Set per connection/transaction by the data access layer, never by handlers.
-- Every accessor returns NULL when unset, so policies evaluate to NULL -> deny.
-- Fail-closed is the whole point: an unset context must read as "no access",
-- never as "all access".

CREATE FUNCTION app_practice_id() RETURNS bigint
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('cohort.practice_id', true), '')::bigint
$$;

CREATE FUNCTION app_staff_id() RETURNS bigint
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('cohort.staff_id', true), '')::bigint
$$;

CREATE FUNCTION app_disciplines() RETURNS discipline[]
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('cohort.disciplines', true), '')::discipline[],
      '{}'::discipline[])
$$;

-- Tiers this session may read. T2/T3 are never granted blanket; they are
-- author-only and reached through an explicit grant (see 0002 note policy).
CREATE FUNCTION app_max_tier() RETURNS sensitivity_tier
  LANGUAGE sql STABLE AS $$
    SELECT coalesce(
      nullif(current_setting('cohort.max_tier', true), '')::sensitivity_tier,
      't0'::sensitivity_tier)
$$;

-- ── Tenants ──────────────────────────────────────────────────────────────────

CREATE TABLE practice (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text        NOT NULL,
  tz            text        NOT NULL DEFAULT 'America/New_York',
  dek_id        text        NOT NULL,      -- KMS-wrapped data key id for this tenant
  created_at    timestamptz NOT NULL DEFAULT now(),
  offboarded_at timestamptz
);

CREATE TABLE staff (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id    bigint       NOT NULL REFERENCES practice(id),
  email          text         NOT NULL,
  role           staff_role   NOT NULL,
  disciplines    discipline[] NOT NULL DEFAULT '{}',
  mfa_enrolled   boolean      NOT NULL DEFAULT false,
  created_at     timestamptz  NOT NULL DEFAULT now(),
  deactivated_at timestamptz
);
CREATE UNIQUE INDEX staff_email_key ON staff (lower(email));
CREATE INDEX staff_practice_idx ON staff (practice_id);

ALTER TABLE practice ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice FORCE  ROW LEVEL SECURITY;
ALTER TABLE staff    ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff    FORCE  ROW LEVEL SECURITY;

CREATE POLICY practice_tenant ON practice
  USING (id = app_practice_id());

CREATE POLICY staff_tenant ON staff
  USING (practice_id = app_practice_id());

GRANT SELECT, INSERT, UPDATE ON practice, staff TO cohort_app;
GRANT USAGE ON SCHEMA public TO cohort_app;
