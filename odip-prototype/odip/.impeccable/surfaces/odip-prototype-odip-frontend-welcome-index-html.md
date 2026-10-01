---
version: 1
slug: "odip-prototype-odip-frontend-welcome-index-html"
primary_target: "odip-prototype/odip/frontend/welcome/index.html"
related_targets: []
---

# Surface brief: Odip public landing page (/welcome/)

## Scope and mode
The public, signed-out landing page, its own Vite HTML entry at /welcome/ (welcome/index.html). The app, the login page and the signed-in experience are untouched; signed-out visitors to exactly "/" are sent here by a tiny classic script, and Sign in always goes to /login. Mode: Persuade.

## Audience, job, action
- Audience: operations leads and coordinators at Australian NDIS providers that run supported holidays, group trips or short-term accommodation; also Oassist staff who only want to sign in.
- Job: show in seconds what Odip is and why it is different, prove it with the real product, turn interest into an early-access request.
- Action: Request early access (name, organisation, email). Secondary: Sign in.

## Proof and content
Real screens showing sample data (each labelled "Sample data"), "Oassist: a registered NDIS provider of supported holidays. Odip was built here.", and numbers counted from the code: 18 roster checks, 11 incident types, 5 tracked credentials, 3 funding types, 25 audited record types. No customers, testimonials, pricing, press, logos or ratings. Claims come only from the confirmed brief's safe list; its DO NOT CLAIM list holds (no integrations, no PRODA connection, no 5-day rule or live timers, no complaints register, no offline mode, no data residency, no e-signing, no reconciliation, no SMS, no per-traveller beds).

## Constraints
CSP: same-origin scripts only, no inline script, images from self/data/blob, fonts from Google Fonts, fetch to self. WCAG 2.2 AA, keyboard-complete, 44px targets, plain language. Reduced motion shows every fold open and static. Light first load: about 3 KB gzip of JavaScript, WebP at 1x and 2x, lazy below the fold.

## Direction and memorable moment
Tourist Drive: Australian road wayfinding (seed 9680af9b, staging "folding volume"). Green guide signs with white Overpass lettering carry the offer, white-on-brown tourist signs mark the six stops, blue service signs are only for Sign in; the country carries the nature brief in authored SVG. The memorable moment is the green guide sign over the road into the ranges, read in one second, then the concertina-folded strip map that unfolds stop by stop while the distance marker counts down to "Early access 0 km".

## Unresolved decisions
- Notification email (config EarlyAccess:NotifyEmail): pre-release, not set.
- Collection notice: collector identity and privacy contact are pre-release; a neutral notice ships.
- Public hostname and TLS: the site is LAN-only today.
- Recapture the screens after the dashboard redesign and the navigation regroup; re-verify every number and claim against the code on the release commit.
- The early-access API is built on another branch (contract: 202 / 400 / 429 / 500).
