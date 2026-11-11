-- 0003_ledger.sql — the Vault's append-only, hash-chained, signed audit ledger.
--
-- This is the Omniverse Conscience Ledger design, wired and closed. The four
-- defects it fixes, in order of how badly they mattered:
--
--   V2  Chain order is a database-assigned monotonic seq, never a timestamp.
--       (omniverse ordered by a timestamp TEXT column, so clock skew forked it)
--   V3  prev_hash linkage is enforced at INSERT, and the head is anchored
--       off-box. (omniverse created a chain_state table and never used it, so
--       truncating the tail was undetectable — the attack that actually matters
--       for an audit log: "delete the last 50 chart views")
--   V4  Append-only, enforced. An outcome is a NEW entry referencing the prior
--       seq. No UPDATE path exists. (omniverse's record_impact was a bare UPDATE
--       on a column that sat outside the hash preimage)
--   V1  Every row carries an Ed25519 signature over the canonical payload,
--       produced server-side with a KMS key. (omniverse had no signing code at
--       all, though its own .proto declared `bytes signature = 8`)

CREATE TABLE ledger_entry (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id  bigint      NOT NULL REFERENCES practice(id),

  -- who
  actor_id     bigint      REFERENCES staff(id),     -- NULL only for system events
  actor_role   staff_role,
  source_ip    inet,

  -- what (V8: clinical vocabulary, not AI-decision vocabulary)
  event        text        NOT NULL,
  subject_type text        NOT NULL,
  subject_id   bigint,
  tier         sensitivity_tier,
  outcome      text        NOT NULL DEFAULT 'ok',    -- ok | denied | error
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- chain
  prev_hash    bytea       NOT NULL,
  hash         bytea       NOT NULL,
  signature    bytea       NOT NULL,
  key_id       text        NOT NULL,                 -- KMS key version, for rotation
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_hash_len      CHECK (octet_length(hash) = 32),
  CONSTRAINT ledger_prev_hash_len CHECK (octet_length(prev_hash) = 32),
  CONSTRAINT ledger_outcome_known CHECK (outcome IN ('ok','denied','error'))
);
CREATE INDEX ledger_practice_seq_idx ON ledger_entry (practice_id, seq DESC);
CREATE INDEX ledger_subject_idx      ON ledger_entry (practice_id, subject_type, subject_id);
CREATE UNIQUE INDEX ledger_hash_uniq ON ledger_entry (hash);

-- No forks. The linkage trigger below reads the current head, but two concurrent
-- transactions can both read the same head before either commits. This index
-- makes that race lose: only one row per practice may ever name a given
-- prev_hash, so the second writer blocks, then fails, and must retry on the new head.
CREATE UNIQUE INDEX ledger_no_fork ON ledger_entry (practice_id, prev_hash);

-- The per-practice genesis sentinel: 32 zero bytes.
CREATE FUNCTION ledger_genesis() RETURNS bytea
  LANGUAGE sql IMMUTABLE AS $$ SELECT '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea $$;

-- V3: linkage enforced at insert. SECURITY DEFINER so the lookup sees the whole
-- chain for this practice regardless of the caller's RLS context — otherwise a
-- session could be tricked into chaining off a row it cannot see.
CREATE FUNCTION ledger_enforce_chain() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  head bytea;
BEGIN
  SELECT hash INTO head
    FROM ledger_entry
   WHERE practice_id = NEW.practice_id
   ORDER BY seq DESC
   LIMIT 1;

  head := coalesce(head, ledger_genesis());

  IF NEW.prev_hash IS DISTINCT FROM head THEN
    RAISE EXCEPTION
      'ledger chain break for practice %: prev_hash does not match current head',
      NEW.practice_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER ledger_chain_check
  BEFORE INSERT ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_enforce_chain();

-- V4: append-only. The GRANT below withholds UPDATE/DELETE from the app role;
-- this trigger additionally stops the table OWNER and anything else that
-- acquires rights later. Only a superuser disabling the trigger gets past both,
-- and that is itself a detectable event.
CREATE FUNCTION ledger_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entry is append-only (attempted %)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_no_truncate
  BEFORE TRUNCATE ON ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();

-- V3: the off-box anchor. A signed head shipped daily to storage the practice
-- cannot retroactively edit. Without this, truncating the tail is invisible:
-- the chain simply resumes from the new last row and verifies clean.
CREATE TABLE ledger_anchor (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  practice_id bigint      NOT NULL REFERENCES practice(id),
  seq         bigint      NOT NULL,
  head_hash   bytea       NOT NULL,
  signature   bytea       NOT NULL,
  key_id      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  shipped_at  timestamptz,
  shipped_to  text
);
CREATE INDEX ledger_anchor_practice_idx ON ledger_anchor (practice_id, seq DESC);

ALTER TABLE ledger_entry  ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_entry  FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_anchor ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_anchor FORCE ROW LEVEL SECURITY;

CREATE POLICY ledger_tenant ON ledger_entry
  USING (practice_id = app_practice_id());

CREATE POLICY ledger_anchor_tenant ON ledger_anchor
  USING (practice_id = app_practice_id());

-- Note what is NOT granted: no UPDATE, no DELETE, no TRUNCATE.
GRANT SELECT, INSERT ON ledger_entry, ledger_anchor TO cohort_app;
