# ODIP — Oassist Integrated Data Interface

ODIP is an NDIS trip and participant operations management platform. It covers participants,
trips and itineraries, accommodation bookings, vehicle and staff scheduling, NDIS claims with
the NDIA bulk payment file (BPR CSV), incident reporting, audit logging, a support catalogue with pricing,
and a field-registry/forms engine. The codebase is a fork-in-progress of an existing product
called "TripCore", retargeted from net9.0 to net8.0. For the fuller vision and architecture
picture, see `PROTOTYPE_NOTES.md` and the `Platform Plan/` directory.

## Operating Model — Orchestrator Only (MANDATORY)

- The main Claude session is an ORCHESTRATOR, not an implementer. It must NEVER implement tasks
  directly — no writing or editing source files, and no running builds or tests itself as part
  of implementation work. The main session's role is coordination, not hands-on execution.

- ALL hands-on work — code changes, file edits, test writing, debugging, exploration/research —
  MUST be delegated to subagents via the Agent tool, using smaller models: `model: "sonnet"` for
  implementation, exploration, and drafting work. This keeps the token-heavy work off the
  orchestrating session.

- The main session's ONLY jobs are: break the request down into agent-sized tasks, write precise
  agent prompts (include exact file paths, acceptance criteria, and the relevant gotchas from
  this file), dispatch agents, and then validate the results. When tasks are independent of one
  another, dispatch the agents in parallel rather than one at a time.

- Validation after EVERY agent session is mandatory before reporting anything done: read the
  diffs/files the agent touched, and dispatch a separate validation step (build + tests) — e.g.
  a fresh sonnet agent runs `dotnet build` / `dotnet test` (backend) or `npm run build` /
  `npm run lint` (frontend) and reports results. Agents can misreport success, so an agent's own
  "it works" claim must never be accepted without independent verification output.

- If validation fails, dispatch a follow-up agent with the failure output so it can be fixed —
  do not fix it in the main session. This is what keeps the orchestrator from sliding into
  implementer mode under time pressure.

- Agent-prompt checklist (added 2026-09-13 after three seam bugs shipped as "done": a
  cross-tenant leak, a mutation body missing `staffId`, an edit form that reset on re-render):
  - State the OTHER side of every seam as fact in the prompt: what the caller sends, what the
    callee validates/rejects, and the entity's tenant scoping. Agents test only what the prompt
    names.
  - When a flow crosses backend↔frontend (an endpoint plus the hook/page that calls it), give ONE
    agent both sides and require a payload test — do not split it by layer.
  - Every agent report must end with "Assumptions about code I did not own"; verify each one
    against source before accepting the work. Read the diff at the seams, not just the tests.
  - Never run a backend validation agent while a backend implementation agent is still building —
    they collide on `bin/`/`obj/`.
  - Agents committing concurrently in ONE worktree share the git index. `git add` then
    `git commit` races: another agent's commit sweeps up your staged files (happened 2026-09-13,
    ed771eb). Concurrent agents must commit with an explicit pathspec — `git commit -- <paths>`
    — and never `git add -A`. Run at most 2 implementation agents at once (a session rate limit
    killed 2 of 3 mid-run; resumed agents had to finish uncommitted work).

- The only things the main session may do directly are: reading files for validation/review,
  trivial single-line CLAUDE.md/config touch-ups, and answering questions from already-gathered
  context. Everything else goes through an agent.

## Repository Layout

**The real application root is `odip-prototype/odip/` — NOT the repo root.** The repo root
itself holds only planning material — vision/architecture docs, the master data dictionary
spreadsheet, and legacy files staged for deletion — while the actual backend, frontend, and
supporting tooling all live nested two levels down, inside `odip-prototype/odip/`.

```
<root>
├── Platform Plan/                 # planning docs 00–10 (vision, architecture, data model, fork plan)
├── PROTOTYPE_NOTES.md             # fork/build status notes + local run commands
├── ODIP Master Data Dictionary.xlsx  # source-of-truth field registry (seeded as SeedData/DataDictionarySeed.json)
├── _to_delete/                    # legacy docs staged for deletion — ignore
├── odip-prototype.zip             # duplicate of tree below — NEVER search/index it
└── odip-prototype/odip/           # ACTUAL APPLICATION ROOT
    ├── backend/                   # .NET 8: Odip.sln → Odip.{Api,Application,Domain,Infrastructure,Tests}
    │   └── Odip.ProtoTests/       # package-free console harness, deliberately NOT in the .sln
    ├── frontend/                  # React 19 + TypeScript 5.9 + Vite 7 + Tailwind 4
    ├── mock-api/server.js         # Node mock API for offline frontend preview
    ├── local-test/                # fake Firebase SA + JWT minting; run-api.ps1 starts the API on :5100
    ├── docs/superpowers/          # legacy TripCore plan/spec archive — historical only, ignore
    ├── nginx/, start-preview.ps1, .env.example
```

The repository root is `F:\Projects\personal\ODIP` (the level above `odip-prototype/`),
not this directory — run `git` commands from there.

## Commands

The backend is a standard .NET 8 solution; run these from `odip-prototype/odip/backend`:
```
dotnet restore
dotnet build
dotnet test                          # Odip.Tests (xUnit + Moq + EF InMemory)
dotnet run --project Odip.Api        # http://localhost:5062 (https 7199)
```

The frontend is a Vite-driven React/TypeScript app; run these from `odip-prototype/odip/frontend`:
```
npm ci
npm run dev        # Vite on 5173; proxies /api → http://localhost:5062
npm run build      # tsc -b && vite build
npm run lint
```

- Combined preview: `odip-prototype/odip/start-preview.ps1` (mock API + Vite; expects Node at
  `~\tools\node`).
- Docker: the deployed stack is `deploy/compose.yaml` (repo root), built from source on the
  homelab by `.github/workflows/deploy.yml` — a self-hosted runner that rsyncs the tree,
  runs `docker compose build` as the test gate, then `up -d` with a health check and
  automatic rollback. Nothing is pulled from ghcr.io. The inherited TripCore
  `odip-prototype/odip/docker-compose.yml` was deleted: rsync copied it into the stack
  root next to `compose.yaml`, and Compose picking the wrong one would have silently
  deployed stale prebuilt images.

## Architecture

- The backend follows a layered .NET structure: Domain → Application → Infrastructure → Api. In
  practice the layering is fairly flat — the 17 API controllers (Trips, Participants, Claims,
  Bookings, Vehicles/Staff, Schedule, Incidents, Audit, Auth, AdminUsers, Tenants,
  ProviderSettings, PublicHolidays, SupportCatalogue, TasksDashboard, Settings, Dev) call
  Infrastructure services and `OdipDbContext` fairly directly. When making a change, expect to
  touch the controller together with Infrastructure/Domain code rather than hunting for a strict
  Application-layer abstraction in between.

- The database is PostgreSQL, accessed via Npgsql EF Core. The connection string comes from
  `ConnectionStrings:DefaultConnection` or the `POSTGRES_CONNECTION_STRING` environment
  variable, defaulting to `localhost:5432/odip` — check both locations when diagnosing a
  connection problem.

- Authentication is a dual stack: JWT Bearer (configured via `Jwt:Secret` / `JWT_SECRET`, which
  must be at least 32 characters, with a cookie fallback of `odip_jwt`) alongside the Firebase
  Admin SDK. The app REFUSES TO START if either mechanism is missing or misconfigured, and it
  explicitly rejects the literal dev placeholder secret — so local setup needs a real secret
  value, not just any non-empty string.

- Middleware runs in a fixed order in `Program.cs`: security headers →
  `ExceptionHandlingMiddleware` → rate limiter ("login"/"api" policies) → CORS → Auth →
  `ReadOnlyMiddleware` (403s writes for the "ReadOnly" role) → controllers. Because the order
  matters, inserting new middleware in the wrong slot can silently change what gets
  rate-limited, authenticated, or blocked.

- Multi-tenancy is implemented through `ICurrentTenant`/`ITenantEntity`, with super-admin tenant
  switching handled via the `X-View-As-Tenant`/`X-View-As-User` request headers — tenant-scoped
  code needs to respect this switching mechanism rather than assuming a single ambient tenant.

- Billing/NDIS logic lives in `Odip.Domain/Billing/`: the funding-source entity in `BillingEntities.cs`,
  the shared price rules in `Services/ClaimPricing.cs`, the plan pricing engine in `Pricing/`. The claiming
  flow continues in Infrastructure services — `ClaimGenerationService`, `InvoiceService`, `BprCsvService`
  (the NDIA bulk payment file), `CatalogueImportService` — with Excel and PDF output via ClosedXML and
  QuestPDF respectively. The old billable-event / claim-batch / service-booking pipeline was retired.

- Startup in `Program.cs` also registers `HolidaySyncBackgroundService` (a hosted service that
  syncs public holidays via the Nager provider, driven by `HolidaySync:*` config), wraps DB
  connect/migrate/seed in a 5-attempt exponential-backoff retry, and seeds through
  `DbSeeder.SeedAsync` + `SeedNdisDataAsync` (`Odip.Infrastructure/Data/DbSeeder.cs`, ~850
  lines) — check there before touching seed data.

- The field registry/forms engine lives in `Odip.Domain/Dictionary/` and is seeded from the
  Master Data Dictionary spreadsheet — the spreadsheet is the source of truth, so field/form
  changes should trace back to it rather than being made ad hoc in code.

- On the frontend, each domain has a typed API layer under `src/api/hooks/*` and
  `src/api/types/*`, built on the shared Axios client `src/api/client.ts`. Data fetching/caching
  goes through TanStack Query (no Redux/Zustand/Context store exists), forms use react-hook-form
  with zod, and routing uses react-router 7.

- Frontend auth: the JWT lives in localStorage under `odip_token`; `src/api/client.ts` attaches
  `Authorization: Bearer` plus the `X-View-As-Tenant`/`X-View-As-User` headers, and on a 401 it
  refreshes the Firebase ID token, exchanges it at `/auth/exchange`, and retries the request
  once before clearing the session and redirecting to `/login`.

## Gotchas

- MediatR and AutoMapper are referenced in the .csproj files but are essentially UNUSED — there
  is no CQRS pattern actually in force anywhere in the codebase. Do not add MediatR handlers or
  AutoMapper profiles "to match the pattern," and do not assume either one is wired up just
  because the package reference exists.

- The deploy image runs `dotnet test` under invariant globalization; the dev machine is en-AU.
  Culture-dependent formatting differs ("Sept" locally, "Sep" in the container) and a test that
  hard-codes the local form passes locally then fails the deploy (2026-09-13, run 34753911258).
  Format every server-rendered string (emails, exports, findings) with
  `CultureInfo.InvariantCulture` and never assert a current-culture rendering.

- Legacy `StaffAvailability` has NO tenant filter (no `ITenantEntity`, no `HasQueryFilter`) —
  any query over `_db.StaffAvailabilities` not keyed on a tenant-scoped user id leaks across
  tenants. Scope it via `_db.Users.Any(u => u.Id == a.UserId)` (Users IS filtered). Check the same
  before adding a list endpoint over any other entity that predates the tenant work.

- Fresh worktrees have no `frontend/.env.local`; copy it from the main checkout or two
  Firebase-env tests fail with `Missing required environment variable: VITE_FIREBASE_API_KEY`.

- BOTH Dockerfiles run their test suites inside the image build — the backend one runs
  `dotnet test Odip.Tests/Odip.Tests.csproj -c Release --no-restore`, the frontend one runs
  `npm test`. The deploy workflow uses `docker compose build` as its gate, so a SINGLE failing test
  anywhere fails the "Build images" step and no deploy happens at all. The symptom is a stale server
  (the running containers are never touched), never an outage or a rollback — so diagnose a red
  deploy with `gh run view <id> --log-failed` before suspecting the server. Beware time-dependent
  tests in particular: a test that only fails inside some daily window will pass on a re-run and
  carry the fault forward.

- `Program.cs` contains raw-SQL self-healing logic for `__EFMigrationsHistory` that is tied to
  specific migration IDs. Renaming or reordering existing migrations can break application
  startup silently with no obvious error pointing back to the cause, so migrations must be
  touched with extreme care.

- `Odip.ProtoTests` is deliberately excluded from `Odip.sln` — it's a sandbox harness that
  duplicates coverage already present in `Odip.Tests/Billing`. This means a solution-level
  build/test run will silently skip it entirely, so don't rely on `dotnet build`/`dotnet test`
  at the solution level to catch issues there.

- `start-preview.ps1`'s opening comment says the mock API runs on port 5050, but the comment is
  stale — `mock-api/server.js` actually listens on 5062 (overridable via `MOCK_PORT`).

- The XLParser, OpenXml, and Irony DLLs that show up in the build output are transitive
  dependencies of ClosedXML, not direct references — there is no Roslyn usage anywhere in the
  codebase, so don't go looking for a compiler/codegen feature that isn't there.

- There are TWO separate `.env.example` files: `odip-prototype/odip/.env.example`
  (deployment/Portainer vars) and `frontend/.env.example` (Vite/Firebase vars). The frontend one
  sets `VITE_API_BASE_URL` pointing at port 5000, but the backend actually listens on 5062 —
  copy it blindly and every API call fails.

- The backend `Dockerfile` builds and runs on .NET 9.0 images even though every project targets
  net8.0, and serves on container-internal port 5000 — don't "fix" local ports to match it.

- Outside Development, the API sets a strict CSP (`connect-src` allows only self plus the
  Firebase identity endpoints) — frontend calls to any new external API will be CSP-blocked in
  production until the policy in `Program.cs` is updated.

- `bin/` and `obj/` are checked into the tree because there's no git repository here to
  gitignore them. Always exclude `bin/`, `obj/`, `odip-prototype.zip`, and `_to_delete/` from
  searches, or results will be full of noisy duplicate/stale matches.

## Testing

- Backend tests live in `Odip.Tests` and use xUnit, covering `Billing/ShiftClaimGenerationServiceTests.cs`,
  the `Services/*Tests.cs` files, `Middleware/ExceptionHandlingMiddlewareTests.cs`, and
  `CurrentTenantTests.cs`. They rely on Moq for mocking and EF Core InMemory for the database
  layer, with fixtures defined inline within each test file rather than shared through a common
  base.

- Frontend tests use vitest + Testing Library (jsdom): `npm test` runs the suite (config in
  `vite.config.ts`, setup in `src/test/setup.ts`, `*.test.tsx?` co-located with components).
  The frontend Dockerfile runs `npm test` before `npm run build`, so a failing suite blocks
  the deploy image build. `npm run lint` currently fails with pre-existing debt in non-test
  files — the working gate is "no new lint errors", alongside `npm run build` and `npm test`.
  Baseline was 69 problems on 2026-09-13 — compare the count before/after, don't expect zero.

- Seam tests that are mandatory, not optional (each was missing when a real bug shipped):
  - New read/list endpoint → a cross-tenant negative test: a row owned by another tenant's user
    is NOT returned to a non-SuperAdmin caller (fixture pattern: `LeaveControllerTests`'
    "belongs to another tenant" cases).
  - Any test of a mutation hook/page asserts the FULL request body (`expect.objectContaining` on
    every field the backend validates), not merely that the call happened.
  - Every edit form: submit with the server mocked to reject, then assert the error shows AND the
    edited values survive. react-hook-form `reset()` keyed on an inline `initialValues={{}}`
    literal re-fires on every parent render — build initial values with `useMemo` on the row.
  - Any HTML assembled by string interpolation (email templates under
    `Odip.Infrastructure/Notifications/Templates/`, exports, PDFs) → every payload field goes
    through `WebUtility.HtmlEncode`, and a test renders it with `<script>` / `"` in each
    user-controlled field and asserts the encoded form (caught by automated review 2026-09-13).
