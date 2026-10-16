# Landing page release checklist

The public landing page lives at `/welcome/` (its own Vite HTML entry, `welcome/index.html`): Bunya Support's alpha page, "The admin day, before and after". Work through this list before it is reachable from the public internet. Items marked PRE-RELEASE are placeholders left on purpose.

## 1. The sign-up contract

- [ ] `POST /api/public/early-access` is deployed with the page, in the same release: the API now refuses a missing or blank `organisationSize` (400 keyed `organisationSize`, "Choose your organisation's size."). An old page left open in a tab sends no size and is told to check the fields until it is reloaded.
- [ ] The body cap is 8 KB (`EarlyAccessController.MaxBodyBytes`, landing PR 1); the largest valid form fits under it. Over the cap is 413, which the page shows as the server-error line.
- [ ] On a 400 the page shows the server's own text for each field it names (keys matched in any casing), so a server message change shows on the page with no page change.
- [ ] Send one sign-up through the live form and see 202 and the received panel; send it again with the same email and see the same panel.

## 2. PRE-RELEASE: where sign-ups are emailed

- [ ] Set `EarlyAccess:NotifyEmail` (API side) to the address that should hear about new sign-ups. Nothing on the page needs to change.
- [ ] SMTP must be configured on the server (`Notifications:Smtp:*`). Without it the sign-up is stored and logged with a masked email, but nobody is told. The page already says no confirmation email is sent.

## 3. Claims (spec L4)

- [ ] Every line on the page is a shipped feature (SURVEY section 2). `welcome/page.test.ts`, describe "claims (spec L4)", pins the never-claim list: compliant, certified, guarantee, Xero, Brevity, Splose, ShiftCare, payroll, a family portal, a complaints register, PRODA or NDIA submission, Commission reporting, a 5-day rule or countdown, SMS, offline, e-sign, reconcile, pricing, free, testimonials, "every change", rooms, AI. Employment Hero is named once, as "Syncs staff from Employment Hero, if you use it."
- [ ] Any new copy line is checked against SURVEY section 2 in the same PR, and the alt text in `capture/shots.mjs` passes the same regexes (`certif` catches "certificate", `e-?sign` catches "design").

## 4. Privacy (spec L6)

- [ ] The collection notice under the button is the owner's wording; `page.test.ts` pins it word for word and checks no email address appears anywhere on the page.
- [ ] The retention promise ("until the alpha ends, for 12 months at most, or delete them sooner if you ask") is kept by PR 1's 12-month purge and the SuperAdmin Delete in Settings, Alpha sign-ups.
- [ ] `legalPublished` in `src/lib/platformInfo.ts` stays false until the owner supplies the Privacy Policy and Terms; it then shows the Legal links and the notice's last sentence.
- [ ] When a support email exists, it replaces the notice's "send the form again and say so in the message" line, and `supportEmail` shows the footer's Support column.

## 5. Public hostname and TLS

- [ ] The site is LAN-only on port 8475 today. Choose the public hostname, terminate TLS in front of the nginx container, and confirm HTTPS (the site already sends HSTS).
- [ ] Check `/welcome` redirects to `/welcome/` without losing the host or port (`absolute_redirect off;` is set in `nginx/default.conf`).
- [ ] Check the signed-out visit to exactly `/` lands on `/welcome/`, and that `/login` and every deep link still behave as before.
- [ ] `nginx/default.conf` turns gzip on for text, CSS, JS, JSON and SVG. If the proxy in front of the container already compresses, remove that block. Check the live response carries `Content-Encoding: gzip` exactly once.
- [ ] PRE-RELEASE: real client IPs. The API partitions its rate limits (the public early-access endpoint included) by the client address it gets after `UseForwardedHeaders()`, which trusts the `X-Forwarded-For` that nginx sets (`Program.cs`). If a public proxy sits in front of nginx, every visitor would share one limit: set nginx's `real_ip` module (`set_real_ip_from` the proxy, `real_ip_header X-Forwarded-For`), and run `deploy/probe-partition-key.sh` from a machine that is not the docker host.

## 6. Recapturing the product screens

The 11 screens and their 7 narrow `-m` crops in `welcome/assets/screens/` are the mock API's fictional sample data, shot by driving the real UI. `manifest.json` records each one's route, role, crop and whether a `page.route` fixture fed it (`fixture: true`).

- [ ] Probe (server): `SHOT_PROBE=1 bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/server-shots.mjs <outdir>`. Look at every `probe-*.png` and `probe.json`; add a fixture only where the mock can't give the state.
- [ ] Shoot (server): the same command without `SHOT_PROBE` (set `SHOT_NAMES=a,b` to redo a few). `shots.log` says OK for each shot with no page problems.
- [ ] Encode (this PC, no browser): `PYTHON="C:/Users/Work/AppData/Local/Microsoft/WindowsApps/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/python.exe" node welcome/capture/capture.mjs --encode <outdir>`. The Store Python 3.13 has Pillow; `py -3` does not. Every line OK and none over budget (1x 90 KB, 2x 260 KB).
- [ ] Honesty rules (`capture/capture.mjs` header): fictional people only, a pinned clock, no DOM edits. Look at every PNG before encoding: the state is visible, no spinner or error, and no trip vocabulary in the frame (the app's top bar reads "Search trips, participants", so crops stay below it).
- [ ] After a recapture, copy each changed width, height and alt from `manifest.json` into its `<img>` and `<source>` in `index.html`; `page.test.ts` fails until they match.

## 7. The numeric checks and the motion review

Both run before any page change ships.

- [ ] `bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/page-checks.mjs <outdir>`: every `CHECK` line PASS (overflow, text floor, tap targets, contrast, h1, the first viewport, arrivals, the rail, the worst case, text at 200%, reduced motion, anchors, figures, the deep link and fonts), plus the form-state and viewport captures for review.
- [ ] `bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/motion-review.mjs <outdir>`: the slowed frames and videos of each animation, reviewed against SHAPE section 9.
- [ ] `bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/weight.mjs <outdir>`: the page's own built JS (every chunk the page loads, platformFacts included) at most 10 KB raw (10,240 bytes) and 4.5 KB gzip (4,608 bytes).
- [ ] Re-check the two font-preload URLs in `welcome/index.html` (Plus Jakarta Sans v12 and Manrope v20 Latin files, checked on 2026-10-17) against the CSS the page links; a stale hint still downloads.

## 8. Owner items still open (SHAPE section 13)

- [ ] #1: the notice's "seen only by our team, and used for nothing else", and the company name once the business is registered.
- [ ] #2: organisation size as four bands by staff count, or by participants.
- [ ] #3: the tone of the "before" lines.
- [ ] #5: the email row in "What alpha means" stays until SMTP is configured.
- [ ] #6: photography (none now); consented photos from an alpha provider later.
- [ ] #7: the day-plan footnote, "The times are a sample day; your day will run its own way."

## 9. Deferred

- [ ] OG tags, a canonical URL, robots and a sitemap wait for a public hostname (spec L8).
- [ ] The site has no analytics. Adding any needs a CSP change in two places (`welcome/index.html` and `nginx/default.conf`) and a mention in the collection notice.
