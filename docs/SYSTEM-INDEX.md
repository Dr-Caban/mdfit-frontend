# MD Fit — System Index

Every moving part of the MD Fit platform, what it does, and where its keys live.
All credentials live in Vercel and Railway environment variables only — never in the repositories.

## Hosting

**Vercel — frontend host.** Serves the static site at www.mymdfit.com from `Dr-Caban/mdfit-frontend`.
Deploys automatically on every push to `main`. `middleware.js` proxies all `/api/*` requests through to
the Railway backend (default target `amiable-peace-production-e382.up.railway.app`), so the browser only
ever talks to one origin.

**Railway — backend host.** Runs the Express 5 API from `Dr-Caban/mdfit-backend` with a JSON file store.
Railway does **not** auto-deploy: after each push the service source has to be reconnected to trigger a
build. That manual trigger is the one step that differs from the frontend.

## Source control — GitHub

| Repository | Push to `main` triggers |
|---|---|
| `Dr-Caban/mdfit-frontend` | Vercel builds and publishes automatically |
| `Dr-Caban/mdfit-backend` | Railway deploy must be triggered after the push |

House rules before committing: run `scripts/version-assets.js` after any CSS/JS change; SEO pages are
generated, so edit the data then run `scripts/seo/build.js` and `scripts/seo/check.js`; work on a branch,
open a pull request, check the Vercel preview, then merge — one session merging at a time.

## Media library

**Cloudinary — what the app streams.** `lib/videos.js` syncs from `data/media-manifest.json` (built by
`scripts/build-media-manifest.js`): every video and image is copied in with its organized path, display
name, tags and metadata. Files above the plan's 100 MB limit are re-encoded to phone-friendly 720p H.264
first. Keys: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

**Bunny Stream — where the videos are moving.** Cloudinary bills in credits (1 credit = 1 GB stored or
delivered); at ~200 videos and real member traffic that reaches the $99/mo Plus tier, and $249/mo Advanced with a
few hundred members. Bunny bills $0.01/GB for both storage and delivery, which puts the same library at a few
dollars a month. Transcoding, the player and the security features are included. Images stay on Cloudinary, whose
free tier covers them with room to spare (the whole image set is well under 100 MB).

| | |
|---|---|
| Library | MDfit |
| Library ID | 805934 |
| CDN hostname | vz-03938ec5-16f.b-cdn.net |
| Pull zone | vz-03938ec5-16f |

Keys: `BUNNY_STREAM_API_KEY` (library-scoped, Railway only), `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_HOSTNAME`.
Uploads use Bunny's resumable TUS API, which suits the big source files better than the current path (it buffers whole
files into memory and has pushed the Railway container to its 1 GB ceiling). Turn on **MP4 Fallback** in the library
so the app can keep using a plain `<video>` element instead of shipping hls.js, and **Token Authentication** so the
stream URLs are not playable by anyone holding the link.

**Google Drive — the library of record.** The original footage (384 videos) lives in Drive, named by the
movement spoken at the start of each clip. The player falls back to a Drive preview iframe if Cloudinary
stalls, so Drive file sharing has to stay intact. Renaming and moving files in Drive is safe — the app
keys off Drive file IDs, which never change.

## Payments — Stripe

`lib/payments.js` builds checkout sessions via `serviceCheckout()`, carrying metadata
`{kind, service, clientId, apptId}`. The webhook turns a held appointment into a confirmed booking and is
idempotent through the `stripeEvents` ledger. Visit checkouts expire after 30 minutes, which releases the
held slot. Prices: evaluation **$150** (60 minutes), follow-up **$80** (30 minutes).
Keys: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Messaging

**Resend — outbound email.** `lib/notify.js` sends booking confirmations, payment receipts, one-time codes
for password set-up and reset, and owner notifications. It stays off unless `RESEND_API_KEY` and
`NOTIFY_FROM` are set; endpoints answer 503 "Email isn't configured" until then. No patient health
information goes into email.

**Internal messaging — the platform's own.** Separate from Resend: encrypted message threads between the
owner and each client, encrypted at rest and delivered live over socket.io (`lib/realtime.js`). This is
the channel that carries anything clinical.

## Scheduling and video visits

**Built-in scheduler (default).** Open slots, then hold → Stripe checkout → confirm, with release on
expiry, so the video room can never be double-booked. Every step is written into the EMR chart
chronologically.

**Cal.com API v2** (`lib/cal.js`, `CAL_API_KEY`) is the alternative scheduling provider — settings select
`builtin` or `cal`. It is kept alongside the internal messaging and video-visit plumbing because it
handles external booking pages and two-way calendar sync; the meeting link is read off the Cal booking
(`meetingUrl`, `videoCallUrl`, or the location field).

**The video room itself** is a link in settings (`booking.telehealthUrl`, validated by `meetingUrl()` in
`lib/validate.js`) — a Zoom or equivalent room pasted in once, which the scheduler then protects from
double-booking.

## Environment variables the backend reads

`STRIPE_SECRET_KEY` · `STRIPE_PUBLISHABLE_KEY` · `STRIPE_WEBHOOK_SECRET` · `CLOUDINARY_CLOUD_NAME` ·
`CLOUDINARY_API_KEY` · `CLOUDINARY_API_SECRET` · `RESEND_API_KEY` · `NOTIFY_FROM` · `CAL_API_KEY` ·
`INTAKE_ENC_KEY` · `MESSAGE_ENC_KEY` · `FEEDBACK_ENC_KEY` · `GOOGLE_CLIENT_ID` · `APPLE_SERVICES_ID` ·
`APPLE_APP_IDS` · `PORT` · `NODE_ENV` · `LOG_LEVEL`

## Flow at a glance

```
  developer push
        │
        ├─ mdfit-frontend ──> Vercel ──> www.mymdfit.com ──┐
        │                                                   │  /api/* proxied
        └─ mdfit-backend  ──> Railway (manual trigger) <────┘
                                  │
          ┌───────────────┬───────┼─────────────┬──────────────┐
      Cloudinary       Stripe   Resend      socket.io       Cal.com
      (streaming)    (payments) (email)   (live messaging) (ext. booking)
                                  │
                           Google Drive
                        (original footage)
```
