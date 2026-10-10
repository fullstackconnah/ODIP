# ODIP Prototype — build notes (2026-08-02)

> **Retired 2026-10-10:** the Billing vertical slice below was removed except `FundingSource` (the plan editor's billing hint still reads it): `ServiceBooking` + lines, `BillableEvent`, `ClaimBatch`, `IncomeStream`, `ProdaBulkFileWriter`, `BillingValidator`, `BillingRouter` and their controller routes, pages, tables and tests are gone.

This repo is the **fork of TripCore → ODIP** (plan doc 08, steps 1–2 plus the billing vertical slice), produced in a sandbox where NuGet and the external APIs (Xero, Brevity, PRODA, Employment Hero) were unreachable. Everything that needs no external dependency is implemented and test-proven; everything that does is stubbed or deferred.

## What was done

1. **Mechanical fork** — full solution/namespace/file rename TripCore→Odip (backend, frontend, compose, nginx, env, http files; `docs/superpowers/` history left as-is). Solution retargeted **net9.0 → net8.0** (all packages were already 8.x; sandbox only has the .NET 8 SDK — retarget back to net9 locally if preferred, nothing depends on 8).
2. **Frontend verified** — `npm ci` + `tsc -b && vite build` pass clean post-rename (pre-existing chunk-size warning on TripDetailPage untouched).
3. **Billing vertical slice** (new, `Odip.Domain/Billing/`):
   - `BillingEntities.cs` — FundingSource (routing type), ServiceBooking + lines with **balance tracking**, BillableEvent (the universal billing unit, all income streams), ClaimBatch, IncomeStream enum.
   - `Services/ProdaBulkFileWriter.cs` — generates the NDIA bulk payment request CSV per the official spec (exact 16-column order, yyyy-MM-dd dates, HHH:MM hours, Quantity XOR Hours, P1/P2/P5 GST codes, CANC/REPW/TRAN/NF2F claim types, 5000-row cap, CSV escaping, `NDISUPLOADddmmyy.csv` naming).
   - `Services/BillingValidator.cs` — pre-batch validation encoding Oassist's real rejection causes: service-booking balance, duplicate claim references, claim-window deadline (configurable days — see open question 7a), qty/hours XOR, date order, amount checks. `Apply()` consumes booking balance so subsequent batches see it.
   - `Services/BillingRouter.cs` — funding-type → claim/invoice routing rule from the platform plan.
4. **Field registry / forms-engine seed** (new, `Odip.Domain/Dictionary/` + `SeedData/DataDictionarySeed.json`): the real Master Data Dictionary (280 fields, 24 domains) as data, tolerant type parsing, auto-sensitivity flags on clinical-adjacent domains, EAV FieldValue store, FormTemplate.FromAppearsIn() building form skeletons from the dictionary's form mappings.
5. **Tests** — `Odip.ProtoTests/` (package-free console harness, **48/48 passing** in-sandbox) and the same coverage as xunit in `Odip.Tests/Billing/BillingPrototypeTests.cs` (run locally: `dotnet test`).

## To run locally

```bash
cd backend
dotnet restore && dotnet build          # normal NuGet access assumed
dotnet run --project Odip.ProtoTests    # package-free harness
dotnet test                             # full suite incl. new xunit port
cd ../frontend && npm ci && npm run dev
```

`backend/nuget.offline.config` is the cleared-source config used for sandbox offline builds — ignore it locally (or use `dotnet restore --configfile nuget.offline.config` to reproduce offline behaviour).

## Deliberately NOT done here

- EF Core wiring for the new entities (DbContext registration, migrations) — needs NuGet; first job locally. All new types follow existing conventions (ITenantEntity, Guid keys) so configuration is mechanical.
- API controllers/UI for billing + field registry — next vertical slice after EF wiring.
- Integrations (Xero, Brevity file exchange, EH) — per plan doc 05; the BillingRouter emits the routing decision they'll consume; the PRODA CSV needs no API at all (it's a portal upload, which is the point).
- New Firebase project/environments — fork still carries TripCore's env var names (values must be new; see plan 08 §1).

## Next steps (in order)

1. Local `dotnet build` + `dotnet test` on net8 (or retarget net9) — confirm the xunit port passes.
2. EF configuration + migration for Billing/Dictionary entities; seed DataDictionarySeed.json on tenant provisioning.
3. Characterisation tests around Participant before starting overhaul #1 (plan 08 §3.1) — the go/no-go checkpoint.
4. First real-data test: rebuild one past PRODA upload (e.g. a May 2025 batch from the rejection log) through ProdaBulkFileWriter and diff against the file actually submitted.
