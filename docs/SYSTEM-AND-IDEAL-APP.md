# MD Fit — How the backend works, and what the ideal version looks like

**Scope:** `Dr-Caban/mdfit-backend` (Express 5 on Railway, JSON-file store) as read from the source at commit `4fffc36` ("XP: owner's new gem ladder"), plus the member app in `Dr-Caban/mdfit-frontend` (`account.js`, `account-xp.js`, `account-habits.js`, `app/generator.js`, `painmap.js`, `paintracks.js`, `musclereports.js`).
**Date:** 2026-11-07.

Every number in Part 1 comes from the code. Where the code disagrees with itself or with the older `docs/HANDOFF.md`, that is called out as **Drift**. Part 2 keeps the exact same headings and describes the app this should become.

---

## Contents

**Part 1 — How it works today**
1. [The shape of the system](#1-the-shape-of-the-system)
2. [The XP engine (the "Duolingo theory")](#2-the-xp-engine-the-duolingo-theory)
3. [User rankings: gems, leagues, leaderboard, pacers, challenges](#3-user-rankings)
4. [Streaks, daily activities, repairs](#4-streaks-daily-activities-repairs)
5. [Payment systems](#5-payment-systems)
6. [Pain tools](#6-pain-tools)
7. [Customization](#7-customization)
8. [Program saving](#8-program-saving)
9. [Client → patient lifecycle](#9-client--patient-lifecycle)
10. [Activity: feeds, calendar, realtime](#10-activity-feeds-calendar-realtime)
11. [Cross-cutting: auth, encryption, audit, limits](#11-cross-cutting)
12. [Drift, dead code and gaps](#12-drift-dead-code-and-gaps)

**Part 2 — The ideal app** (same structure)
1. [The shape of the system](#p2-1)
2. [The XP engine](#p2-2)
3. [User rankings](#p2-3)
4. [Streaks, daily activities, repairs](#p2-4)
5. [Payment systems](#p2-5)
6. [Pain tools](#p2-6)
7. [Customization](#p2-7)
8. [Program saving](#p2-8)
9. [Client → patient lifecycle](#p2-9)
10. [Activity](#p2-10)
11. [Cross-cutting](#p2-11)
12. [Migration order](#p2-12)

---

# Part 1 — How it works today

## 1. The shape of the system

```
Browser / PWA (/account)                 Vercel edge (middleware.js)           Railway (server.js)
──────────────────────────               ─────────────────────────────        ─────────────────────────────────
account.js, account-xp.js,   HTTPS       US-only, bot filter, adds            Express 5, three routers:
account-habits.js  ──────────────────▶   x-mdfit-edge secret, forwards ─────▶   app   (public)        33 routes
Bearer token in localStorage             real IP in x-mdfit-client-ip            /api/admin           73 routes
                                                                                 /api/me              63 routes
socket.io  ───────── direct, bypasses edge (WS can't proxy) ──────────────▶   lib/realtime.js  /admin /member /public
                                                                               lib/store.js: one JSON file per
                                                                               collection in DATA_DIR, AES-256-GCM
```

The single most important design fact: **the server stores facts, never scores.** A client record holds `workouts[]`, `painLog[]`, `vitals[]`, `xpLog[]`, `repairsUsed[]`; the `habits` collection holds `checks[]`; `challenges` holds sent challenges; `appointments` holds visits. XP, gem level, badges, streaks, league and rank are **recomputed from that history on every read** (`lib/rewards.js` header: "always recomputed from the client's real history… so progress can't be lost, reset or gamed by editing a counter"). There is no `xp` field anywhere on disk.

Everything below is a consequence of that one decision.

Modules that matter for this document:

| Module | Owns |
|---|---|
| `lib/rewards.js` (200 lines) | XP constants, gem ladder, badges, `rewards()` recompute, workout-day repair tokens |
| `lib/habits.js` (272) | Daily activities list, goal norms, qualifying days, the *second* streak/repair model |
| `lib/clients.js` (883) | Accounts, pain log, workouts, vitals, referral, leaderboard, leagues, pacers, `#N overall`, `POST /xp`, admin plan/programs/type |
| `lib/custom-workouts.js` (131) | Workout builder, challenges, `classifyWorkout()` (decides a workout's XP kind) |
| `lib/content.js` (646) | 23 built-in programs, lectures, live Q&A, tiers, tips, access level, membership requests, 1-on-1 meetings, admin content editor |
| `lib/payments.js` (362) | Stripe checkout (membership / protocol / single service), webhooks, accountability credit |
| `lib/intake.js` (357) | 5-document intake packet, per-appointment and per-member |
| `lib/messages.js` (224) | Encrypted member↔doctor thread, broadcasts, reactions |
| `server.js` (1,283) | Booking engine, availability, appointments, reviews/reward codes, leads, classes, calendar sync, activity feed, audit timer |

---

## 2. The XP engine (the "Duolingo theory")

`lib/rewards.js` is the whole economy. It is explicitly modelled on Duolingo (the file's first line says so): XP → levels (gems) → leagues, streaks with "freezes" (repairs), a daily goal, achievements (badges), a weekly-resetting leaderboard, and synthetic competitors.

### 2.1 Event sources and their values

`rewards(history, today)` turns every stored fact into an *event* `{ date, type, xp }`, sorts them by date, and walks the list once. Sources, with the exact rules:

| Source | Rule | XP |
|---|---|---|
| **Workout** (`client.workouts[]`) | Per clinic day, **only the single most valuable workout earns base XP**; every other workout that day earns 0 but still counts for badges, streaks and the calendar. Value by `kind` (set by the server in `classifyWorkout`): | normal **30**, custom **35**, challenge **30**, program **50** |
| Challenge done | First challenge-kind workout per `ref` per day → bonus event | **+10** |
| Challenge sent | One bonus per day a member sent ≥1 challenge (however many) | **+5** |
| **Pain log** (`client.painLog[]`) | First 3 entries per day earn; the rest 0 | **5** each |
| **Visit** | Appointment with `status:"completed"` **matched by email** to the client | **50** |
| **Badge** | The day a badge's target is first reached | **+25** per badge |
| **Check-in** (`client.vitals[]`) | Per day, count of present readings among weight/sleep/restingHr/hrv/vo2max, capped at 2 | **5** × min(n,2) |
| **Daily activity** (`habits.checks[]`) | One per `habitId` per day; XP frozen at check time | 5–20 (list in §4) |
| **App action** (`client.xpLog[]`, via `POST /api/me/xp {kind, ref}`) | Per-day cap per kind; same `ref` on the same day counts once | see table |
| **Booking** | Derived server-side from non-cancelled appointments (`createdAt` date, clamped to today); not postable | **15**, cap 2/day |

App actions (`ACTIONS`): `video 2×10/day`, `lecture 10×3`, `message 3×3`, `reaction 1×3`, `favorite 2×5`, `program 5×3`, `generate 2×3`, `share 5×1`, `profile 5×1`, `booking 15×2`. The server stores up to `cap × 3` log rows per kind per day and the recompute applies the real cap, so spamming the endpoint changes nothing.

Daily cap sanity: a maximally active day is roughly 50 (program) + 10 (challenge) + 5 (sent) + 15 (pain) + 10 (check-in) + ~120 (all 18 activities) + ~90 (actions) ≈ **300 XP**. A typical honest day is 30–80.

### 2.2 Workout "kind" is decided by the server

`POST /api/me/workouts` takes a `key` string from the player and `classifyWorkout(store, client, key, today)` stamps `kind`/`ref` from facts it can verify:

| `key` pattern | Check | kind |
|---|---|---|
| `custom-<12hex>` | that id exists in `client.customWorkouts` | `custom` (35) |
| `challenge-<12hex>` | a challenge with that id was sent **to this member**; marks it `done` the first time | `challenge` (30 + 10) |
| `track-<id>` / `painproto-<id>` | regex only | `program` (50) — pain tracks and muscle protocols are "Dr. Jared's programs" |
| `prog-<programId>-…` | programId exists in content programs | `program` (50) |
| anything else (generated workout, saved generated workout `program-<id>`) | — | `normal` (30) |

A client cannot claim 50 XP by sending `kind:"program"`; the body field is ignored.

### 2.3 Gem ladder (levels)

```
Level  Gem        Starts at XP   Mohs    Colour
  1    Peridot            0       6.5    #9ac85a
  2    Garnet            51       7.0    #c13a5c
  3    Onyx             501       7.0    #1a1a1a
  4    Emerald        2,501       7.75   #2fa06a   ← Olympic League opens here
  5    Ruby           7,501       9.0    #d8213c
  6    Sapphire      15,001       9.0    #1d49a8
  7    Diamond       30,001      10.0    #c6edff
  8    Platinum      60,001        —     #e5e5e5
```

`gemstoneOf(xp)` returns `{ current, next, progress (0–1 inside the band), xpToNext }`. Gems are permanent because XP never decreases.

> **Drift:** `docs/HANDOFF.md` lists the older ladder (Peridot 0, Garnet 101, Onyx 501, Emerald 1,251…) and "OLYMPIC_XP = 1250". The code now ties the Olympic League to `levelStart(4)`, which is **2,501** on the new ladder; the comment in `clients.js:585` still says 1,250. Only the number moved; the mechanism is unchanged.

### 2.4 Badges (14)

`first-workout 1`, `workouts-10/50/100`, `streak-3/7/30` (consecutive *workout* days), `week-3` (3 workouts Mon–Sun), `hours-10` (600 min), `explorer` (all 5 generator goals), `checkin-7`, `pain-5`, `pain-down` (any area drops ≥3 points vs. its first log), `first-visit`. Each pays +25 XP on the day it is earned, which is why a badge can retroactively change a past day's total.

### 2.5 What the client receives

`GET /api/me/rewards` → `{ xp, level, title, levelStart, nextLevel, rank{current,next,progress,xpToNext}, gems[], todayXp, todayParts{workouts,activities,other}, dailyGoal:30, week[7]{date,xp}, monthXp, badges[14]{…progress,earned,earnedOn}, repairs{earned,used,available,usedDates}, overall{rank,total,hidden}, olympicLevel:4 }`.

The frontend celebrates by **diffing**: `loadRewards(true)` compares the previous response with the new one and toasts `+N XP`, a new gem, new badges, or "Daily goal reached!" — there is no server-pushed "you earned" event. Milestone overlays (`#ms`), the leaderboard pop-up on level-up / every 3rd badge, and the notification inbox are all client-side bookkeeping in `localStorage` (`mdfit-seen-*`).

### 2.6 Duolingo mapping, feature by feature

| Duolingo | MD Fit today | Notes |
|---|---|---|
| XP | XP (recomputed) | ✔ |
| Crowns / levels | 8 gems | ✔ permanent |
| Daily goal (Casual/Regular/Serious/Intense) | Habits goal level Beginner 50 / Intermediate 75 / Pro 100 | ✔ but see §4 — a *second* daily goal of 30 lives in `rewards.js` |
| Streak | Three different streaks (§4.4) | ⚠ |
| Streak freeze | Repair tokens, two implementations | ⚠ |
| Leagues (Bronze→Diamond, promote/demote weekly) | Two leagues, Pro & Olympic, by **lifetime** XP; no weekly promotion/demotion | partial |
| Weekly leaderboard | day/week/month/all periods, top 10 | ✔ |
| Bots in empty leagues | Pacers (synthetic "Sarah K." etc.) | ✔ but undisclosed in UI |
| Achievements | 14 badges | ✔ |
| Friend quests / challenges | Member-to-member workout challenges | ✔ |
| Hearts / lives | none | — (correct for a clinic) |
| XP boosts / double XP | none | — |
| Friend streaks | none | — |
| Push reminders at "streak at risk" | In-app bell only; email for messages/bookings | partial |

---

## 3. User rankings

All in `lib/clients.js` (§ `boardRows`, `/leaderboard`, `overallOf`, `pacers`) and `lib/custom-workouts.js` (challenge pool).

### 3.1 The board rows

`boardRows()` builds one row per client who has **not** set `hideRank`, by running the full `rewards()` recompute for each client: `{ id, name:"First L.", xp, week, day, month, level, gem, league }`. Rows with `xp === 0` are dropped. Then pacers are appended (§3.4). The result is cached for **60 s** but invalidated instantly by a "stamp" of record counts (clients, workouts, pain logs, vitals, xpLog, habit checks, challenges, appointments, today) — so a new workout anywhere refreshes everyone's board on the next request.

Cost note: this is O(members × history) per cache miss, all in-process, on a JSON file. Fine at tens of members; it is the first thing that will hurt at hundreds (§12).

### 3.2 Leagues

```
leagueOf(xp) = xp >= levelStart(4) ? "olympic" : "pro"     // 2,501 lifetime XP
```

Two leagues, membership decided by **lifetime** XP only. There is no weekly promotion/demotion, no relegation zone, no cohort cap. Once Emerald, always Olympic.

### 3.3 Periods and the response

`GET /api/me/leaderboard?period=day|week|month|all&league=pro|olympic|all`

- Default period `week`, default league = the caller's own.
- Score column: `day` = `todayXp`, `week` = Σ this Mon–Sun, `month` = XP since the 1st, `all` = lifetime `xp`.
- Sort by score desc, tie-break lifetime XP desc. Rows with score 0 are hidden.
- `top` = first **10** (or **25** for `league=all`, which is **real members only**, no pacers).
- `me` = the caller's `{rank, score}` wherever they fall, or `null` when they have 0 for that period.
- `resetsOn`: tomorrow / next Monday / the 1st / `null`.
- `olympicXp`, `olympicGem` ("Emerald"), `olympicLevel` so the UI can say "reach X to move up".

### 3.4 Pacers (synthetic competitors)

If a league has fewer than **9** real rows, it is padded with deterministic fake members from `PACER_NAMES` (20 names; Olympic uses the second half of the list first). Each pacer's week/day/month score is a seeded function of `(league, Monday, name)` and the current hour, following a `progress^(0.8–1.4)` curve so they "catch up" during the week: Pro pacers target 40–260 XP/week, Olympic 150–600. Their lifetime XP is placed inside a plausible gem band. `LEADERBOARD_PACERS=off` disables them. Pacers are flagged `pacer:true` and are excluded from the challenge pool and from "#N overall", but the member-facing JSON **does not** carry the flag — the UI shows them as people.

### 3.5 "#N overall"

`overallOf(c, myXp)` = 1 + (number of real, non-hidden members with more lifetime XP than me). Works for hidden members too (private rank). Shown on the Home gem card and Profile.

### 3.6 Hiding

`PUT /api/me/leaderboard/visibility {hidden}` sets `client.hideRank`. A hidden member: is not on any board, cannot be challenged, cannot be looked up (404 identical to "unknown id" so existence doesn't leak), but still sees their own private overall rank.

### 3.7 Challenges (member vs member)

- Pool: `GET /api/me/challenges/members` = real board rows minus pacers, minus self, minus hidden.
- Send: `POST /api/me/challenges { workoutId (one of my customWorkouts), toId }` → copies **only** `{ name, exercises[{id,sets,reps|seconds}] }` to the `challenges` collection (never any health data). Limits: **10 sends/day**, 409 if the same workout is already open with that person. Sender earns +5 (first send of the day only).
- Receive: `GET /api/me/challenges` → `open[≤20]`, `done[≤10]`, `sent[≤20]`. Playing it with key `challenge-<id>` logs a `challenge` workout: 30 + 10.
- Admin activity feed records `challenge_sent` with no names.

---

## 4. Streaks, daily activities, repairs

### 4.1 Daily activities (`lib/habits.js`)

An admin-editable list (Admin → Settings → Activities, `PUT /api/admin/habits`, 1–60 items, 0–100 XP each, `dailyGoal` 10–500). Defaults, Nov 2026:

| Activity | XP | | Activity | XP |
|---|---|---|---|---|
| Sunlight (20 min) | 15 | | Walk (10 min) | 15 |
| Acupressure mat | 15 | | Sauna | 15 |
| Foam rolling | 15 | | Stretching | 5 |
| Ice bath | 20 | | Yoga | 20 |
| Health shot | 5 | | No screens after 9 PM | 15 |
| Prayer | 10 | | Massage | 20 |
| Meditation | 10 | | Journaling | 5 |
| Grounding | 5 | | Red light | 10 |
| Box breathing | 5 | | Active recreation | 10 |
| *Sending challenge workout* (auto) | 5 | | *Doing challenge workout* (auto) | 10 |

Rules: one check per activity per clinic day (`409 duplicate`); undo only the same day; the two `auto` items can't be ticked (409) — they are mirrored from the challenge flow. **XP is frozen on the check** (`{date, habitId, points, at}`), so a later admin edit never rewrites history. Checks older than 800 days are dropped on save. The record is per member in the `habits` collection: `{ clientId, since, checks[], grants[], goalLog[] }`.

### 4.2 Daily goal norms

`GOAL_LEVELS = { beginner: 50, intermediate: 75, pro: 100 }`. `PUT /api/me/habits/goal {level}` appends to `goalLog` *from today forward*, so raising the bar never turns past days into misses. A day **qualifies** when `activities XP + workout XP ≥ that day's goal` (app-action XP, pain XP, check-in XP and visit XP do **not** count toward qualifying — only activities and workouts).

> **Drift:** `rewards.js` still exports `DAILY_GOAL = 30` and the Progress tab's "goal ring" (`#goal-ring`) uses *that* value against *total* `todayXp`, while the Home gem card and the habits card use the 50/75/100 norm against activities+workouts. A member can see "Goal met" on one screen and "15 XP to go" on another.

### 4.3 Streak model A — qualifying days (`habits.streaks`)

Walks the timeline oldest→newest:
- Each qualifying day: `actual++`, `shown++`; every **3rd consecutive** qualifying day **earns one repair**; `grants[]` (e.g. referral bonuses via `grantRepair`) add repairs on their date.
- A gap of N missed days (today never counts as missed): if `shown > 0` and `available ≥ N`, the gap is **bridged automatically** (N repairs consumed, ledger rows `used`) and `shown` continues; otherwise `shown` resets to 0 and nothing is spent. `actual` always resets.
- Output: `{ current (shown), actual, best, missed, lifetimeQualifying, repairs{available,earned,used,repairedDates,ledger} }`.

This is what the **Home gem card** ("🔥 N day streak"), the **habits card** and the **Progress calendar paint** (`goal-q / goal-r / goal-m` classes from `GET /api/me/habits/history`) use.

### 4.4 Streak model B — workout days (`rewards.repairsFrom` + `/repair-streak`)

- `stats.streak` (`GET /api/me/stats`, `workoutStats`) = consecutive calendar days with ≥1 workout, counting back from today (or yesterday).
- `repairsFrom(workouts, repairsUsed)`: one token per completed 3-consecutive-workout-day block, awarded only when `(i-2) % 3 === 0` so a long streak doesn't stack; `available = earned − used`.
- `POST /api/me/repair-streak {date}`: validates past date, not already repaired, `available ≥ 1`; appends to `client.repairsUsed[]`. **Nothing reads `repairsUsed` except this endpoint and `GET /rewards`** — model A ignores it, so a manually "repaired" day does not bridge the gem-card streak, and model A's auto-bridges never appear in model B's `usedDates`.

This is what the Progress tab's "Use 1 repair to bridge this day" button, the `#repair-chip`, the `streak-3/7/30` badges and the Home "Keep your N-day streak going" notification use.

> **Drift:** three streak definitions (A: qualifying-day with auto-repair; B: workout-day with manual repair; `stats.streak`: workout-day, no repairs) and two repair wallets. They agree on a member who only works out and never misses, and disagree on everyone else.

### 4.5 History view

`GET /api/me/habits/history?month=YYYY-MM` → per day `{ date, points, goal, qualifying, recoveryOnly (goal met with activities alone), missed, repaired, today, future }` plus `qualifyingDays`, `streak{current,best,lifetimeQualifying,missed}`, `repairs{available}`. `qualifyingDays(client, month)` is exported for other modules (the comment says "Earned membership credits, referrals") but **no module calls it** today — the accountability credit uses its own definition (§5.5).

---

## 5. Payment systems

`lib/payments.js` (Stripe, API `2026-10-28.endive`) plus the non-Stripe paths in `lib/content.js` and `lib/clients.js`.

### 5.1 Gate

Checkout is **enabled only when both** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set — "taking money that can't be fulfilled is worse than not offering checkout yet." Otherwise every checkout route returns `503 "Online payments aren't switched on yet. Dr. Jared will send you a payment link."` and the app falls back to the **request** flow (§5.4). `GET /api/app/config.features.payments` tells the frontend which world it is in.

### 5.2 Tiers (admin-editable, `content.tiers`, ≤6)

| id | Name | $/mo | 1-on-1s | Access level |
|---|---|---|---|---|
| `member` | Accountability Membership | 19.95 | 0 | `member` (1) |
| `premium` | Premium 1-on-1 | 200 | 2 × 30 min | `premium` (2) |
| `premium-plus` | Premium Plus | 349 | 4 × 30 min | `premium` (2) |

Access level = 0 (no active membership) / 1 (any tier) / 2 (tier with `meetings > 0`). `membership.until` in the past = not active. **Today every program, lecture and the live Q&A is served `locked:false` to everyone** (`content.view`), and `/api/me/access` returns `member:true` — the access level only gates 1-on-1 meeting requests and the Premium meetings card. The paywall dialogs in the frontend (messaging, repeat generation) are UI-only.

### 5.3 Three Stripe checkouts (all Checkout Sessions, dynamic payment methods)

| Route | Mode | Line item | Return |
|---|---|---|---|
| `POST /api/me/checkout/membership {tier, rewardCode?, ui?}` | `subscription` | Price by lookup key `mdfit_tier_<tier>_<cents>_monthly` (created on demand under Product "MD Fit <tier name>") | `/account?checkout=success#premium` |
| `POST /api/me/checkout/protocol {service, sessions, plan, ui?}` | `payment` (gold/payg) or `subscription` (installments) | ad-hoc `price_data` named `"<service>: N visits · <plan label>"` | same |
| `POST /api/me/checkout/service {service, ui?}` | `payment` | `"<service> · 1 visit"` at `service.rate` | `/account?checkout=success&kind=service&svc=…` |

`ui:"embedded"` → `ui_mode:"embedded_page"` + `return_url` with `session_id={CHECKOUT_SESSION_ID}` placed *before* the `#hash`; the response is `{clientSecret, id}` and `stripe-checkout.js` mounts it in a dialog. Otherwise `{url, id}` (hosted). A Stripe Customer is created lazily per client (`stripeCustomerId`, metadata `clientId`); the code re-reads the clients file *after* the Stripe call before saving, to avoid clobbering concurrent writes.

**Protocol pricing** (`protocolQuote`, mirrors `pricing.js` so the browser can't change prices): `base = (withEval ? evalRate : 0) + rate × n`.

| plan | total | payments | label |
|---|---|---|---|
| `gold` | base × (1 − gold%) [default 20] | 1 | "Gold, paid in full (20% off)" |
| `silver` | base × (1 − silver%) [0] | `silverPayments` [3] | "Silver, 3 monthly payments" |
| `ext12` | base × (1 + 5%) | 12 | "Platinum, 12 monthly payments (+5%)" |
| `ext24` | base × (1 + 10%) | 24 | "Platinum, 24 monthly payments (+10%)" |
| `payg` | `rate` | 1 | "Bronze, pay as you go: 1 visit" |

`packageSizes` default [6, 12, 24]; `guarantee` flag when `n ≥ guaranteeMin` (12) and not payg. Installments are subscriptions that end themselves via a `subscriptionSchedule` with `end_behavior:"cancel"` after N months (created in the `checkout.session.completed` handler). The protocol row is written to `client.protocols[]` as `pending` **before** redirect, so an abandoned checkout leaves a pending row.

### 5.4 Non-Stripe paths

- **Membership request** (`POST /api/me/membership/request {tier, note, rewardCode?}`): stores `client.membershipRequest`, emails the owner "Membership request: <tier> ($X/mo)", who grants it in Admin (`PUT /api/admin/clients/:id/membership {tier, until}`). Granting keeps any existing Stripe ids on the record and consumes the review code.
- **Referral reward** (`applyReferral` at signup/login/Google with a valid `referralCode`): the **referrer** gets `membership = { tier:"member", until: max(now, current until) + 30 days, via:"referral-reward" }`. The new member gets nothing. `FREE_MONTHS = 3` is returned by `GET /api/me/referral` but is applied nowhere; `referrals` collection is read but never written.
- **Review reward**: any on-site review (`POST /api/feedback`) mints `MDFIT-XXXXXX`, `plans.reviewDiscountPct` (30) off the first month, single use (`rewardUsedAt`), stored on `client.reviewCode`. Used by Stripe (coupon `mdfit-review-30`, `duration:"once"`), by the request flow (`firstMonthDiscountPct`), and it unlocks the free `plan-review` 30-min appointment type in the booking engine.
- **Client type `inpatient`** (admin): admin-scheduled consults are `payment:"exempt"`.

### 5.5 Accountability credit (the behavioural pricing hook)

For the `member` tier only, on Stripe `invoice.created`: `days = unique calendar days in the billing period with ≥1 workout **or** ≥1 pain log` (`activityDays`); credit = `min(days × $1, amount_due)` added as a negative invoice item "Accountability credit: N active days". **20 active days = free month.** `GET /api/me/accountability` previews the current month `{ activeDays, threshold:20, price:19.95, credit, owed, free, month }`. Note this uses *workout-or-pain days*, not the habits "qualifying day" (§4.2) — a third definition of "active".

### 5.6 Webhook (`POST /api/stripe/webhook`)

Signature-verified on `rawBody`; idempotent via `stripeEvents` (last 1,000 ids); client resolved by `customer id → stripeCustomerId`, falling back to `metadata.clientId` / `client_reference_id`.

| Event | Effect |
|---|---|
| `checkout.session.completed` / `async_payment_succeeded` | skip if `unpaid`; consume review code; membership → receipt email "Welcome to <tier>"; protocol → `status: paid|active`, `paidAt`, `subscriptionId`, schedule end, owner email |
| `async_payment_failed` | protocol `status:"failed"` |
| `customer.subscription.{created,updated,deleted}` | membership: live if status ∈ active/trialing/past_due → `{tier, since, until:period_end, stripeSubscriptionId, status, cancelAtPeriodEnd}`, clears `membershipRequest`; else `membership=null`. Protocol installments: deleted → `paid` or `ended` |
| `invoice.created` | accountability credit (§5.5) |
| `invoice.paid` | installment `paid++`, → `paid` when complete; `subscription_cycle` → renewal receipt |
| `invoice.payment_failed` | owner + client emails |
| `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created` | owner alert, activity row |

`POST /api/me/billing-portal` → Stripe Customer Portal. `GET /api/me/payments` → `{ enabled, protocols, membership, hasBilling }`.

---

## 6. Pain tools

"Pain tool" is four things sharing one data model.

### 6.1 The pain log (server, `client.painLog[]`, ≤1,000)

`POST /api/me/pain { area ∈ AREAS, level 0–10, date? ≤ today, note ≤500 }` → `{ id, date, area, level, note, createdAt }`. `note` is field-level encrypted (`lib/phi.js`). `GET /api/me/pain` returns the sorted log; `DELETE /api/me/pain/:id`.

Consumers of the log:
- XP: 5 × first 3 per day (§2.1); badges `pain-5`, `pain-down` (first-logged level per area minus latest ≥ 3).
- Accountability credit: a pain-log day is an "active day" (§5.5).
- Progress tab: table + per-area SVG line chart; calendar `k-pain` dot; "Recent activity" rows ("Logged knee pain 3/10 · Better").
- Admin client detail: full log + `lastPain` on the client list.
- Search personalisation: the member's logged areas re-rank Home search results (`personal().painRegions`).

### 6.2 Body map → pain tracks (frontend, `painmap.js` + `paintracks.js`, data from `GET /api/content.tracks`)

- 32 tappable SVG regions over `assets/pain/body-figures.webp`, front/back, mirrored L/R.
- Tap → sheet "Tap the pattern that matches your pain" listing the region's **tracks** (26 built-in; admin can replace via `PUT /api/admin/content {tracks}` ≤80), each drawn by `painpatterns.js` as red ellipses (pain felt) and × (trigger point) on fixed 4:5 crops.
- A track = `{ id, title, region, img[], pts[muscleIds], note, levels[{ title, videos[{file,id|null,name}] }] }` — 139 video steps, 25 still "coming soon".
- Starting a track opens the player with key `track-<id>` → **50 XP** (program kind). Levels are meant to be followed in order; nothing on the server records which level a member is on.

### 6.3 Muscle reports → protocols (`musclereports.js`, 67 muscles)

`#pain/muscle/<id>` renders `{ origin, insertion, action, nerve, symptoms, questions[{q,w}], tests[{name,how,positive}], causes, mimics, redFlags, protocol{calm[],restore[],strengthen[]}, habits, expect, seePro }`. The self-check questionnaire is scored client-side (≥60% "strong match", ≥30% "possible"). "Start calm/restore/strengthen" → player key `painproto-<id>` (50 XP). "Save to My Programs" → `POST /api/me/programs`. "Log it" → `POST /api/me/pain`. Red flags are text only; nothing routes a red-flag answer anywhere.

### 6.4 Intake: Pain Assessment Initial Intake (`lib/intake.js` doc `pain`)

Required for every non-massage appointment: `complaint*`, `areas*` (14 sided areas, a *different* list from the app's 9 `AREAS`), `started*`, `how`, `painNow*` (0–10), `painWorst`, `painBest`, `feels[]`, `spreads`, `worse`, `better`, `timeOfDay`, `limits`, `treated`, `imaging`, `goals*`. Stored whole-document encrypted; readable only in Admin (audited `intake.open`). **It never feeds the pain log**, so the clinical baseline and the app's self-logged baseline are separate numbers.

### 6.5 Dormant code

`account.js` still carries an older area-chip pain flow (`PAIN.front/back`, `#areas`, `#muscle-map`, `GROUPS`) guarded by `if ($("#areas"))`; those elements are not in `account.html`.

---

## 7. Customization

What a member can shape, and where it lives:

| Surface | Stored | Limits / rules |
|---|---|---|
| **Workout generator** (`app/generator.js`) | `localStorage.mdfit_prefs3` only — the server never sees generator preferences | type workout/rehab; goal upper/lower/full/core/mobility; location home/gym/outdoor/office; level beginner 1–3 / intermediate 2–6 / advanced 4–8 / elite 6–9 (library difficulty bands); length 10/15/20/30/45/60/90 → preset `[perRound, rounds, restEx, restRound]`; add-ons warmup/cooldown/mobility/core/balance/sport/bodyweight; seeded LCG so "Today's workout" (`seed = date + clientId`) is stable all day; `swap()` one move |
| **Prescriptions** | code constants `PRESCRIBE[cat][level]` (e.g. Strength: 10/10/8/6 reps; Mobility: 30/45/60/45 s; Rehab: 8/8/10/12 slow reps) | not editable anywhere |
| **Workout builder** ("My workouts", `client.customWorkouts[]`) | server | ≤50 workouts, ≤30 exercises each, library ids only, sets 1–10, reps 1–100 **or** seconds 5–600 (timed default for stretch/hold/plank/breath/release); 35 XP when played |
| **Daily goal norm** | `habits.goalLog` | beginner/intermediate/pro, from today forward |
| **Daily activities list** | admin only (`habit-config`) | members can't add their own activities |
| **Player options** | `localStorage.mdfit.player.v2` | rest breaks on/off, sound; weights per circuit move → `lifts[]` on the logged workout |
| **Favorites** | `client.favorites[]` | ≤500 library ids; 2 XP ×5/day |
| **Pinned content programs** | `client.pinnedPrograms[]` | ≤12 ("Save to my dashboard") |
| **Leaderboard visibility** | `client.hideRank` | hides from board + challenge pool |
| **Profile** | `name`, `phone`, password (`pwv` bump invalidates sessions) | 5 XP once |
| **Vitals / check-in** | `client.vitals[]` ≤1,500, one row per date, merged | weight 50–800, sleep 0–24, restingHr 25–150, hrv 5–300, vo2max 10–95; batch import ≤400 days from a health app |
| **Admin-side personalisation** | `client.plan{guides[],exercises[≤30]{name,detail},notes ENC}` ("From Dr. Jared"), `assignedPrograms[≤12]{id, note ENC}` | emails the client on change |

The generator itself is **stateless on the server**: `POST /api/me/generations` is a legacy stub returning `{member:true}`; nothing about generated-but-unsaved workouts is stored.

---

## 8. Program saving

There are **five** separate "saved" lists on a client, each with its own endpoint, cap and XP consequence:

| List | Source | Endpoint | Cap | Player key | XP kind |
|---|---|---|---|---|---|
| `programs[]` ("My Programs" in `GET /api/me/library`) | a generated workout, or a muscle-protocol phase, saved via `POST /api/me/programs` (`programInput`: name ≤60 + compact workout `{title, goal, …, circuit[{id,sets}≤20]}`) | `POST/DELETE /api/me/programs[/:id]` | 50 | `program-<id>` | **normal (30)** — `program-` does not match `prog-`, so a saved generated workout is worth less than the content program it may have come from |
| `customWorkouts[]` ("My workouts", builder) | built by hand | `/api/me/custom-workouts` | 50 | `custom-<id>` | custom (35) |
| `pinnedPrograms[]` | content program ids | `PUT/DELETE /api/me/pinned/:id` | 12 | `prog-<id>-d<i>` / `-w<week>` | program (50) |
| `assignedPrograms[]` | admin `PUT /api/admin/clients/:id/programs` | read-only for the member | 12 | same as pinned | program (50) |
| `favorites[]` | library video ids | `PUT/DELETE /api/me/favorites/:id` | 500 | — | 2 XP action |

Content programs (23 built-in + admin-edited, ≤40) come from `lib/content.js`: `{ id, title, category (9), level, location, weeks, seed, access, summary, notes, image, sport?, days[{name, goal, length, rounds?, restEx?, restRound?, circuit?[{ex, sets}], seedOffset?}], resources[] }`. A day without a fixed `circuit` is generated on the client with `Gen.generate({fixed:true, seed: p.seed + seedOffset + i×101})`, so every member sees the same day-N workout. 17 of them also have week-by-week **protocol sheets** in `/data/protocols/<id>.json` (frontend-only data) rendered as `prog-<id>-w<weekKey>`.

**Progress** is not stored; `programProgress(assigned, workouts)` (admin view) and `protoCurrentWeek()` (member view) derive it from workout keys `prog-<id>-w*` / `-d*` in the log. There is no "enrolled on", "current week", "completed" state — only the keys of logged workouts. `programHistory[≤40]` keeps admin assign/unassign with notes.

---

## 9. Client → patient lifecycle

The code has no explicit state machine; the lifecycle is implied by which records exist. Reconstructed:

```
 visitor ──(lead form)──▶ lead {status new→contacted→booked→client→closed}        [leads collection, admin-managed]
    │
    ├─(signup / login-with-unknown-email / Google)──▶ client {clientType:"outpatient"}   [clients]
    │        ▲ login auto-creates an account for an unknown email (201) — signup and login are the same door
    │
    ├─(books, public or in-app)──▶ appointment {email, clientId? , status booked}        [appointments]
    │        clientId is set ONLY when a signed-in member books with their own email, or admin schedules it;
    │        the member app matches appointments by EMAIL, intake "on file" matches by clientId
    │
    ├─(intake link in booking email, or /account "Become a patient")──▶ intake docs      [intakes, encrypted]
    │        docs per appointment: info, pain (or massage), history, consent (e-signed)
    │        member-completed docs live on client.docs and count for every appointment linked by clientId
    │
    ├─(admin marks visit "completed")──▶ 50 XP + first-visit badge; accountability "visit" rows
    │
    ├─(admin)──▶ clientType "inpatient" → consults payment:"exempt"; plan{guides,exercises,notes}; assignedPrograms
    │
    ├─(member)──▶ messages thread with Dr. Jared (encrypted), reactions, broadcasts
    │
    └─(pay or request)──▶ membership {tier, since, until, …} / protocols[] / meetings[] (premium)
```

Key facts:
- **Identity is the email.** Appointments, visits-for-XP, Google Calendar names and class bookings all key on `email`; `clientId` is a best-effort link. Changing an email in Admin silently detaches history.
- `pub(c)` (what the app stores in `localStorage.mdfit_client`) = `{ id, email, name, firstName, lastName, phone, createdAt, plan, membership (active only), referralCode, hasPassword, google, clientType, assignedPrograms, pinnedPrograms }`.
- "Become a patient" in the app = `GET/POST /api/me/intake[/:doc]` for the standard (eval) packet; completion emails the owner "Documents completed".
- Admin client detail (`GET /api/admin/clients/:id`) is the practitioner's view: `lastLoginAt, painLog, documents, programProgress, programHistory, workouts[≤50], stats, rewards{xp,level,title,gem,overall,badges}, appointments`. Every view is audited.
- Deleting a client deletes their messages; appointments, intakes, challenges and habits rows stay (orphaned by id/email).

---

## 10. Activity: feeds, calendar, realtime

### 10.1 Server activity feed (admin)

`activity(type, detail)` prepends `{ time, type, …detail }` to the `activity` collection (cap **500**), logs it, and emits socket `activity` (+ `toast` for `appointment, appointment_cancelled, lead, booking, message, subscribe, bug_report, suggestion, feedback`) to `/admin`. ~40 types (`client_signup`, `checkout_started`, `membership_receipt`, `challenge_sent`, `client_programs`, `cal_BOOKING_CREATED`, …). Payloads are sanitised (`password`, `token`, `cancelToken` stripped). It is an operational log for the owner, not a member-facing feed.

### 10.2 Member "activity" (derived, client-side)

The Home "Recent activity" list is assembled in `account.js` from three API responses: `stats.recent` (last 10 workouts), `painLog.slice(-5)`, `appts.past` (non-cancelled), merged and sorted, top 5. The Progress calendar (`dayItems`) does the same per day from `allWorkouts`, `appts`, `painLog`, and `account-habits.js` paints qualifying/repaired/missed from `/habits/history`. There is no server endpoint that returns "what happened on day D"; four endpoints are joined in the browser.

### 10.3 Realtime (`lib/realtime.js`, socket.io path `/ws`)

Member namespace receives `new_message {from:"doctor",at}`, `message_reaction {id}`, `slots_changed {date}`; sends `viewing <page>` so Admin → Online shows who is on which tab. Admin namespace gets `online_count`, `activity`, `toast`, `calendar_changed`, `new_message`, `message_reaction`. No XP/rank events are pushed; rewards are pull-and-diff (§2.5). Single process, in-memory presence — no adapter.

### 10.4 Notifications

Email (Resend) for bookings, messages, plan/program changes, receipts, failed payments. In-app: bell panel with live rows (visit ≤2 days, plan updated ≤7 days, streak at risk via `stats.streak && !stats.week[today]`), bottom pop-ups (reward/level/message/visit), milestone overlay. All in-app notification state is `localStorage`; a second device starts from zero.

---

## 11. Cross-cutting

- **Auth:** HMAC-SHA256 tokens (not JWT), `{ sub, role:"client", pwv, exp }`, 30 days; `requireClient` reloads the client every request and checks `pwv`. Admin: scrypt password + optional email MFA, 12 h.
- **Encryption:** whole-file AES-256-GCM (`DATA_ENC_KEY`); field-level for `painLog[].note`, `plan.notes`, `assignedPrograms[].note`, `programHistory[].note`, appointment notes, lead messages, review text; whole-document for messages, intake answers, bug reports. Key rotation by trying multiple keys on decrypt.
- **Audit ledger:** hash-chained, Ed25519-signed entries for every admin view/change, logins, webhooks, intake open/submit; daily anchor emailed to the owner.
- **Rate limits:** global burst 240/10 s per account (120 per IP), steady 3,000/10 min; per-route limiters (messages 40/h, pain-free forms 20/h, etc.).
- **PHI discipline:** no health details in emails, Stripe product names, Google Calendar, analytics, logs, push, challenge payloads, or the leaderboard.
- **Store:** every write is full-file read-modify-write; concurrency safety is "re-read after any `await`" discipline in a handful of places (`ensureCustomer`, webhook handler).

---

## 12. Drift, dead code and gaps

| # | Finding | Where |
|---|---|---|
| 1 | Three streak definitions and two repair wallets that don't see each other (§4.3–4.4) | `habits.streaks`, `rewards.repairsFrom`, `clients.workoutStats` |
| 2 | Two daily goals: `rewards.DAILY_GOAL=30` (goal ring, total XP) vs habits norm 50/75/100 (activities+workouts only) | `rewards.js:24`, `habits.js:52` |
| 3 | Three definitions of "active day": qualifying (habits), workout-or-pain (accountability credit), workout (stats/badges) | §4.2, §5.5, §4.4 |
| 4 | Olympic threshold moved from 1,250 to 2,501 with the new ladder; comment and HANDOFF still say 1,250 | `clients.js:585–586` |
| 5 | Pacers are not flagged in member JSON; members may challenge-pick real people only, but the board shows fakes as people | `clients.js:596–620` |
| 6 | `FREE_MONTHS=3` reported, never applied; `referrals` collection read, never written; new referee gets nothing | `clients.js:32,108–120,556–567` |
| 7 | `habits.qualifyingDays()` exported "for membership credits" but unused; accountability uses `payments.activityDays` | `habits.js:166`, `payments.js:37` |
| 8 | Saved generated workouts (`program-<id>`) earn 30 not 50; content programs earn 50 — same exercises, different XP | `custom-workouts.js:52–57` |
| 9 | Content access levels exist (`free/member/premium`) but everything is served `locked:false`; paywalls are frontend-only | `content.js:528–533` |
| 10 | Intake pain assessment (14 sided areas) and app pain log (9 areas) are disjoint; baseline never reaches the app | `intake.js:26`, `clients.js AREAS` |
| 11 | Program progress/enrolment is inferred from workout keys; no enrolled/current-week/completed state | §8 |
| 12 | Member-side activity timeline and calendar are joined in the browser from 4 endpoints | §10.2 |
| 13 | Rewards and the leaderboard recompute every member's full history on each cache miss; JSON-file store, single process | §3.1 |
| 14 | Email is the identity key for appointments/visits; `clientId` is best-effort | §9 |
| 15 | Protocol checkout writes a `pending` row before redirect; abandoned checkouts accumulate | `payments.js:157–161` |
| 16 | Red-flag answers in muscle reports and intake are not routed anywhere | §6.3–6.4 |
| 17 | Dormant area-chip pain flow in `account.js` | §6.5 |
| 18 | All in-app notification/celebration state is `localStorage`; nothing is "seen" across devices | §10.4 |

---

# Part 2 — The ideal app

Same headings. Each section says what to **keep** (the things the current code gets right), what to **unify**, and what to **add**. The guiding constraints: it is a clinic, not a game — every mechanic must push toward *doing the rehab* and *getting better*, and nothing may leak PHI.

<a id="p2-1"></a>
## 1. The shape of the system

**Keep:** facts-not-scores. The recompute model is the right architecture; it is what makes the gamification un-gameable and lets rules change retroactively. Keep the edge gate, the PHI discipline, the audit ledger, Stripe-webhook-only fulfilment.

**Unify:** replace the JSON-file store with Postgres (BAA-covered; Railway Postgres or Neon) and model the history as an **append-only event ledger**:

```sql
events(id, client_id, date_clinic, at, type, ref, payload jsonb, source)   -- workout, pain, activity, visit, action, vital, challenge_sent, …
```

Every module today already emits exactly these events in memory inside `rewards()`; persisting them is the change. Materialise `client_day(client_id, date, xp_total, xp_workouts, xp_activities, qualifying, active)` with a trigger or a nightly job so leaderboards, streaks and credits read one table.

**Add:** a `rules` table versioned by date (`XP`, `GEMS`, `GOAL_LEVELS`, `ACTIONS`, league thresholds) so the owner can change values in Admin and history is re-scored with the rules in force *on each day* — today a ladder change rewrites everyone's past.

<a id="p2-2"></a>
## 2. The XP engine

**Keep:** the value hierarchy (program 50 > custom 35 > normal 30), "best workout of the day counts", frozen activity points, server-decided `kind`, per-day caps on app actions, +25 badge bonus.

**Unify:**
- One daily goal. Delete `DAILY_GOAL=30`; the goal ring reads the member's norm (50/75/100) against the *same* "counts toward goal" sum the habits card uses.
- One "active day" definition used by streaks, the accountability credit and badges: **qualifying day** (activities + workouts ≥ norm). Make the credit read `client_day.qualifying`.
- Saved generated workouts and content programs: same XP when the saved workout *came from* a program (carry `sourceProgramId` on save); otherwise 30 is right.

**Add (the Duolingo features that fit a clinic):**
- **Adherence multiplier instead of "double XP"**: a member on an *assigned* program earns 50 for the scheduled day's workout, 30 for an unscheduled one — rewards doing the prescribed thing, not just doing something.
- **Rest-day credit**: a day in a 6-week protocol that prescribes rest qualifies automatically if ≥1 recovery activity is checked (the code already has `recoveryOnly`; make it count).
- **Pain-down XP**: +10 when a weekly average for an area drops ≥1 point vs. the previous week (capped once/week/area). Today only a one-off badge rewards improvement; improvement is the actual product.
- **XP ledger view** for the member: "where did today's 85 XP come from" — the data exists (`todayParts`); expose the per-event list.
- Push the celebration from the server: a `rewards_delta` socket event after any write, so the client stops diffing.

<a id="p2-3"></a>
## 3. User rankings

**Keep:** "First L." names, hide-me, private overall rank, pacers as a concept (empty boards are demotivating), 60-s cache with change-stamp, the challenge payload containing nothing but exercises.

**Unify:** leagues on **weekly** XP in cohorts, Duolingo-style, instead of lifetime-XP tiers:

```
Cohorts of ≤30 formed every Monday 00:00 clinic time, seeded by last week's league.
Leagues: Bronze → Silver → Gold → Emerald → Olympic (5).
Top 7 promote, bottom 5 demote, Olympic has no promotion and a demotion zone only.
Gems stay lifetime and permanent (status); leagues are weekly (competition).
```

This separates *status* (gem, never lost — good for a rehab population) from *competition* (league, resets weekly — keeps the board fresh for everyone, not just the top 10 lifetime). Keep the current Pro/Olympic split as the two upper bands so nobody loses standing on migration.

**Add:**
- Mark pacers honestly: `pacer:true` in JSON and a subtle "practice pacer" label. A clinic should not show patients fake people.
- Cohort placement by **norm**: beginners (50) are never cohorted with pros (100) in their first 4 weeks.
- Challenge upgrades: accept/decline, a 7-day expiry, a "rematch" that sends it back, and **friend streaks** (both members qualify 3 days running → +5 each) — the social mechanic with the best retention evidence and zero PHI.
- Team leaderboard per clinic cohort (e.g. "Post-op knee, Nov 2026") so people on the same protocol see each other.

<a id="p2-4"></a>
## 4. Streaks, daily activities, repairs

**Keep:** the habits streak model A (auto-bridging, ledger, grants, "today is never missed"), frozen points, one check per activity per day, norm changes apply forward only.

**Unify:** delete model B (`repairsFrom`, `repairsUsed`, `POST /repair-streak`) and `stats.streak`. One streak = qualifying days; one wallet = `habits.repairs`. The `streak-3/7/30` badges read it. The Progress calendar's "Use 1 repair" button becomes informational ("bridged automatically") or is removed.

**Add:**
- **Streak at risk** push/email at the member's chosen hour (default 7 PM clinic time) when `!qualifying && remaining ≤ 30` — the single highest-ROI Duolingo mechanic, missing today.
- **Member-defined activities** (≤5, 5 XP each, admin-approvable) — "I do my PT exercises in the pool" is real and currently unrepresentable.
- Repair cap (3 banked) and weekly repair earn cap, so a 90-day streak doesn't bank 30 freezes.
- Vacation mode (admin or self, max 14 days/yr) that pauses rather than bridges.

<a id="p2-5"></a>
## 5. Payment systems

**Keep:** webhook-only fulfilment, idempotency, dynamic payment methods, embedded checkout, server-side quotes, the accountability credit (it is the clinic's best idea), the request fallback when Stripe is off.

**Unify:**
- Make access levels real: serve `locked:true` for `member`/`premium` content to level-0 clients, with a generous free tier (every pain track, every rehab protocol first week, the generator). Today the paywall is a UI suggestion.
- Accountability credit reads `client_day.qualifying` (one definition), is previewed live on the gem card ("$14 off next month so far"), and the invoice line says the days.
- Referral: implement what the copy promises — referee gets 1 free month of `member`, referrer gets +1 month per referee up to `FREE_MONTHS`, write the `referrals` rows.
- Protocol `pending` rows expire after 24 h if the session is `expired`.

**Add:**
- **Native IAP path** for the $19.95 digital membership on iOS/Android (StoreKit / Play Billing) with a server-side receipt validator writing the *same* `membership` record; services and protocols stay on Stripe (real-world services).
- Protocol visit ledger: each `completed` appointment of the matching service decrements `protocol.remaining`; show "4 of 12 visits used" to member and admin; warn at 2 left.
- Family/household plan and a "sponsor a patient" gift code — common in cash-pay rehab.

<a id="p2-6"></a>
## 6. Pain tools

**Keep:** body map → referred-pain tracks → player, muscle reports with self-checks, pain-note encryption, "Log it" everywhere.

**Unify:**
- One area taxonomy (sided, 14) shared by intake, pain log, tracks and muscle reports. Migrate the 9 app areas with a mapping table.
- Intake `painNow/painWorst/painBest` per area become the **first pain-log entries** for that client (source `intake`), so the app's chart starts at the clinical baseline.
- Track progress state: `track_enrolment(client, track, level, started, last_played)`; "continue Level 2" on Home; 50 XP only for the current or next level (no farming Level 1).

**Add:**
- **Outcome measures**: a 3-question PROM per area every 7 days (pain now, worst this week, function 0–10) with a trend line; this is what a clinician needs and what justifies the membership medically.
- **Red-flag routing**: any red-flag "yes" (intake or muscle report) → admin toast + email "Red flag answered", member sees "Dr. Jared will reach out", and the self-check stops recommending a protocol.
- Pain heat-map over time (per-area average per week) on Progress; share-to-doctor button that pins it to the message thread.
- Aggravator tracking: the `AGGRAVATORS` list exists in `painmuscles.js` but isn't logged; log them with each entry and show "worse after sitting ×4 this week".

<a id="p2-7"></a>
## 7. Customization

**Keep:** the generator's deterministic seeding, the builder's limits, admin-only activity list (clinical control), vitals batch import.

**Unify:** move `mdfit_prefs3` and `mdfit.player.v2` to the server (`client.prefs`) so preferences follow the member across phone/tablet/native. Store generated-but-unsaved "Today's workout" server-side too, so Home is identical on every device.

**Add:**
- **Equipment profile** (what I own at home: bands, DB up to 30 lb, pull-up bar) replacing the coarse `location` + `bodyweight` add-on; `needsGym()` becomes `needs(profile)`.
- **Adaptive prescription**: `PRESCRIBE` becomes a per-client overlay driven by last RPE (≥8 → −1 rep tier next time), last pain log for the targeted area (≥6/10 → rehab Rx), and the clinician's `plan.exercises` overrides. The data is already collected (RPE, HR, pain); nothing reads it.
- Clinician-editable prescriptions in Admin (today `PRESCRIBE` is a code constant).
- Exercise swap memory: "never show me burpees" (per-client exclusion list), and "I liked this" feeding the generator's weighting.

<a id="p2-8"></a>
## 8. Program saving

**Keep:** server-side library (follows the member), caps, admin assignment with encrypted notes and history, deterministic program days.

**Unify:** one **Library** model with a `kind` instead of five lists:

```
library_item(id, client_id, kind ∈ {saved, custom, pinned, assigned, favorite}, ref, name, body jsonb, source_program_id, created_at, assigned_by, note_enc)
```

and one **Enrolment** model giving programs real state:

```
enrolment(id, client_id, program_id, started_on, schedule (days/week), current_week, current_day, status ∈ {active, paused, completed}, completed_on)
```

Workout keys stay (`prog-<id>-w3-d2`) but are *written from* the enrolment, not parsed back out of the log. "Continue week 3" on Home; adherence % per program for the clinician; auto-complete and a completion badge; `assigned` items create an enrolment on acceptance.

**Add:** versioning of content programs (members on v1 finish v1 when the admin edits), "schedule this program" onto the calendar with reminders, and program templates the clinician can clone per patient from an assigned program (the `plan.exercises` free-text list becomes a real program).

<a id="p2-9"></a>
## 9. Client → patient lifecycle

**Keep:** separate client type, encrypted intake packet, "Become a patient" in-app, audited admin views, the booking-link and consult tools.

**Unify:** an explicit state on the client, derived at first and then owned:

```
lead → account → booked → intake_complete → patient (first completed visit) → active_patient / member / alumni (no visit or login 90 d)
```

with `client_id` as the only key: appointments get `client_id` at booking time by email match (backfill once), and a change of email in Admin re-links rather than detaches. Admin list gets a funnel view (how many at each stage, conversion per week).

**Add:**
- Onboarding sequence driven by state: account → "pick your norm, log your first pain, try a 10-minute workout"; booked → intake nudges with countdown; patient → assigned program + first message from the doctor pre-filled.
- Care-plan object owned by the clinician (`goals`, `measures`, `next review date`) that the gem card references ("Goal: stairs without pain by Dec 15"). Today `plan` is free text.
- Discharge/alumni mode: keeps the gem, drops to the free tier, monthly check-in PROM, re-engagement email with the referral code.

<a id="p2-10"></a>
## 10. Activity

**Keep:** the admin activity feed and toasts, presence by page, sanitised payloads.

**Unify:** one `GET /api/me/timeline?from&to` returning the event ledger rows (§P2-1) with XP attached, so Home "Recent activity", the Progress calendar and the habits paint read one source. Server-pushed `rewards_delta`, `streak_at_risk`, `challenge_received`, `program_assigned` socket events; notification "seen" state stored server-side (`notifications(client_id, kind, ref, seen_at)`), so devices agree.

**Add:** a weekly recap (email + in-app card) — XP, qualifying days, pain trend, league result — generated Sunday night from `client_day`; it is the retention email Duolingo sends and the clinical summary the doctor wants.

<a id="p2-11"></a>
## 11. Cross-cutting

- Postgres with row-level encryption for PHI columns (keep the field-level cipher), BAA'd hosting; keep the audit ledger but write it to the same DB.
- Background jobs (cohort formation Monday 00:00, weekly recap, streak-at-risk at the member's hour, pacer refresh) in a worker, not `setInterval` in the web process.
- Rate limits keyed by account first (apps share carrier NAT IPs); raise clinic-tablet forms.
- Native apps: APNs/FCM push with no PHI; Sign in with Apple; `minAppVersion`.
- Feature flags per rule change (`rules` table) so a new ladder can be previewed in Admin before it goes live.

<a id="p2-12"></a>
## 12. Migration order (each step ships alone)

1. **Unify the goal and streak** (delete model B and `DAILY_GOAL`; read norms everywhere). Pure backend + two frontend labels. Fixes Drift 1–3.
2. **Pacer flag + Olympic comment/HANDOFF fix.** Trivial.
3. **Referral and access levels made real.** Fixes 6, 9.
4. **Event ledger + `client_day` in Postgres**, dual-written next to the JSON store, then flip reads. Fixes 12, 13.
5. **Enrolment + Library models**; keep old keys working. Fixes 8, 11.
6. **Weekly league cohorts** on top of `client_day`.
7. **PROMs, red-flag routing, unified area taxonomy.** Fixes 10, 16.
8. **Server-side prefs, notifications, timeline endpoint**, socket deltas. Fixes 18.
9. Native apps.
