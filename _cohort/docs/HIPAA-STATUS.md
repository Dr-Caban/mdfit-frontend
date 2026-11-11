# HIPAA checklist — status against evidence

**As of Nov 11, 2026.** Source: sections 10 and 14 of `hipaa-compliance-complete.md`, copied unchanged,
with a status added where work exists.

## Read this first

**Nothing here is HIPAA compliant yet, and no item is fully checked.** What exists is a database
foundation — three migrations and a test suite — plus a clickable prototype with mock data. There is no
application, no login, no encryption code, no hosting, and no signed BAA.

| Mark | Meaning | Count |
|---|---|---|
| `[x]` | Done and verified end to end | **0** |
| `[~]` | Groundwork built and tested at the database layer; the item is not complete | **7** |
| `[ ]` | Not started | **77** |
| | Total | 84 |

A `[~]` means a specific, tested property of the database. It does not mean the control is in place for
users. Evidence for every `[~]` is in `docs/VERIFICATION.md`; rerun it with `db/test/run.sh`.

The prototype (`prototype.html`) has a Security page showing encryption, MFA and audit as green. That
page is illustrative mock data. Do not show it to a customer or an assessor as the state of the system.

---

## 10. EMR engineering checklist (build requirements)

### 10.1 Infrastructure & hosting
- [ ] Cloud provider with a **signed BAA**; use **only HIPAA-eligible services** covered by it
- [ ] US data residency (recommended)
- [ ] Separate production, staging and dev; **no real PHI outside production**
- [ ] Infrastructure as code; changes reviewed and logged
- [ ] Network segmentation (private subnets, database not reachable from the internet)
- [ ] WAF / DDoS protection; rate limiting on authentication and API endpoints

### 10.2 Encryption
- [ ] **TLS 1.2+ (prefer 1.3)** everywhere; HSTS; no plain-HTTP endpoints
- [ ] **AES-256 at rest** for the database, object storage, backups, logs and search indexes
- [ ] **KMS-managed keys**, per-tenant data keys (envelope encryption), rotation, and logged key use
- [ ] Field-level encryption for Tier 2/3 data; optional **end-to-end encryption (WebCrypto)** for psychotherapy notes
  - *Status:* `note.body_ciphertext` is a column. **Nothing encrypts.** The prototype's Security page shows this as done; that is mock data.
- [ ] FIPS 140-validated crypto modules where possible (needed for the safe harbor)
- [ ] Keys never stored alongside data; never in code or the repo
  - *Status:* The schema stores key *identifiers* only (`dek_id`, `key_id`). No keys, KMS or encryption code exist yet.
- [ ] **PWA offline cache encrypted** (AES-GCM, key unlocked at login, wiped at logout or remote wipe)

### 10.3 Identity & access
- [ ] **Unique user ID** for every person; no shared logins (R)
- [ ] **MFA** for all staff (passkeys/WebAuthn preferred); MFA option for patients
- [ ] Strong password policy plus breached-password checks
- [~] **Role-based access control** + **discipline separation** + **sensitivity tiers** + **tenant isolation (row-level security)**
  - *Status:* Tenant isolation, discipline separation and sensitivity tiers are enforced by Postgres row-level security and tested (gate groups A1, A2, A4, write paths). **Role-based permissions (the A3 role matrix) are not built.**
- [ ] Least privilege; quarterly **access reviews**
- [ ] **Automatic logoff** / session timeout (e.g., 10–15 min idle)
- [ ] **Break-glass emergency access** (R): requires a reason, is time-limited, alerts the owner, fully logged
  - *Status:* Not built. Owners are deliberately *not* exempt from the tier rule, so break-glass will be the only route in.
- [ ] Immediate deprovisioning when staff leave (and remote device wipe)
- [ ] Vendor and support staff access is just-in-time, approved by the customer, and logged

### 10.4 Audit controls (R)
- [ ] Log **every** create, read, update, delete, export, print, login, failed login, permission change, break-glass use and consent change
  - *Status:* The ledger table exists. **Nothing writes to it yet** — there is no application.
- [~] Each log records who, what record, what action, when, from where (IP/device) and the outcome
  - *Status:* `ledger_entry` has columns for actor, role, IP, event, subject, tier, outcome and time. Device is not captured. No writer exists.
- [~] **Append-only / tamper-evident** (hash chain or WORM storage)
  - *Status:* Tested: UPDATE, DELETE and TRUNCATE are refused; a wrong `prev_hash` is refused; two concurrent writers cannot fork the chain. **Not built:** computing the hash from the entry's content, Ed25519 signatures, and shipping the daily anchor off-box. Until those exist the chain proves order, not authenticity.
- [ ] Kept for **6+ years**
  - *Status:* No TTL or deletion path exists on the ledger, but no retention policy or archival is in place either.
- [ ] Practice admins can see access reports per patient ("who viewed my chart")
- [ ] Automated alerts: unusual volume, after-hours access, VIP/employee records, and coworkers viewing coworkers' charts
- [ ] **No PHI in application logs**, analytics or error trackers (scrub or tokenize)

### 10.5 Integrity
- [~] Signed notes are **locked**; changes only as dated, attributed **addenda**
  - *Status:* Tested at the database: a locked note cannot be updated or deleted, and a note's author, client, practice and discipline can never change. The addendum table exists. **No signing workflow or screen exists.**
- [ ] Version history for documents
- [~] Checksums or hashes on files; database constraints
  - *Status:* Database constraints are in place and tested (foreign keys, checks, an exclusion constraint that blocks overlapping bookings). No file handling exists.
- [~] Protection against tampering (signed audit chain)
  - *Status:* Chain linkage yes; signing no. See the append-only item above.

### 10.6 Availability & contingency
- [ ] Automated **encrypted backups**, point-in-time recovery, copies in a second region
- [ ] **Backup restores tested** quarterly
- [ ] Documented **RTO/RPO** (recovery time and recovery point targets); aim for **restore within 72 hours**, as in the proposed rule
- [ ] Disaster recovery runbook; emergency-mode operation (read-only or offline access through the PWA cache)
- [ ] Status page and an incident communication plan

### 10.7 Application security
- [ ] OWASP Top 10 / ASVS practices; secure coding training
- [ ] Dependency and container scanning; SAST/DAST in CI
- [ ] **Vulnerability scanning every 6 months** (better: continuous)
- [ ] **Independent penetration test every year**
- [ ] Content Security Policy, secure cookies, CSRF protection, input validation
- [ ] Encrypted file uploads, malware scanning, **signed expiring download URLs**
- [~] API: authentication on every call, tenant scoping enforced on the server (**never rely on frontend checks**)
  - *Status:* Tenant scoping is enforced in the database, below any API, and tested with no application-level filter. **There is no API and no authentication yet.**
- [ ] Secrets in a vault; rotated

### 10.8 Communications
- [ ] Email and SMS through **BAA-covered** providers; **minimum PHI** in messages ("You have a new secure message," not the clinical details)
- [ ] Push notifications **contain no PHI**
- [ ] Telehealth: a BAA-covered video provider, encrypted media, no recordings without consent
- [ ] Patient right to confidential communications (preferred channel and address)

### 10.9 AI features
- [ ] AI and transcription providers sign **BAAs** and have **zero data retention / no training** on your data
- [ ] AI only sees data the user is allowed to see
- [ ] AI drafts are reviewed and signed by the clinician; AI output marked in the audit log
- [ ] Recording consent captured before ambient scribing (some states require **all-party consent**)

### 10.10 Patient rights features
- [ ] Export the patient record (PDF and machine-readable) for **right of access**; aim for a **≤15-day** turnaround
- [ ] Send a copy to a third party the patient designates
- [ ] Amendment request workflow (60-day timer)
- [ ] Accounting-of-disclosures report (6-year lookback)
- [ ] Restriction requests and confidential-communication preferences
- [ ] Authorization and consent capture with e-signature, expiry and revocation
- [ ] NPP delivery plus an acknowledgment record
- [ ] Psychotherapy notes kept out of exports automatically
  - *Status:* T2 notes are author-only in the database (tested). No export exists.
- [ ] Minor and guardian access controls
  - *Status:* Not built.

### 10.11 No trackers
- [ ] **No third-party analytics pixels, session replay or ad tags on any logged-in page**, or anywhere PHI is present (including the booking page once someone enters health details)
- [ ] First-party, PHI-free product analytics only, or a BAA-covered analytics vendor

### 10.12 Data lifecycle
- [ ] Retention settings per practice and state
- [ ] Secure deletion (crypto-shredding by destroying per-tenant keys)
- [ ] Customer offboarding: export, then a certified deletion within X days
- [ ] Device and media disposal under NIST 800-88

---

## 14. Launch-readiness checklist
- [ ] Attorney review: covered-entity analysis, BAA template, Terms, Privacy Policy, state-law matrix
- [ ] Security Official + Privacy Official named
- [ ] Risk analysis done; high risks fixed
- [ ] All PHI vendors have signed BAAs (hosting, database, storage, email, SMS, video, AI, transcription)
- [ ] Encryption at rest and in transit verified; keys in KMS
- [ ] MFA enforced for staff; break-glass tested
- [ ] Audit logging complete, tamper-evident, kept 6+ years
- [ ] No PHI in logs, analytics or notifications; no third-party trackers in the app
- [ ] Backups + restore test passed; disaster recovery plan written
- [ ] Penetration test done; critical and high findings fixed
- [ ] Incident response + breach notification runbook written and tabletop-tested
- [ ] Workforce trained; confidentiality agreements signed
- [ ] Patient-rights features working: export, amendment, accounting of disclosures, restrictions, NPP acknowledgment
- [ ] Part 2 consent and redisclosure handling ready (if serving substance-use treatment programs)
- [ ] Customer-facing BAA + security overview (+ SOC 2 Type I roadmap) ready for sales

---
