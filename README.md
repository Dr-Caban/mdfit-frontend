# mdfit-frontend

The MD Fit website, member app, practice workspace (`/admin`), manager console (`/manager`) and developer console (`/dev`).
Working notes for sessions are in `CLAUDE.md`; the inventory is `docs/HANDOFF.md`.

## ** DO NOT TOUCH after compliancy is set **

MD Fit is a live patient EMR. Once the Compliance checklist in the workspace shows the safeguards as met, the parts
below are locked. Do not change, refactor, "tidy" or remove them, and do not weaken what they do, unless the practice
owner asks for that exact change in writing in the session. A bug fix elsewhere is never a reason to touch them.

Locked in this repo:

- The Compliance screen in the workspace (`workspace.html`, `workspace-app.js`: checklist, patient requests, incident
  log, registers, audit review, compliance settings).
- Staff sign-in, sign-out, the 15-minute idle sign-out and the activity heartbeat in `workspace-app.js`, `admin.js`,
  `manager.js` and `dev.js`.
- The role-based switch and menu gating (who sees Admin, Manager, Developer, Client portal).
- The owner-password prompts on revenue share and commission settings.
- The patient chart (EMR) screens and the intake documents.

Locked in `mdfit-backend`: see the same section in that repo's `README.md`.

If a change to a locked part is asked for: say which safeguard it affects and which rule it serves, make the smallest
change, run the backend tests (`node --test`), and re-check the Compliance checklist afterwards.
