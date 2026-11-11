-- Fixtures for the Phase 0 gate tests. Two practices so cross-tenant reads have
-- something real to leak; two disciplines and two authors inside practice 1 so
-- segregation and tier rules have something real to withhold.
-- Runs against a freshly migrated database (see run.sh); the ledger cannot be
-- truncated, by design, so fixtures are never reset in place.

INSERT INTO practice (name, dek_id) VALUES ('MD Fit', 'kms:dek:1'), ('Northside Behavioral', 'kms:dek:2');

INSERT INTO staff (practice_id, email, role, disciplines) VALUES
  (1, 'jared@mdfit.test',  'owner',     '{bodywork,fitness}'),   -- 1
  (1, 'pat@mdfit.test',    'clinician', '{behavioral}'),         -- 2
  (2, 'sam@northside.test','clinician', '{bodywork}');           -- 3

INSERT INTO client (practice_id, given_name, family_name) VALUES
  (1, 'Dana', 'Reyes'),      -- 1
  (2, 'Chris', 'Okafor');    -- 2

-- note 1: bodywork T1, author 1      → visible to bodywork, not behavioral
-- note 2: behavioral T2, author 1    → author only, even within behavioral
-- note 3: behavioral T1, author 1    → visible to any behavioral staff
-- note 4: bodywork T1, author 1, LOCKED
INSERT INTO note (practice_id, client_id, discipline, sensitivity_tier, author_id, body_ciphertext, dek_id, signed_at, locked_at) VALUES
  (1, 1, 'bodywork',   't1', 1, '\x01', 'kms:dek:1', NULL, NULL),
  (1, 1, 'behavioral', 't2', 1, '\x02', 'kms:dek:1', now(), NULL),
  (1, 1, 'behavioral', 't1', 1, '\x03', 'kms:dek:1', now(), NULL),
  (1, 1, 'bodywork',   't1', 1, '\x04', 'kms:dek:1', now(), now());

INSERT INTO encounter (practice_id, client_id, provider_id, discipline, starts_at, ends_at) VALUES
  (1, 1, 1, 'bodywork',   '2026-12-01T14:00:00Z', '2026-12-01T15:00:00Z'),
  (1, 1, 2, 'behavioral', '2026-12-02T14:00:00Z', '2026-12-02T15:00:00Z');

-- A short chain for each practice. In production the hash and signature are
-- computed and signed by the vault service with a KMS key; here they are fixed
-- bytes so the linkage rule itself is what gets tested.
INSERT INTO ledger_entry (practice_id, actor_id, actor_role, event, subject_type, subject_id, tier, prev_hash, hash, signature, key_id) VALUES
  (1, 1, 'owner', 'login',       'staff',  1, NULL, ledger_genesis(),               decode(repeat('11',32),'hex'), '\xaa', 'k1'),
  (1, 1, 'owner', 'chart.view',  'client', 1, 't1', decode(repeat('11',32),'hex'),  decode(repeat('22',32),'hex'), '\xaa', 'k1'),
  (1, 1, 'owner', 'note.create', 'note',   1, 't1', decode(repeat('22',32),'hex'),  decode(repeat('33',32),'hex'), '\xaa', 'k1'),
  (2, 3, 'clinician', 'login',   'staff',  3, NULL, ledger_genesis(),               decode(repeat('44',32),'hex'), '\xbb', 'k1');

INSERT INTO ledger_anchor (practice_id, seq, head_hash, signature, key_id, shipped_at, shipped_to)
  VALUES (1, 3, decode(repeat('33',32),'hex'), '\xaa', 'k1', now(), 's3://cohort-anchors/practice-1/');
