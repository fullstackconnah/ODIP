# ODIP Changes

Ticked items are shipped and verified against the deployed stack at
192.168.4.70:8475 (browser-verified, not just merged).


## Navbar
- [x] To make room for adding in the other revenue stream management as options that can be managed, all trip related navbar items should be moved into a submenu off of Trips

## Participants
- [x] Update "Wheelchair" field to be labelled "Mobility Aids"
  - [x] Move from Boolean to Enum with the following options: Wheelchair, Walker
  - [x] Explore options for specified mobility support, e.g. can transfer wheelchair to vehicle or travel in vehicle in wheelchair, out and about only, or bare weight. Some are vehicle-specific and others are for other support options like changing
- [x] Update "Overnight Support" field
  - [x] Move from Boolean to Enum with the following options: Active Night, Overnight Sleepover
  - [x] An overnight ratio is also required, with the default being 1:1
- [x] Add checkboxes for equipment
  - [x] Hi-Lo bed, hoist, shower chair, commode, standing machine
  - [x] Have the equipment notes field disabled until an equipment checkbox is enabled. A tooltip should tell the user that if they want to add a note they need to select an equipment option first

## New Feature Adjustments
- [x] Participant Schedule for Routines and Specifics required for shifts
- [x] Update restrictive practice to include type. Research into restrictive practice and how it applies to things like medications. We should have a separate input to adjust, edit and update different restrictive practice types.
- [x] Update the add participant form to be a tabbed wizard with fields that should be filled out as intake forms.
- [x] Advanced notes field - each participant should have a detailed notes where we can add a title for the note and a description for it. This is for detailed information and specific information required for participants if they require a specific thing when on shift, i.e such as a specific haircut
- [ ] Participant view of all information required. All the medications, participant schedules and rostering for the participant should be viewed in a full board outlining the entire day for a participant
- [ ] Update medications
  - [x] Include how medication is packaged, i.e webster/blister pack, doesette, this should be pulled from the Prescriber and Supply section to the top
  - [x] If oral, is it a tablet, powder, liquid etc
  - [x] Medication may have schedules that aren't daily. Might need each other day etc
  - [ ] **NOT YET — do not implement:** Add the ability to pull medications from a medication library - So we can search and import basic information about medication from client to client
  - [x] Include witness when recording when the administering of the medication, the staff member then listed as the witness should receive a notification to approve the witness in their portal.
- [x] Evaluate Participant Table
  - [x] List where they fit in the business, i.e STA, BSP, In home support, trip, HIDPA, Community access/Daily living, community nursing
  - [x] Evaluate layout and what information is been shown in that table
  - [x] Add in a medication button dependant on the service provided to them (shown when the participant has active medications)
  - [x] Make it more obvious that we can click on the row to view full client information
  - [x] The staff member assigned to the participant should see the medications for that specific participant (portal shift detail)
  - [x] Reports for all medication administered able to be selected by participant and ordered by when the medication was given
- [x] Update Staff preferences in participants so that they link between the compatibility table
- [x] Add participant risk notifications and alerts
- [x] Staff member portal
  - [x] Should see all the information required for their shift, the requirements required for their participant and any details required for them
- [ ] Evaluate how each of these features should integrate and talk to each other

## Categorised Changes Backlog (2026-08-30)

The 2026-08-30 changes list, broken into atomic items with stable IDs, categorised, and
fleshed out. Items marked `[research needed]` need investigation before design; items
marked `[needs clarification]` are ambiguous or incomplete in the source and need an
owner decision (collected under Open Flags at the end).

### A. Design System / UI Foundations

- [ ] **DS-01 — Unified design components (shared tables & fields).** Build a shared
  component library for the platform's recurring UI primitives — data tables, form
  fields, pickers — so every feature uses the same implementations rather than
  page-local variants. Partial building blocks exist (`DataTable.tsx`, `FormField.tsx`,
  `ToggleGroup.tsx`); this consolidates them into a deliberate, documented set and
  migrates existing pages onto them. Foundation item: contact tables, the RP bulk-add
  table, and searchable dropdowns should all consume these rather than invent their own.
- [ ] **DS-02 — Table option: vertical cell separation toggle.** Add a display option to
  the shared table component toggling vertical borders between cells, likely a per-table
  prop and possibly a user-facing toggle. Depends on DS-01 as its natural home.

### B. Participant Intake & Profile (wizard structure)

- [x] **INTAKE-01 — Wizard driven by Intake Form + Participant Profile.** Rework the
  multi-step participant wizard so its data model comes from two defined source
  documents: the Intake Form (initial data captured at intake) and the Participant
  Profile (deeper service-related information). Both forms should trace back to the
  Master Data Dictionary via the field registry/forms engine.
- [x] **INTAKE-02 — Split the participant form into Intake vs Profile.** Split the
  single participant form into the two documents above, mapping which fields are shared
  and which are required by each, based on the actual source forms. Includes ensuring
  users have access to both. Feeds DOC-01 — the split defines what each PDF contains.
- [x] **INTAKE-03 — Service-specific fields injected inline.** When services are
  selected, each pulls in its service-specific questions — not as a new tab/step per
  service, but as extra fields appearing inline within the relevant existing wizard
  tabs.
- [x] **INTAKE-04 — De-duplicate overlapping service fields.** Where two selected
  services ask for the same information, the field appears once and satisfies both — a
  field-level identity rule, a natural fit for the field-registry engine (same
  dictionary field referenced by multiple service forms).
- [ ] **INTAKE-05 — Gender field.** Add gender to participant identity (wizard + detail
  display). Small, but touches DTOs, entity, seeder, and the intake PDF.
- [ ] **INTAKE-06 — Address field.** Add a structured address field for the participant.
  Relates to living arrangements (LIVING-01) and the intake document.
- [ ] **INTAKE-07 — Dynamic/conditional form behaviour.** The wizard must be
  answer-driven end to end: funding type, plan type, diagnoses, living arrangement, and
  selected services all gate later questions, and irrelevant fields are never shown.
  Umbrella capability that FUND-02, CONTACT-02, DIAG-02, LIVING-01, and INTAKE-03 rely
  on — build once as a conditional-visibility capability rather than per-field hacks.
- [ ] **INTAKE-08 — Save as draft.** Save a partially-completed participant as a draft
  with a clear indicator (list + detail) and resume-later. Implies a participant status
  flag plus rules on where drafts appear (e.g. excluded from rosters/claims).
- [ ] **INTAKE-09 — Risks & hazards section (intake).** Capture potential risks in
  supporting the individual, categorised by who is at risk — the participant, other
  participants, the public, or staff. Likely a repeatable row structure, and a candidate
  for surfacing in portal shift detail later.

### C. Contacts Model

- [x] **CONTACT-01 — Split Identity and Contacts; contacts become a typed table.**
  `[research needed]` Separate identity from contacts; contacts become a table of
  people, each with a type carrying its own field set. Research required into
  NDIS/disability-practice contact types (next of kin, guardian, GP, support
  coordinator, plan manager, plan nominee, emergency contact, …) and per-type fields.
  Uses the DS-01 shared table.
- [x] **CONTACT-02 — Plan-type-dependent contact types; Contacts tab after
  NDIS/Funding.** Contacts tab moves after NDIS & Funding because available contact
  types depend on funding answers: NDIS-funded participants can add Support Coordinator,
  Plan Manager, and Plan Nominee, with availability governed by the selected plan
  management type. Depends on FUND-02 and INTAKE-07.
- [x] **CONTACT-03 — Contacts hold multiple roles with role-dependent fields.** One
  contact may hold several roles at once — family/other, administrator, authorised
  signatory, next of kin — selected when adding the contact, with different fields per
  role. Roles are a multi-select on top of the CONTACT-01 type model.

### D. Diagnoses & Health

- [ ] **DIAG-01 — Diagnoses fields (primary + other).** One primary diagnosis plus any
  number of others, selected from a curated dropdown of common diagnoses with an "add
  other" escape hatch. The curated list belongs in the Data Dictionary. Drives DIAG-02.
- [ ] **DIAG-02 — HIDPA field, with epilepsy auto-default.** `[needs clarification]`
  Add the HIDPA (High Intensity Daily Personal Activities) field. Defined rule: an
  Epilepsy diagnosis pre-selects "epilepsy management" by default. The full HIDPA option
  list and placement aren't specified — needs a definition pass (the NDIS high-intensity
  support items list is the likely basis). Depends on DIAG-01.

### E. Funding & NDIS

- [ ] **FUND-01 — NDIS plan dates.** Plan start/end dates on the participant's NDIS
  info; also underpins future claim-validity and review-reminder logic.
- [ ] **FUND-02 — Funding source: NDIS or Other (replaces Funding Organisation).**
  Replace funding-organisation with a funding-source selection: NDIS plan information,
  or "Other" revealing a specify field — with subsequent form content changing per
  source. Gates CONTACT-02 and is a core INTAKE-07 conditional.
- [ ] **FUND-03 — Participant plan budget record (budget phase 1 of 3).** Built on
  `feat/budget-record`, not yet merged or checked on the deployed stack, so not ticked.
  A Funding tab on the participant hub holding each plan's pools and funding periods
  (Core (flexible) and stated supports, with Oassist's set-aside when there is one), a
  "Plan budget" card on Intake and the Profile wizard, "Funding recorded" in the
  activation checklist for NDIS-funded participants (warn or enforce, as the existing
  readiness setting says), and a Settings → Budgets tab (warn or hard limit, and the
  "approaching" percentage: stored, not yet used). It records what the plan says and
  shows no spending or forecast. FUND-01's profile plan dates stay as they are; the tab
  offers, and never forces, copying a plan's dates onto them. Spec:
  `docs/specs/2026-10-04-participant-budgets.md`.
- [ ] **FUND-04 — Budget phase 2: ledger and visibility.** A server-side budget service
  (Available, Used, Booked ahead and Forecast for each pool and period), the Funding
  tab's figures, claim figures, the approaching, forecast-over and over alerts, a
  dashboard tile and a Budgets list, the plan builder's budget bar on the new model, and
  the rejected-claim code. Depends on FUND-03.
- [ ] **FUND-05 — Budget phase 3: moments and hard limits.** Roster findings, the
  hard-limit mode for ad-hoc shifts with the Admin override and the emergency path (an
  Admin reviews it afterwards), and the pattern-generate and trip-booking warnings.
  Depends on FUND-04.

### F. Living Arrangements

- [ ] **LIVING-01 — Living arrangements model.** Three arrangement types — Family,
  Independent, Supported Accommodation — with some fields shared across arrangements
  (model fields once, map to arrangements — mirrors INTAKE-04's principle). Conditional
  display per INTAKE-07; relates to INTAKE-06.
- [ ] **LIVING-02 — Family arrangement fields.** Main support person, their relationship
  to the participant, other people living in the accommodation, residential information.
  The main support person plausibly links to a CONTACT-01 contact rather than free
  text — decide during design.
- [ ] **LIVING-03 — Independent arrangement fields.** Whether they live with others
  (e.g. housemates), and presumably who. Small field set.
- [ ] **LIVING-04 — Supported Accommodation fields.** `[needs clarification]` The source
  bullet was empty — no fields specified. Likely candidates: SIL provider details,
  accommodation type, on-site support hours — confirm before building.

### G. Incident Reporting

- [ ] **INC-01 — Incident service type, with trip linkage.** Service-type selection on
  the incident report; selecting "Trip" enables a trip-select dropdown linking the
  incident to a specific trip.
- [ ] **INC-02 — "Other" incident type specify field.** Selecting incident type "Other"
  reveals a free-text field to specify what it was.
- [ ] **INC-03 — Auto-create incidents from refused/withheld/missed medications.** A MAR
  record of refused, withheld, or missed automatically creates an incident pre-populated
  with everything known about the event (participant, medication, dose, time, recorder).
  Should probably drop the user into the draft incident rather than silently filing —
  confirm during design. Interacts with MED-01/MED-03.
- [ ] **INC-04 — RP incidents validated against the participant's register.** When a
  restrictive-practice incident is reported, compare it against the involved
  participant's authorised restrictive practices to determine authorised vs unauthorised
  use, reusing the same RP-type dropdown
  (Seclusion/Chemical/Mechanical/Physical/Environmental/Unclassified) as the participant
  page. Unauthorised use is reportable-incident territory, so the outcome matters.
- [ ] **INC-05 — Prepopulate RP incident from authorised practices.** Selecting the
  involved participant surfaces their authorised RPs as selectable items — a selector
  per RP type with a dropdown of that type's authorised entries — prepopulating the
  incident fields. Depends on INC-04 and the register (including RP-01's bulk entries).

### H. Medications

- [ ] **MED-01 — Missed-medication guidance & contacts.** `[research needed]` On a
  missed medication, surface who to contact and what to do next: manager as primary
  instruction, plus Nurse-on-Call, Poisons Information Centre, the pharmacy, and a
  prompt to check the medication packaging for pharmacy details. Research needed into
  clinically/NDIS-appropriate guidance. Depends on MED-02, optionally ROSTER-01.
- [ ] **MED-02 — Manager primary-contact setting.** Tenant setting defining the primary
  manager contact (name/phone) that MED-01 displays first. Lives in existing Settings.
- [ ] **MED-03 — "Wrong medication administered" outcome.** New recordable
  administration outcome in the MAR flow. Serious-incident territory — should probably
  feed the same auto-incident pipeline as INC-03 (confirm: the source lists only
  refused/withheld/missed as triggers).
- [ ] **MED-04 — Administered-by from signed-in user; client-local timestamps.** Record
  the administering user automatically from the signed-in account (straightforward once
  the Staff→User unification lands) and capture administration time from the client's
  local time/timezone where possible instead of server time.

### I. Participant Details & Documents

- [x] **PDETAIL-01 — More comprehensive participant details tab.** Expand the Details
  tab to present the fuller picture this backlog adds (gender, address, diagnoses,
  living arrangements, funding, contacts, risks). Best done after the intake/profile
  data model settles.
- [x] **RP-01 — Restrictive practice bulk-add via editable table.** Rework the RP add
  modal: pick an RP type and enter how many practices of that type, producing an
  editable table with that many rows — columns: description, authorised by,
  authorisation date, review date — plus an add-row control. On save each row becomes
  its own register entry. Uses DS-01's shared table; feeds INC-05.
- [x] **DOC-01 — PDF export of Intake Form and Participant Profile.** Separately
  selectable PDF downloads per participant. QuestPDF already handles trip itineraries,
  so this extends an existing capability. Depends on INTAKE-02's field split.

### J. Rostering / On-call

- [ ] **ROSTER-01 — On-call roster and contact integration.** `[research needed —
  flagged "look into"]` Extend the rostering page with on-call nurse/manager slots, and
  surface the currently-rostered on-call person as a live contact point in MED-01's
  guidance. Treat as a spike before building, per the exploratory source phrasing.

### K. Cross-cutting UX

- [ ] **UX-01 — Searchable dropdowns for large lists.** Convert large-list dropdowns to
  searchable/typeahead selects — involved participant and involved staff were named; the
  medication witness picker, preferred-staff picker, and diagnosis dropdown are the same
  class. Belongs in DS-01's shared field set so it applies platform-wide.

### L. Shift Notes (potential feature — not yet committed)

- [x] **NOTES-01 — Shift notes at shift completion.** Support workers add shift notes
  when completing a shift, presumably in the portal's My Shifts flow. Explicitly a
  potential feature — scope/commit decision pending.
- [x] **NOTES-02 — Keyword flagging for incidents in shift notes.** Scan shift notes for
  incident-suggestive keywords (falls, medication, injury, behaviours) and prompt toward
  filing an incident report. Depends on NOTES-01; same potential status.

### Open Flags (owner decisions needed)

- **LIVING-04**: what fields should Supported Accommodation capture? (Source bullet was
  empty.)
- **DIAG-02**: what is the full HIDPA option list and where does it live in the wizard,
  beyond the epilepsy→epilepsy-management default rule?
- **MED-03**: should "wrong medication administered" also auto-create an incident, like
  refused/withheld/missed do in INC-03?
- **FUND-03**: Enforce mode refuses every activation on the missing agreement evidence
  today (the provisional agreement template has no approved source), so "Funding
  recorded" only becomes a block once that gate can open. Is that the order wanted?
- **FUND-03**: should an Admin be able to delete a recorded plan from the screen? The
  route exists and is audited; nothing offers it yet.
- **FUND-03**: the editor counts funding periods from the plan's first day and clamps
  month ends (a 31 January start ends the first period on 27 February). Does the NDIA
  release funding that way for plans starting on the 29th to the 31st?
- **FUND-04, FUND-05**: should the shift claim engine move to the plan builder's phase B
  pricing, should short-notice cancellations bill (and record a notice date), is the
  90-day claim limit from December 2026 wanted as a "claim clock" warning, and is a
  participant-facing budget statement wanted?

## Backlog

### Microsoft 365 SSO
- [ ] Sign in with Microsoft business accounts via Firebase's Microsoft OAuth provider
  - Backend: no code, but one setting. `/auth/exchange` verifies a Firebase ID token and
    finds the user by email (across tenants), taking the tenant from that user's row, but
    it accepts only the sign-in providers in `Auth:AllowedSignInProviders` (default
    `password` and `custom`). Enabling Microsoft in the Firebase console is not enough:
    add `microsoft.com` to that list, which is the decision to trust the `email_verified`
    a Microsoft account asserts. The value REPLACES the default list, it does not add to
    it, so the others must be in it:
    `Auth__AllowedSignInProviders=password,custom,microsoft.com`. Setting only
    `microsoft.com` would refuse every email-and-password sign-in, the owner's and the
    demo accounts' included. Workers who are not on M365 stay on email and password.
  - Frontend swaps `signInWithEmailAndPassword` for
    `signInWithPopup(auth, new OAuthProvider('microsoft.com'))`.
  - Needs an Entra ID app registration (free on any M365 business plan) and its
    client ID / secret pasted into the Firebase console's Microsoft provider.
  - Roughly 2-3 hours of code plus about 30 minutes across the two portals.
  - Chosen over talking to Entra ID directly with MSAL because ODIP is built to onboard
    other NDIS orgs, and the next one may be on Google Workspace. Firebase covers that
    and non-M365 support workers behind one interface; going direct would make an M365
    account mandatory for every user.

### Harden the token exchange (do BEFORE Firebase goes live)
- [x] Require `email_verified` in `AuthController.Exchange` (shipped 2026-08-30, PR #25),
      and accept only the providers in `Auth:AllowedSignInProviders` (below). Once SSO
      lands, add `microsoft.com` there (the value replaces the default list, so keep
      `password` in it while email/password is enabled) and disable the email/password
      provider (that half still pending SSO).
  - `Odip.Api/Controllers/AuthController.cs:82` reads only the `email` claim today.
  - The Firebase API key ships in the client bundle, so with email/password enabled
    anyone can call `createUserWithEmailAndPassword` using a provisioned-but-not-yet-
    signed-up user's address, receive an ID token carrying that email, and exchange it
    for an ODIP JWT with that user's role and tenant — without their password.
  - Firebase refuses the signup if that address already has a Firebase account, so the
    window is the gap between seeding a user and their first login. During onboarding
    that is every user at once, admins included.
  - Not exploitable while Firebase is unconfigured. That is what makes now the cheap
    time to fix it, and why it gates the Firebase rollout rather than sitting in the
    general backlog.
  - Accounts the app creates itself are created with `emailVerified: true`
    (`FirebaseUserService.BuildCreateUserArgs`): an admin creating a user, a tenant's
    first user, and the "Send set-password email" action for a user or staff member who
    has no Firebase account yet. Nothing ever sends them a verification link, so without
    it they could never pass the check above. It does not reopen the window described
    above: the account exists before anyone else can sign up with that address, and one
    made without a password is unusable until its owner follows the emailed set-password
    link, which proves they control the mailbox. An account that already existed is never
    marked verified by the app.
  - Staff added through the staff form have a user row and no Firebase account, so they
    get one on demand: `POST api/v1/staff/{id}/sign-in-account` (Admin, Coordinator,
    SuperAdmin) and `POST api/v1/admin/users/{id}/sign-in-account` (SuperAdmin, for the
    Users tab). The browser then asks Firebase to email the set-password link. An address
    on `Auth:SuperAdminDomain` signs in as SuperAdmin whatever the user's role, so the
    staff routes (create, an edit that changes the address, and this one) refuse such an
    address unless the caller is a SuperAdmin. A staff edit also refuses, for anyone but a
    SuperAdmin, to reactivate a row already on that domain or change its role. Both routes
    refuse an address the app invented (`@placeholder.local`, from the staff/user unification
    migration) and log at Information who asked, for whom, and whether the account was
    created or already existed: there is no audit record yet.
  - Any address signs in. The exchange no longer maps the address's domain to a tenant: it
    finds the one active user with that address (compared lower-case) across tenants and
    uses that user's tenant. No match, an inactive tenant, and two active rows with the
    same address are each refused with a 401 whose code says why (`NoOdipAccount`,
    `TenantInactive`, `Ambiguous`; the two-row case also logs both user ids, so the
    duplicate can be fixed). Saying why is safe because of the ORDER of the checks: these
    three are only reached by a token that already proved control of the mailbox (a verified
    email, an allowed provider), so they are shown only to the owner of the address, about
    their own address. The order is documented in `Odip.Api/Services/ExchangeRefusal.cs`.
    `Tenant.EmailDomain` is still stored and unique, but it is not read at sign-in. The
    SuperAdmin domain keeps its own path.
  - Only listed sign-in providers get in. The Firebase API key is public, so anyone can
    obtain an ID token from every provider enabled in the console, and what `email_verified`
    proves differs: control of the mailbox for email/password, whatever the provider asserts
    for a federated one. The exchange reads `firebase.sign_in_provider` and refuses a token
    whose provider is not in `Auth:AllowedSignInProviders` with a 401 coded
    `ProviderNotAllowed` (decided from the token alone, so it answers the same for any
    address), and one that does not say with the generic `InvalidToken`, each with a log
    line. The setting is a list in appsettings or one comma-separated
    value in the environment (`Auth__AllowedSignInProviders=password,custom`, the default);
    blank means the default, and any other value replaces it rather than adding to it.
    `custom` is a token minted with the service-account key, which
    only its holder can do. Before deploy, check the Firebase console: only Email/Password
    should be enabled today.
  - A refused sign-in says why on the login page (a code on the exchange's 401). What each
    message means and how to verify an account safely: the runbook at the repo root,
    `docs/runbooks/sign-in-trouble.md` (not under `odip-prototype/odip/docs/`).
  - The SSO plan above retires this whole flow. With the email/password provider disabled
    there is no password to set, so the set-password emails, the two sign-in-account
    routes, the temporary-password option and the verified-at-creation rule go with it.
