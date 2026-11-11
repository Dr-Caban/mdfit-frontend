# EMR — Structure, Implementation, Orchestration, Checkpoints

**Draft 1 · Nov 11, 2026** · companion to `universal-emr-spec.md` (feature spec) and `SYSTEM-AND-IDEAL-APP.md` (current system)

This document covers *how* to build what the feature spec describes: the subsystem structure, the
implementation requirements for each, the order of work, and the checkpoints that prove the duties are met.

> **Not legal advice.** The compliance mapping in Part 4 is an engineering checklist, not a HIPAA
> assessment. A qualified assessor and counsel must review before the first patient record is stored.

---

## PART 0 — THE TWO PRODUCTS

Keeping these separate is the first architectural decision; conflating them is the main risk.

| | **MD Fit Console** | **EMR Platform** |
|---|---|---|
| Who | One practice (MD Fit) | Many practices |
| Where | `mymdfit.com/console` | Its own domain + per-tenant subdomains |
| Origin | Shares the marketing origin | **Isolated origin.** Separate cookies, CSP, hosting |
| Hosting | Vercel static + Railway API | BAA-covered cloud (AWS/GCP) |
| Role | First tenant. Dogfood surface | The product |

**Governing rule: single tenant in production, multi-tenant in the schema, from the first migration.**
MD Fit runs as `practice_id = 1` on the real foundation — **customer #1, not a special case.**
Retrofitting tenancy is what kills these projects — `clockwork-hub` is the evidence: ownership
re-derived ad hoc at ~30 call sites, with no seam left to add tenancy or audit to.

### 0.1 This is a commercial product — and that flips the regulatory posture

Selling this to private practices makes **the platform a Business Associate** of every customer.
MD Fit alone is a Covered Entity; a multi-tenant EMR vendor is a BA with direct liability under the
HITECH amendments. This is the most consequential difference between the two products and it is not a
paperwork detail — it changes who is on the hook, to whom, and on what clock.

| Obligation | What it means here |
|---|---|
| **BAA with every customer practice** | The platform signs *as the BA*. A customer-facing BAA template is a launch blocker, not a nice-to-have. Separate from the vendor BAAs in §2.5, which run the other direction |
| **Direct HHS liability** | A BA is enforceable against directly. The Security Rule applies to the platform in its own right |
| **Breach notification** | Discovery → notify affected practices **without unreasonable delay, ≤60 days**. Requires an incident procedure and a customer-contact path that exists before launch |
| **Subprocessor transparency** | Publish the vendor list from §2.5. Customers' own compliance reviews will ask, and changes need notice |
| **Minimum necessary** | Platform staff access to customer PHI is the support-grant path in A1: time-limited, practice-approved, logged |
| **Insurance** | Cyber liability + tech E&O sized to the aggregate PHI held. A single-practice policy does not cover this |
| **SOC 2 Type II** | Not required by HIPAA; commercially gating. Practices and their counsel will ask by the second or third customer |
| **Onboarding / offboarding** | Per-practice export and full delete (A1) are contractual commitments, not features |
| **Two money flows** | Platform subscription revenue (you are the merchant) **and** patients paying practices (Stripe Connect, each practice its own merchant). Don't conflate them |

### 0.2 Repository and IP

This plan currently lives in `mdfit-frontend/docs/` for delivery convenience only — the session can
surface files from that directory. **It belongs in its own repository**, as does the product. Two
hygiene items before any inherited code ships commercially:

- **Licence cleanliness.** `omniverse-core`'s `LICENSE` names "Omniverse Foundation", an entity with no
  evidence of existence, while the author is an individual — get a written licence or assignment from
  the actual owner. Its history also carries ~764 MB of committed build artifacts including
  **MPL-2.0-derived sources** (`cssparser`, `html5ever`, `markup5ever`, `selectors`) with no NOTICE
  files. Start the product repo fresh; copy only reviewed source; generate a third-party notices file
  from a committed lockfile.
- **Ownership.** Decide the holding entity before the first customer contract.

---

## PART 1 — STRUCTURE

### 1.1 Subsystem map

```
┌──────────────────────────────────────────────────────────────────┐
│ CLIENT  — installable PWA (desktop + mobile), one codebase       │
│   shell cached · PHI never cached · 15-min idle logoff           │
│   T2/T3 client-side crypto (non-extractable WebCrypto keys)      │
└───────────────────────────────┬──────────────────────────────────┘
                                │ TLS
┌───────────────────────────────▼──────────────────────────────────┐
│ PLATFORM  (Clockwork-derived)                                     │
│   API · realtime · Stripe Connect · scheduling · storage quota    │
│   sessions (revocable, server-side) · RBAC · rate limiting        │
└───────────────┬──────────────────────────────┬───────────────────┘
                │                              │
┌───────────────▼──────────────┐  ┌────────────▼──────────────────┐
│ DATA ACCESS LAYER (mandatory)│  │ VAULT  (Omniverse-derived)     │
│  the ONLY path to PHI        │─▶│  append-only signed ledger     │
│  enforces tenant/disc/tier   │  │  envelope encryption + KMS     │
│  emits a vault entry per op  │  │  head anchor shipped off-box   │
└───────────────┬──────────────┘  └───────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────────┐
│ POSTGRES — RLS on practice_id, discipline, sensitivity_tier       │
└──────────────────────────────────────────────────────────────────┘
```

The **data access layer is the load-bearing invention.** It exists so that "every PHI read is audited"
is a structural property, not a convention. No query path to PHI may bypass it. This is the single thing
`clockwork-hub` lacks and the reason its audit gap is a re-architecture rather than a middleware addition.

### 1.2 What each inherited subsystem contributes

**VAULT — from `omniverse-core`.** Adopt the *design*, write the implementation. The design is good:
an `Intent → Action → Impact` tuple, hash-chained, signed, in an encrypted store. The shipped code is
not wired (`log_intent` has no caller outside one test; `SecureStorage` is constructed and never
written to; the desktop app declares the core crate and never references it). Part 2.1 specifies the
real thing. Notably, `CONSCIENCE_PROTOBUF_1_0.proto:38` already declares `bytes signature = 8` — the
schema was right and the Rust omitted it. We implement the schema.

**PLATFORM — from `clockwork-hub`.** Adopt specific proven files and the Connect model; rewrite auth,
encryption and the datastore.

| Take | From | Note |
|---|---|---|
| `services/barberSchedule.js` | whole file | Pure, DST-correct both directions. Needs a provider/resource dimension (§2.2 P9) |
| Stripe Connect destination charges | `BarberController` | Each practice is its own merchant — now *correct* for multi-tenant |
| Fee split frozen onto the record | `BarberController.js:450` | A rate change must not rewrite history |
| Snapshot-service-onto-booking | `models/Booking.js:9-13` | A price change must not rewrite what a patient agreed to pay |
| `TokenLedger` shape | `models/TokenLedger.js` | `balanceAfter` + reason enum + unique index as payment idempotency → session packages |
| Webhook-only payment state | `fulfillPayment`, `fulfillTicket` | Copy the discipline and the comments |
| Partial unique indexes | `models/Ticket.js:50-57` | Read the reasoning before writing your own |
| `services/storage.js` | minus token coupling | Derived-never-cached quota; 402 names the shortfall |
| `services/healthChecks.js` | vocabulary + rule | `up/down/degraded/off`, alert only on transition into `down` |
| `retrieval.js:17-29` `getJson()` | 12-line pattern | The template every outbound call must use |
| `studyGrader.js` posture | pattern | Real abort, `temperature: 0`, fails closed to nothing, can only improve never revoke |
| Tenant-from-token | `barberAuth` pattern | Derive scope from the verified session, never from the request |

**CLINICAL CORE — from MD Fit.** Existing prior art to migrate, not reinvent:
`/api/admin/emr/*` already implements chart + patient-readable notes + prescribed movements linked to
library video + paid-visit scheduling + an 11-kind record timeline. That is most of module C5 and a
chunk of C4. The 5-document encrypted intake packet (`lib/intake.js`) maps to B6. The existing
hash-chained Ed25519 audit ledger with a nightly anchor email is the only working audit trail in any
repo reviewed and is the direct ancestor of the Vault.

### 1.3 Data model skeleton

Every PHI table carries all three discriminators. RLS policies key on them; the app never filters alone.

```sql
practice      (id, name, tz, settings, encryption_context_id)
staff         (id, practice_id, email, role, disciplines[], mfa_enrolled)
client        (id, practice_id, ...demographics, tz, client_type)
consent       (id, practice_id, client_id, grantee_staff_id|care_team,
               scope, tiers[], granted_at, expires_at, revoked_at)
encounter     (id, practice_id, client_id, provider_id, discipline,
               starts_at, ends_at, location_id, resource_id, status)
note          (id, practice_id, client_id, encounter_id, discipline,
               sensitivity_tier, author_id, body_ciphertext, dek_id,
               signed_at, locked_at)          -- addenda only after lock
addendum      (id, practice_id, note_id, author_id, body_ciphertext, created_at)
observation   (id, practice_id, client_id, discipline, code, value,
               unit, measured_at)              -- measures, ROM, vitals
care_plan     (id, practice_id, client_id, discipline, goals[], measures[],
               review_due_at)
ledger_entry  (seq BIGSERIAL, practice_id, actor_id, actor_role, event,
               subject_type, subject_id, tier, source_ip, outcome,
               prev_hash, hash, signature, created_at)
ledger_anchor (practice_id, seq, head_hash, signature, shipped_at)
```

FHIR alignment per spec Part G: `client`→Patient, `encounter`→Encounter, `observation`→Observation,
`care_plan`→CarePlan, `consent`→Consent, `ledger_entry`→Provenance/AuditEvent.

### 1.4 The landing-page button — as specified

Because the EMR is a separate product on its own domain, the button is an **outbound link**, not a
route on mymdfit.com. That is both architecturally correct (origin isolation) and, usefully, it
dissolves the SEO objection entirely:

- `scripts/seo/check.js:47` only validates internal `href="/..."` targets, so an absolute external
  URL passes untouched — **no `console.html` needed, nothing added to the internal link graph**, no
  inbound-link invariant to special-case, no `sitemap.xml` or `robots.txt` change.
- Markup: `rel="noopener nofollow"`, `target="_blank"`.
- Label it for the audience, not the asset: **"Staff sign-in"**. **Do not put the word EMR in any
  public route, label, or page title** — it advertises where the PHI is.
- Placement: **footer**. The landing page's job is patient conversion, and the header already carries
  "Open the app" plus the booking CTA; a third button there competes with both.
- After any CSS/JS edit: `node scripts/version-assets.js`, then `node scripts/seo/check.js`.

**Interim vs target.** Until the product replaces it, MD Fit staff still use the existing
`/admin` (the "Medical record" tab). Two options:

| | Target | Href | Notes |
|---|---|---|---|
| **Interim** | existing admin | `/admin` | Internal, so `admin.html` must stay `noindex` (it is, `admin.html:7`) and `robots.txt` already disallows `/admin`. Add `rel="nofollow"` |
| **Target** | product login | `https://app.<product>.com` | External. MD Fit signs in as customer #1; later a tenant subdomain |

Recommendation: ship the interim link now pointing at `/admin`, and change one `href` when the
product goes live. Avoids creating a `/console` page that exists only to be replaced.

---

## PART 2 — IMPLEMENTATION

Each requirement is written as a defect-closing obligation, with the inherited behaviour it replaces.

### 2.1 Vault requirements

| # | Requirement | Replaces |
|---|---|---|
| **V1** | **Every entry is signed.** Ed25519 over the canonical serialization. Signing key lives in KMS, server-side — *never* user-held. | No signing code exists anywhere in `omniverse-core` (zero hits for `SigningKey`/`.sign(`), though the proto declares the field |
| **V2** | **Monotonic `seq`**, database-assigned. Chain order is by `seq`, never by timestamp. | `conscience_ledger.rs:144,259` orders by a timestamp text column — clock skew forks the chain |
| **V3** | **Head anchor.** Persist `{seq, head_hash, signature}` and ship a signed digest **off-box** daily to storage the practice cannot retroactively edit. | `chain_state` table is created at `:135` and never read or written — tail truncation is undetectable |
| **V4** | **Append-only, no exceptions.** An outcome is a *new* entry referencing the prior `seq`. No `UPDATE` on any ledger row. Everything in the row is inside the hash preimage. | `record_impact` at `:198` is a bare `UPDATE`; `impact_json` and `ethics_score` sit outside the preimage and are editable forever |
| **V5** | **Envelope encryption.** Per-practice DEK, wrapped by a KMS master key. No passphrase-derived keys for server data. `dek_id` on every ciphertext column for rotation. | `sqlite_cipher.rs:100-107` derives a raw hex key from one SHA-256 round with a hardcoded static salt, which makes SQLCipher's `kdf_iter` inert |
| **V6** | **Export fails loudly.** Any unparseable or unverifiable row aborts the export with its `seq`. | `export_for_audit` substitutes `"unknown"` placeholders and drops failures via `filter_map(.ok())` |
| **V7** | **Emission is structural.** The data access layer emits an entry per PHI operation. A PHI query path that bypasses it is a build failure, enforced by test. | `log_intent` has no caller outside one unit test |
| **V8** | **Clinical event vocabulary.** `chart.view`, `note.create/sign/amend`, `export.generate`, `print`, `permission.change`, `breakglass.open`, `consent.grant/revoke`, `login`, `session.expire`. | `Intent`/`Action` model AI decisions; there is no record-*view* concept |
| **V9** | **No bypass.** Verification failure fails closed. No `--skip-verify`, no hardcoded pass. | `main.rs:54` ships `--skip-verify`; `desktop/.../main.rs:193-202` returns hardcoded `valid: true` with a TODO |
| **V10** | **Tamper tests are mandatory.** CI asserts `verify()` returns false for: mid-chain edit, deletion, reorder, **tail truncation**, and signature substitution. | 11 tests exist, **none attempt tampering**; `test_wrong_passphrase` has no assertion |

### 2.2 Platform requirements

| # | Requirement | Replaces |
|---|---|---|
| **P1** | **Tenancy below the app.** Postgres RLS on `practice_id`, `discipline`, `sensitivity_tier`. Connection sets the tenant; policies do the rest. | No tenancy of any kind; one flat `User` collection across 9 product domains |
| **P2** | **Revocable server-side sessions.** 15-min idle expiry, role re-read from the DB per request, purpose claims per token class, `tokenVersion` bumped on password/role change, WebAuthn MFA. | 7-day bearer JWT, `logout` is a no-op (`AuthController.js:133`), `admin` read from the token claim so a demoted admin keeps access for days, and any `JWT_SECRET`-signed token is accepted everywhere (`auth.js:17`) |
| **P3** | **Encryption fails closed.** No key fallback chain, no hardcoded key, hard-throw on a missing key. Encrypt error aborts the write; decrypt error raises. | `crypto.js:15` falls back `MESSAGE_ENC_KEY → JWT_SECRET → 'clockwork-dev-fallback-key'`; `:28` returns **plaintext** on error; `:44` returns `''` on decrypt failure. (`models/CreditMember.js:16-44` already does this correctly — use that pattern) |
| **P4** | **PHI-free side channels.** No PHI in notifications, email bodies or subjects, logs, analytics, push, or calendar entries. | `Notification.text` stores the first 70 chars of every message in plaintext, nullifying the body encryption; `barberEmails.js:68` emails appointment notes; `AuthController.js:80,118` logs email addresses |
| **P5** | **Signed, time-limited object URLs** with random keys. | Every upload is a permanent world-readable Cloudinary URL; `raw` PDFs embed the original filename + a ms timestamp |
| **P6** | **Rate limiting covers reads**, in a shared store, per-account and per-IP, with lockout and bulk-read anomaly alerting. | `server.js:117` exempts **every GET** in the API |
| **P7** | **Versioned migrations** with a ledger and rollback. No DDL on boot. No TTL deletion on any clinical table. | No framework; two `dropIndex` calls run on every start; 8 TTL indexes silently delete rows (`Project` after 24h) |
| **P8** | **Transactions** on all clinical and money writes. | `tokenEarn.js:34-49` does a balance `$inc` and a ledger `create` as two unsessioned writes with no unique index |
| **P9** | **Multi-provider / multi-resource scheduling.** `provider_id` and `resource_id` through the booking row, the uniqueness constraint, availability generation, and per-provider hours. Overlap guard must cover ranges, not just equal start times. | Uniqueness is `{shopHandle, startsAt}` — one bookable resource per tenant; overlapping bookings with different starts are caught only by a read-then-write pre-check |
| **P10** | **Outbound ceilings + one breaker.** Timeouts configured once at each client, not per call site. | `aiClient.js:45` sets no timeout and no retry cap (SDK defaults: 10 min, 2 retries); `blueprintClassify.js:136` can make 9 calls × 10 min; **zero circuit breakers anywhere** |
| **P11** | **CI gates merge**: tests, lint, `npm audit`, secret scan. Plus backup **and tested restore**. | `.github/` does not exist; no `npm test`; no restore script anywhere; `dump-collections.js` covers 6 of 49 collections, excludes `User`, and writes to ephemeral container disk |
| **P12** | **Healthcheck tells the truth.** Platform probe returns non-2xx when a dependency is down. | `server.js:319` hardcodes 200 `"healthy"` while reporting `mongodb: 'disconnected'` in the body — Railway's restart policy is disarmed |

### 2.3 Client / PWA requirements

| # | Requirement |
|---|---|
| **C1** | Service worker caches the **app shell only**. `NetworkOnly` for `/api/*`. No PHI in Cache Storage, IndexedDB or localStorage. (Policy already correct in `sw.js:1`) |
| **C2** | 15-minute idle logoff that **scrubs rendered PHI from the DOM** and revokes the session server-side. (Already implemented in `admin.js:56` — reuse) |
| **C3** | T2/T3 client-side encryption via WebCrypto with **non-extractable** `CryptoKey` handles. Raw key material never reaches JS. Break-glass = author re-wraps the DEK for a named grantee, which is a `breakglass.open` ledger entry by construction |
| **C4** | Installable: own manifest, icon, `display: standalone`. Desktop install via Chrome/Edge; iOS via Add to Home Screen |
| **C5** | No offline PHI in P0. Deferred drafts, if ever, encrypt under a session key and wipe on logout |

### 2.4 Encryption boundary (the key design)

The sensitivity tiers *are* the encryption architecture:

| Tier | Scheme | Rationale |
|---|---|---|
| T0 / T1 | Server-side envelope (per-practice DEK in KMS) | Must stay queryable, AI-eligible, reportable, care-team shareable |
| T2 / T3 | Client-side, author-held key | Spec already makes these author-only and excludes them from exports, AI and reports — so opaque-to-server costs nothing |

**Not end-to-end for the main record.** E2EE breaks B12 (AI scribe needs plaintext), B10 (cross-client
reporting), B4 (server must know appointment times), A5 (server-side records packet), A2/A3 (N-reader
key wrapping with revocation) — and a lost key destroys the practice's records, which is an availability
failure, not a privacy win.

### 2.5 Vendor gate (Part G: every PHI-path vendor signs a BAA)

| Need | Choose | Rejected |
|---|---|---|
| Hosting / DB | AWS or GCP; RDS/Aurora or Cloud SQL | Railway, Vercel for PHI |
| Keys | AWS KMS / Cloud KMS | passphrase-derived keys |
| Email / SMS | Paubox or LuxSci; Twilio | Resend (no BAA at tier) |
| Object storage | S3/GCS, SSE-KMS, signed URLs | Cloudinary public URLs |
| Telehealth | LiveKit Cloud or Daily (SFU, 15-party) | self-hosted mesh |
| AI | Bedrock / Vertex, or zero-retention enterprise | Moonshot, OpenRouter |
| MFA | WebAuthn / passkeys | SMS OTP |

---

## PART 3 — ORCHESTRATION

### 3.1 The ordering rule

**Tenancy, the audit ledger, and encryption land before the first patient record exists.** Not in the
same phase — *before*. Every one of them is cheap now and a re-architecture later. This is the single
most important sequencing decision in the document.

### 3.2 Phases

**Phase 0 — Foundation (no PHI yet)**
1. Postgres + migration framework + CI that gates merge (P7, P11)
2. Schema with `practice_id` / `discipline` / `sensitivity_tier` + RLS policies (P1)
3. KMS, per-practice DEKs, envelope encrypt/decrypt with `dek_id` (V5, P3)
4. Vault: signed append-only ledger, `seq`, head anchor, off-box daily digest (V1–V6)
5. Data access layer; **test that fails the build on any PHI path bypassing it** (V7)
6. Sessions, RBAC, MFA, 15-min idle (P2)
7. Tamper test suite green (V10)

*Gate: the Pre-PHI checklist in §4.2 passes in full. No patient data before this.*

**Phase 1 — MD Fit live, one discipline (C5 Bodywork/Rehab)**
8. Client record + chart + timeline; migrate from `/api/admin/emr/*`
9. Scheduling with provider/resource dimension (P9) on `barberSchedule.js`
10. Notes with sign + lock + addenda; T2 client-side crypto (C3)
11. Intake/consent forms with e-sign, writing into structured fields
12. Stripe: visits, packages, memberships, superbills; webhook-only state (P8)
13. Client portal (web PWA): book, forms, pay, messages, shared plans
14. Reminders (BAA'd email/SMS), basic reports
15. `/console` + landing-page button (§1.4)

*Gate: MD Fit runs on it for 30 days. Restore rehearsal passed. Audit review done.*

**Phase 2 — Second discipline + second practice**
16. Care-team consent + shared care summary (A2) — the first real multi-discipline test
17. Break-glass with reason, owner alert, ledger entry
18. Records-release packet with T2 auto-excluded
19. Second practice onboarded → tenancy proven under real load
20. Telehealth, AI scribe — only after their BAAs are signed and priced

**Phase 3+** — remaining modules, native wrappers (Tauri around the same PWA), public API, eFax, labs.

### 3.3 Working rhythm

- One branch → PR → preview → merge; one merge at a time (existing repo convention).
- Any change touching PHI paths requires: migration + RLS policy + ledger event + test, in one PR.
- Anything in Part 2's tables is a numbered requirement; PRs reference the number they close.

---

## PART 4 — CHECKPOINTS (duties)

### 4.1 HIPAA Security Rule → control → evidence

| Duty | Control | Evidence artifact | Cadence |
|---|---|---|---|
| §164.312(b) Audit controls | Vault ledger, emitted by the data access layer | Signed chain + daily off-box anchor; `verify()` report | Daily anchor; quarterly review |
| §164.308(a)(1)(ii)(D) Activity review | Bulk-read anomaly alerting; access report per practice | Review log with reviewer + date | Monthly |
| §164.312(a)(2)(i) Unique user ID | Per-staff accounts; no shared logins | Staff roster vs active sessions | On change |
| §164.312(a)(2)(iii) Automatic logoff | 15-min idle, server-side revoke + DOM scrub | Test + manual check per release | Per release |
| §164.312(a)(2)(iv) Encryption at rest | Envelope encryption, per-practice DEK in KMS | KMS key policy + `dek_id` coverage query | Per release |
| §164.312(e) Transmission security | TLS 1.2+, HSTS, no PHI in URLs | TLS scan; URL-pattern test | Per release |
| §164.312(c) Integrity | Append-only ledger; note sign + lock + addenda | Tamper test suite green | Per commit (CI) |
| §164.308(a)(4) Access management | RBAC + RLS + consent records | Role matrix test; RLS policy test | Per release |
| §164.308(a)(7) Contingency | Backup + **tested restore**, documented RPO/RTO | Restore rehearsal report | Quarterly |
| §164.308(b) BAAs | Signed BAA per PHI-path vendor | BAA register with dates | On vendor change; annual |
| §164.316 Documentation | This doc + policies, retained 6 years | Versioned in repo | Ongoing |
| §164.312(a)(1) Emergency access | Break-glass with reason + alert + ledger | Break-glass drill record | Semi-annual |
| Retention | No TTL on clinical tables; per-discipline/state policy | Schema assertion test | Per release |

### 4.2 Pre-PHI hard gate

Every line must be checkable, not asserted. **No patient data until all pass.**

- [ ] RLS denies cross-tenant reads — proven by test, with the app-level filter *removed*
- [ ] Every PHI table has `practice_id`, `discipline`, `sensitivity_tier` — schema assertion
- [ ] No PHI query path bypasses the data access layer — build-failing test (V7)
- [ ] Ledger: mid-chain edit, deletion, reorder, **tail truncation**, signature substitution all detected (V10)
- [ ] Head anchor shipped off-box and verified from the off-box copy
- [ ] Encryption: missing key hard-throws; encrypt error aborts the write; decrypt error raises (P3)
- [ ] No hardcoded or fallback key anywhere — grep assertion in CI
- [ ] Key rotation exercised: re-wrap a DEK, old and new ciphertext both readable
- [ ] Session: revoke works; 15-min idle enforced; role re-read from DB; demotion effective immediately
- [ ] MFA enforced for every staff role
- [ ] Backup taken **and restored into a clean environment**, with the ledger verifying post-restore
- [ ] PHI-free check: logs, emails, notifications, analytics, push, error reports, URLs (P4)
- [ ] Object URLs signed, time-limited, random keys (P5)
- [ ] Rate limiting covers GETs; lockout active (P6)
- [ ] Healthcheck returns non-2xx with the DB down (P12)
- [ ] BAA signed and filed for every vendor in §2.5
- [ ] Assessor / counsel review complete
- [ ] Incident response + breach notification procedure written and rehearsed once

### 4.3 Per-release checklist

- [ ] Migration reversible; applied to staging first
- [ ] New PHI field → tier assigned, encrypted, ledger event, RLS covered
- [ ] Tamper + RLS + idle-logoff tests green
- [ ] `npm audit` clean or triaged
- [ ] No new vendor in the PHI path without a BAA
- [ ] For the marketing site: `node scripts/seo/build.js` then `node scripts/seo/check.js` clean;
      `node scripts/version-assets.js` after CSS/JS edits

### 4.4 Spec A1–A5 → acceptance tests

| Spec | Test |
|---|---|
| A1 tenant isolation | Cross-tenant read denied with app filter removed; per-practice export and full delete both work |
| A1 super-admin cannot read PHI | Platform admin read denied without an approved, time-limited, logged grant |
| A2 discipline segregation | Trainer account cannot read a therapy note; sees shared care summary only |
| A2 care-team consent | Grant → read succeeds; revoke → read denied; expiry → read denied; all four in the ledger |
| A3 RBAC | Role matrix test, one case per cell, including per-location scoping |
| A4 tiers | T2 excluded from export and records packet; T3 shows redisclosure warning; break-glass alerts the owner |
| A4 minors | Guardian portal access with a named field hidden from the guardian |
| A5 audit | Every view/edit/export/print present in the ledger; chain verifies; anchor matches off-box copy |
| A5 sign + lock | Locked note is immutable; change only via addendum, attributed and timestamped |

### 4.5 Commercial launch gate (first paying customer that is not MD Fit)

Separate from §4.2. §4.2 lets you store PHI; this lets you *sell*.

- [ ] Customer-facing **BAA template** reviewed by counsel, signable before provisioning
- [ ] Terms of service, privacy policy, DPA — written against what the code actually does
      (do not inherit `omniverse-core`'s `docs/PRIVACY.md` or `SECURITY.md`: they make affirmative
      claims the code does not implement, and publishing them under a clinic's name is itself a
      compliance problem)
- [ ] **Subprocessor list published**, with a notice mechanism for changes
- [ ] Incident response + breach notification procedure, with the ≤60-day clock documented and one
      tabletop rehearsal completed
- [ ] Cyber liability + tech E&O bound, sized to aggregate PHI
- [ ] Support-access path implemented and logged: time-limited, practice-approved, no standing
      platform access to PHI (A1)
- [ ] Per-practice export and full-delete both exercised end to end
- [ ] Holding entity formed; IP assignment for any inherited code (§0.2)
- [ ] Status page + stated SLA; on-call rota with a human reachable
- [ ] US-only data residency confirmed at every vendor in §2.5
- [ ] SOC 2 Type II started (readiness assessment at minimum) — expect to be asked

---

## Open items

1. **`mdfit-backend/lib/emr.js` is unread** — `add_repo` was denied. It is the closest prior art
   (chart, patient-readable notes, prescribed movements, paid-visit scheduling) and should be read
   before Phase 1 modelling.
2. **Telehealth + AI scribe pricing** including BAA terms — these two can reshape the phasing.
3. **Discipline/state retention matrix** — needed before the retention assertion test can be written.
4. **Product name and domain** for the platform, separate from mymdfit.com.
