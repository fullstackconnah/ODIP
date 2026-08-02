# 07 · Open Questions

Items that block or shape design decisions. Grouped by urgency.

## Blocking Phase 0

1. ~~**Z:\ documentation access**~~ **Resolved 2026-08-02** — both folders reviewed; findings in `09-process-findings.md`.
2. **Spreadsheet inventory** — a first inventory is now in 09 §7 (Booking Form, Rosters, registers, training log, Daily Plan…). Remaining: confirm with the team that nothing material lives outside the two Z:\ folders (e.g. OassistAdmin SharePoint site, personal drives, the Marketing databases used for brochure mail-outs).
3. **Brevity API access** — no API is evidenced in any internal documentation, including Brevity's own meeting notes. Ask Brevity directly whether one exists on Oassist's plan; until confirmed, the connector design is file/export-based (see revised 05 §1) — and Brevity's long-term role should be re-examined once ODIP masters rostering and claim-file generation.
4. ~~**Tour-booking system identity**~~ **Resolved** — it is BOOKING FORM.xlsx (SharePoint), migrated via scripted import (05 §9).
5. **Employment Hero tier/API** — which EH products (HR? Payroll?) and does the tier allow timesheet import via API?

## Shaping Phase 1–3

6. **Claiming cutover intent** — target date/conditions for Brevity taking over claiming? Who is fixing the Brevity setup, and is that work happening in parallel with ODIP?
7. **Trip funding rules in practice** — the docs establish the shape (out-of-pocket invoice with trip-cost-vs-NDIS-claim split typed into descriptions; NDIS claimed post-trip via quote-to-invoice + PRODA) but a worked example of one real reconciled traveller (self-funded amount, support hours claimed, transport treatment, STA use) is still wanted to validate the funding-plan model, especially STA usage (Q8).
7a. **Claim window rule** — Pricing policy says 60 days from service-booking end; the PRODA working doc says 90. Confirm against current NDIA terms of business and encode one rule.
7b. **GST treatment ambiguity** — the GST-adjustment procedure contains an unresolved "tax inclusive or exclusive? double check with John". Resolve and encode; ODIP validation should make this class of miscoding impossible.
8. **STA usage** — how often are trips (part-)claimed as STA per-night packages vs hourly supports? Who decides, and on what criteria?
9. **Deposit/cancellation policy** for trips (drives invoice scheduling and refund handling).
10. **Document home** — should SharePoint remain the corporate records master (ODIP mirrors to it), or does ODIP become primary with SharePoint archival? Business owner call.
11. **Retention & privacy rules** — record retention periods per record class (from policies); any state-specific requirements (Victorian health records obligations for nursing records).

## Shaping later phases

12. **Nursing/PBS billing ownership (interim)** — while Splose remains: does Splose invoice/claim these streams short-term, or does ODIP take billing from day one of Phase 3?
13. **Splose long-term** — consolidate clinical into ODIP eventually, or keep Splose permanently as the clinical system? Revisit once the nursing stream stabilises.
14. **Training accreditation constraints** — do condition-specific/complex-care courses carry accreditation or clinical-governance requirements that dictate certificate content/registers?
15. **SIL timeline** — when does SIL planning become concrete? (Triggers the M-SIL design work.)
16. **White-label packaging** — what exactly would a sellable process pack contain, and does it include ODIP-generated form templates? (Affects forms-engine export design.)
17. **Support coordination** — answered "no" as a current stream; confirm it stays out of scope.
18. **NDIS registration groups** — confirm Oassist's registered registration groups (affects which support items are claimable, incl. nursing and STA).
