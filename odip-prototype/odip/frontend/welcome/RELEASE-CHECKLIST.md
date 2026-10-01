# Landing page release checklist

The public landing page lives at `/welcome/` (its own Vite HTML entry, `welcome/index.html`). Work through this list before it is reachable from the public internet. Items marked PRE-RELEASE are placeholders left on purpose.

## 1. PRE-RELEASE: where enquiries are emailed

- [ ] Set the config value `EarlyAccess:NotifyEmail` (API side) to the address that should receive "New Odip early-access request". Nothing on the page needs to change.
- [ ] SMTP must be configured on the server (`Notifications:Smtp:*`). Without it the request is stored and logged with a masked email, but nobody is told.
- [ ] Send one test request through the live form and confirm the email arrives.

## 2. PRE-RELEASE: the form copy and the collection notice

The page ships a neutral notice: "We will only use these details to reply about early access to Odip." It appears under the form and in the footer.

- [ ] Name who is collecting the details (the legal entity) and give a privacy contact. Two `TODO(release)` comments in `welcome/index.html` mark the spots: one under the form, one in the footer. Keep the two notices identical.
- [ ] Decide the retention period for stored requests and say so in the notice if it is stated anywhere.
- [ ] Say what early access is. The line above the form still only says "We will reply by email about early access to Odip." A `TODO(release)` comment under it marks the spot: who early access is for, any cost or commitment, who will write, and when. State a timeframe only if it will be honoured. The success message already repeats the address the person typed.

## 3. Public hostname and TLS

- [ ] The site is LAN-only on port 8475 today. Choose the public hostname, terminate TLS in front of the nginx container, and confirm HTTPS (the site already sends HSTS).
- [ ] Check `/welcome` redirects to `/welcome/` without losing the host or port (`absolute_redirect off;` is set in `nginx/default.conf`).
- [ ] Check the signed-out visit to exactly `/` lands on `/welcome/`, and that `/login` and every deep link still behave as before.
- [ ] Add a canonical URL and social-share metadata once the hostname is known (none is set now, on purpose).
- [ ] `nginx/default.conf` turns gzip on for text, CSS, JS, JSON and SVG (the `nginx:alpine` base ships it off, so `/welcome/` went out uncompressed). If the proxy in front of the container already compresses, remove that block. Check the live response carries `Content-Encoding: gzip` exactly once.

## 4. Re-verify the numbers and claims against the code

The plates and sentences on the page are counted and checked against the code on `main` (2026-10-01). Re-check them on the release commit, because counts change with every merge.

- [ ] 18 roster checks, of which 2 are hard stops (`WscExpired`, `VehicleDoubleBooked`) and 16 are warnings. Only 4 of the warnings demand a reason (`RequiresReason: true`: approved leave, recurring unavailability, vehicle over seats, vehicle over wheelchair positions), so the page says "some ask for a reason", never "the rest" (`RosterConflictService.cs`, `RosterGate.cs`).
- [ ] 11 incident types (`IncidentType` enum), with the body map and restrictive-practice checks in the incident form.
- [ ] 5 tracked credentials (`QualificationsPage.tsx`).
- [ ] 3 funding types on a traveller (`PlanType` enum).
- [ ] 25 audited record types (`AuditedEntities.cs`).
- [ ] The 24-hour overdue flag for reportable incidents (the 24 hours run from when the incident record was created in Odip, not from when it happened: `QscReporting.cs`), the 60-day "still missing" counts on the dashboard, the PRODA bulk file export, and the per-traveller invoice PDF.
- [ ] Fund wording: the app labels the trip-claim export "BPR CSV" (`ClaimDetailPage.tsx`) and the claim batch download "PRODA file" (`ClaimBatchDetailPage.tsx`). Both are NDIS upload files and the page says "PRODA bulk file" and "Odip exports the files; you upload them". Re-verify both exports and their labels on the release commit, and say "bulk payment file" if either label changes.
- [ ] The Care screen's shift-note caption says a note that mentions an injury prompts an incident report. The prompt is a keyword scan the code calls advisory, with false positives and false negatives (`ShiftNoteFlagging.cs`), so never reword it as detection.
- [ ] The stage after Fund is called "Report on time", not "Stay compliant": the page must not promise a compliance outcome (no complaints register, no 5-day rule, no submission to the Commission). Say "accommodation", not "rooms".
- [ ] Nothing on the page claims: Xero, Brevity, Employment Hero, Splose, Linxio or Budgetly integrations; connecting or submitting to PRODA or the NDIS Commission; a 5-day rule or live countdown timers; a complaints register; offline mode or a PWA; Australian data hosting or residency; e-signing; payment reconciliation; SMS; per-traveller bed or room allocation; more than one customer. `welcome/page.test.ts` guards most of these words, but read the page once more.

## 5. Recapture the product screens

The screens in `welcome/assets/screens/` were captured from the mock API plus fixtures on 2026-10-01 (the dashboard after its "Needs attention" redesign, before the navigation regroup). Recapture after the regroup lands. Each entry in `manifest.json` says whether it used fixtures (`fixture: true`) and what the crop leaves out.

- [ ] Run `welcome/capture/capture.mjs` (see its header for the environment it needs), then review every image at 1x and 2x. Images ending `-m` are the art-directed crops shown below 1024 px (the cropped body map is shown at every width).
- [ ] Update the alt text in `welcome/index.html` if a screen changed, and keep the "Sample data" label on every screen.
- [ ] PRE-RELEASE (app owner): land the `ClaimDetailPage.tsx` mapping fix, then recapture the Fund and Care screens from real data before the page is public. `src/pages/ClaimDetailPage.tsx:22-30` maps `NdiaManaged`, a legacy value the API never sends, so the claim badge prints the raw `AgencyManaged`. Until the fix, the two Fund screens feed `NdiaManaged` through a fixture, which shows a label the product cannot produce today. The participant page also prints raw enums such as `PlanManaged` and `TwoToOne` (`src/pages/ParticipantDetailPage.tsx`), so the Care screen is cropped below that line. 9 of the 15 figures are fixture-fed (`fixture: true` in `manifest.json`).
- [ ] App owner: `src/components/BodyDiagram.tsx` uses `var(--color-on-primary)` for the selected body-map pill (line 223) and the Add injury button (line 284), but `src/index.css` never defines that token (it defines `--color-on-primary-fixed` and other `on-*` tokens), so the text is dark on the dark green primary. The token is referenced in 32 files; define it (white on the green `--color-primary`) or check each use. The landing page crops the pill and the button out until then.
- [ ] Narrow recaptures for phones: the dashboard "Needs attention" tiles at about 300 px wide so they stack one per row (the current crop is 616 px and two columns, so on a 390 px phone Missing accommodation and Missing staff need a swipe), and the claim preview narrower than its 670 px (it has no crop, so amounts need a swipe). Add both to `capture/variants.mjs`.
- [ ] Desktop roster board: replace the full-week 1118 px board with the Monday to Friday columns of the wide capture (`crew-roster-board-wide` in `capture/shots-crew.mjs`, 1648 px) at 1:1, about 1200 px, so the chips read "Liam Okaf..." instead of "9am-1pm . D".
- [ ] The dashboard screen is fed one participant alert so its Critical Participant Alerts tile matches the care screen (the mock answers that request with the wrong shape). Check it against the real dashboard.

## 6. Final checks

- [ ] `npm run build`: `dist/welcome/index.html` exists and carries the direction contract comment; `dist/index.html` loads the route-gate script first in `<head>`.
- [ ] The early-access API (`POST /api/public/early-access`) is deployed and answers 202, 400, 429 and 500 as the form expects.
- [ ] Keyboard pass (Tab order, visible focus, the stops controls, the form), a reduced-motion pass, and a 360 px phone pass.
- [ ] Re-check the two font-preload URLs in `welcome/index.html` (the Latin subsets of Overpass v19 and Manrope v20 on `fonts.gstatic.com`) against the live Google Fonts CSS the page links. A stale hint is not harmless: the browser still fetches the file it names, so the page would pay for a font it does not use.
- [ ] The finish review has run twice (round 1 and round 2: FIX THEN SHIP both times; the round-2 caption change is applied). No third full review is needed; record `DESIGN.md` for the landing world.
