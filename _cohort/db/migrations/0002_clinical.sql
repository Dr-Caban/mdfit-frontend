-- 0002_clinical.sql — the clinical core, with A2 (discipline segregation) and
-- A4 (sensitivity tiers) enforced in RLS rather than in handlers.
--
-- The tier rule, stated once:
--   T0/T1  readable by any staff of the treating discipline
--   T2/T3  author only, always, regardless of role or max_tier
-- Owner/admin is deliberately NOT exempt. Spec A3 makes clinical-note access
-- "configurable, off by default" for owners; an owner who needs a T2 note uses
-- break-glass, which is a ledger event, not a silent policy exemption.

CREATE TABLE client (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id bigint      NOT NULL REFERENCES practice(id),
  given_name  text        NOT NULL,
  family_name text        NOT NULL,
  tz          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX client_practice_idx ON client (practice_id);

CREATE TABLE encounter (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id bigint      NOT NULL REFERENCES practice(id),
  client_id   bigint      NOT NULL REFERENCES client(id),
  provider_id bigint      NOT NULL REFERENCES staff(id),
  discipline  discipline  NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  resource_id bigint,                        -- room / table / equipment (P9)
  status      text        NOT NULL DEFAULT 'booked',
  CONSTRAINT encounter_time_sane CHECK (ends_at > starts_at)
);
CREATE INDEX encounter_practice_idx ON encounter (practice_id, starts_at);

-- P9: one bookable resource per tenant was the clockwork-hub defect. Uniqueness
-- keys on the resource, and the exclusion constraint covers overlapping RANGES,
-- not just equal start times — the read-then-write race that index could not close.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE encounter ADD CONSTRAINT encounter_no_double_book
  EXCLUDE USING gist (
    practice_id WITH =,
    provider_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('booked','completed'));

CREATE TABLE note (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id      bigint           NOT NULL REFERENCES practice(id),
  client_id        bigint           NOT NULL REFERENCES client(id),
  encounter_id     bigint           REFERENCES encounter(id),
  discipline       discipline       NOT NULL,
  sensitivity_tier sensitivity_tier NOT NULL DEFAULT 't1',
  author_id        bigint           NOT NULL REFERENCES staff(id),
  body_ciphertext  bytea            NOT NULL,
  dek_id           text             NOT NULL,   -- which key; enables rotation (V5)
  created_at       timestamptz      NOT NULL DEFAULT now(),
  signed_at        timestamptz,
  locked_at        timestamptz
);
CREATE INDEX note_client_idx ON note (practice_id, client_id, created_at DESC);

CREATE TABLE addendum (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id     bigint      NOT NULL REFERENCES practice(id),
  note_id         bigint      NOT NULL REFERENCES note(id),
  author_id       bigint      NOT NULL REFERENCES staff(id),
  body_ciphertext bytea       NOT NULL,
  dek_id          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- A5: a locked note is immutable. Changes go in an addendum, attributed and
-- timestamped. Enforced in the database so no handler can forget.
CREATE FUNCTION note_locked_is_immutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'note % is locked; add an addendum instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER note_immutable_after_lock
  BEFORE UPDATE OR DELETE ON note
  FOR EACH ROW EXECUTE FUNCTION note_locked_is_immutable();

-- Who wrote a note, about whom, in which practice, never changes — locked or
-- not. Otherwise a colleague who can see an unlocked T1 note could reassign it
-- to themselves and raise it to T2, hiding it from its real author.
CREATE FUNCTION note_identity_is_fixed() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.practice_id IS DISTINCT FROM OLD.practice_id
     OR NEW.client_id  IS DISTINCT FROM OLD.client_id
     OR NEW.author_id  IS DISTINCT FROM OLD.author_id
     OR NEW.discipline IS DISTINCT FROM OLD.discipline THEN
    RAISE EXCEPTION 'note %: practice, client, author and discipline cannot be changed', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER note_identity_fixed
  BEFORE UPDATE ON note
  FOR EACH ROW EXECUTE FUNCTION note_identity_is_fixed();

ALTER TABLE client    ENABLE ROW LEVEL SECURITY;  ALTER TABLE client    FORCE ROW LEVEL SECURITY;
ALTER TABLE encounter ENABLE ROW LEVEL SECURITY;  ALTER TABLE encounter FORCE ROW LEVEL SECURITY;
ALTER TABLE note      ENABLE ROW LEVEL SECURITY;  ALTER TABLE note      FORCE ROW LEVEL SECURITY;
ALTER TABLE addendum  ENABLE ROW LEVEL SECURITY;  ALTER TABLE addendum  FORCE ROW LEVEL SECURITY;

-- A client is T0 shared-core: visible to the whole practice, any discipline.
-- The policy is the security boundary (tenant) and nothing else. Soft-delete
-- visibility is deliberately NOT in it: Postgres checks an UPDATEd row against
-- the read policy as well, so "AND deleted_at IS NULL" here makes the soft
-- delete itself fail. Everyday reads go through client_active instead.
CREATE POLICY client_tenant ON client
  USING (practice_id = app_practice_id());

-- security_invoker: the view runs with the caller's rights, so RLS still applies.
CREATE VIEW client_active WITH (security_invoker = true) AS
  SELECT * FROM client WHERE deleted_at IS NULL;

CREATE POLICY encounter_tenant ON encounter
  USING (practice_id = app_practice_id()
         AND discipline = ANY (app_disciplines()));

-- A2 + A4 together.
CREATE POLICY note_discipline_and_tier ON note
  USING (
    practice_id = app_practice_id()
    AND discipline = ANY (app_disciplines())
    AND (
      sensitivity_tier <= 't1'::sensitivity_tier     -- T0/T1 to the treating discipline
      OR author_id = app_staff_id()                  -- T2/T3 author only
    )
  );

CREATE POLICY addendum_follows_note ON addendum
  USING (practice_id = app_practice_id()
         AND EXISTS (SELECT 1 FROM note n WHERE n.id = addendum.note_id));

GRANT SELECT, INSERT, UPDATE ON client, encounter, note TO cohort_app;
GRANT SELECT, INSERT ON addendum TO cohort_app;
GRANT SELECT ON client_active TO cohort_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cohort_app;
