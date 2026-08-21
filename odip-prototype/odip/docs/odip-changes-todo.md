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

## Backlog

### Microsoft 365 SSO
- [ ] Sign in with Microsoft business accounts via Firebase's Microsoft OAuth provider
  - Backend needs no changes: `/auth/exchange` verifies a Firebase ID token and maps
    the email domain to a tenant, and does not care which provider minted the token.
  - Frontend swaps `signInWithEmailAndPassword` for
    `signInWithPopup(auth, new OAuthProvider('microsoft.com'))`.
  - Needs an Entra ID app registration (free on any M365 business plan) and its
    client ID / secret pasted into the Firebase console's Microsoft provider.
  - Roughly 2-3 hours of code plus about 30 minutes across the two portals.
  - Chosen over talking to Entra ID directly with MSAL because tenants are keyed on
    `EmailDomain` — ODIP is built to onboard other NDIS orgs, and the next one may be
    on Google Workspace. Firebase covers that and non-M365 support workers behind one
    interface; going direct would make an M365 account mandatory for every user.

### Harden the token exchange (do BEFORE Firebase goes live)
- [ ] Require `email_verified` in `AuthController.Exchange`, and once SSO lands require
      `sign_in_provider == "microsoft.com"` and disable the email/password provider.
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
