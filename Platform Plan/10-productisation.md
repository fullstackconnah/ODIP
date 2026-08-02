# 10 · Productising ODIP for Multiple Businesses

**Decisions (2026-08-02):** target market = **phased** — supported-holiday/STA providers first, expanding toward general NDIS practice management as modules mature. Commercial model = **SaaS subscription**. Timing = **dogfood first**: Oassist runs fully on ODIP before any external customer. Operations = **John part-time** alongside development — this constraint shapes almost every recommendation below.

---

## 1. Strategy: the wedge

Sell first to the market segment where ODIP has no real competitor: providers running supported holidays, group trips and STA. Everything generic (rostering, claiming, CRM) has entrenched competitors — Brevity, ShiftCare, Splose and a dozen others. Nothing on the market models what the Oassist process review proved is genuinely hard: accommodation-led trip planning, per-traveller funding splits (self-funded / support hours / transport / STA nights), trip task checklists, pick-up and medication logistics, post-trip claim generation. Oassist itself is the credibility asset: "built inside a provider that runs 10–30 trips a year, through real seasons and real claiming cycles."

Phase two — once the general modules (rostering, billing, compliance) have hardened under multi-provider use — the offer widens toward small providers who want one system instead of Brevity + spreadsheets. That fight is winnable only with the niche revenue and references behind it; don't start there.

The white-label document-pack/consulting stream (01 §10) is the natural on-ramp: process packs and setup consulting for other providers builds the relationships that become the first SaaS customers.

## 2. The dogfood gate

No external customer until all of the following are true at Oassist:

1. A full trip season planned, delivered, claimed and reconciled entirely in ODIP (no BOOKING FORM.xlsx fallback).
2. At least two complete fortnightly community-access billing cycles from rostered shifts to paid claims/invoices without manual re-keying.
3. The compliance suite has processed real incidents and produced at least one monthly RP reporting cycle.
4. One annual NDIS pricing update (PAPL import) executed through the platform.
5. Recovery drill passed: restore from backup to a working instance.

These are the exact things a paying customer will hit in their first year; Oassist must hit them first.

## 3. Technical productisation workstreams

TripCore's multi-tenancy (Tenant, ITenantEntity, query filters, SuperAdmin) means the foundation exists. Productisation is mostly about *hardening* and *configurability*, not re-architecture.

**3.1 One shared instance, not instance-per-customer.** A single multi-tenant deployment with feature flags. Instance-per-customer at solo-operator scale means N deployments to patch, migrate and monitor — the fastest way to drown. The exception to ever revisit: a customer large enough to demand dedicated hosting, priced accordingly.

**3.2 Tenant isolation hardening.** Row-level filtering is necessary but not sufficient for paying strangers: add automated cross-tenant leakage tests in CI (every endpoint probed under two tenants); tenant-scoped document storage paths with per-tenant encryption keys; tenant-scoped integration credentials; per-tenant backup export. An external penetration test before the first customer — NDIS providers hold exactly the data classes that make a breach existential.

**3.3 Config over code — the de-Oassist-ification audit.** Everything Oassist-specific must live in tenant configuration, never in code: provider identity (the ORG-* block), branding/themes, email templates, trip-code grammar, task/checklist templates, form templates (the forms engine field registry is *the* customisation surface — each tenant composes forms from the shared field registry plus their own custom fields), billing routing rules, T&C terms (cancellation tiers, payment windows), picklist extensions. Rule for every feature built from now on: "would a second tenant need this different?" — if yes, it's config.

**3.4 Shared reference data as the value engine.** The NDIS support catalogue, price limits, public holidays, claiming rules and reportable-incident deadline tables are maintained **once** and every tenant benefits on the same day. This is the single strongest recurring-value argument for the subscription: "the price guide updates itself on 1 July."

**3.5 Tenant lifecycle & onboarding tooling.** Given part-time ops, onboarding must be near-self-serve even if sales is high-touch: scripted tenant provisioning (seed picklists, catalogue, default templates), guided setup checklist in-product, and — critically — **importers as product features**: the spreadsheet importers built for Oassist's migration (client lists, booking-form-style workbooks, staff registers) generalised into a mapping-based import wizard. Every prospect has the same spreadsheet mess; painless import is the #1 adoption barrier and the #1 demo moment.

**3.6 Subscription billing & metering.** Stripe (or similar) with per-active-participant tiering (aligns price with provider size and ODIP's own data model), annual billing preferred (fewer failed-payment chases for a part-time operator), in-app plan management. Feature flags per plan tier if/when needed.

**3.7 Operations for a part-time operator.** Error tracking with per-tenant context, uptime monitoring + status page, automated backups with tested restores, one-command deploy/rollback, SuperAdmin tenant-switcher (already built in TripCore) as the support console, in-app help + documentation site to deflect support, async-only support with honest response-time commitments (no phone SLA). **Capacity honesty:** with John part-time, cap the first cohort at roughly 3–5 customers until support load is measured; each early customer should be worth enough to justify their onboarding weeks (which argues for annual contracts around A$500–1,500/month equivalent depending on size — validate against what providers pay Brevity/ShiftCare today).

**3.8 Trust & legal package.** Before customer one: terms of service, privacy policy (APP-compliant), data processing terms, data-ownership and export guarantees (full tenant export on demand — also your churn-insurance credibility), AU data residency statement, security overview document, cyber insurance. A **source-code escrow or continuity arrangement** deserves explicit thought: for a solo-maintainer SaaS holding disability service records, "what happens if John is hit by a bus" is a fair customer question — answer it before it's asked. Also decide the product's corporate home: selling software to Oassist's competitors from inside WOW TOURS Pty Ltd has conflict-of-interest optics; a separate product entity (with Oassist as shareholder/first customer) is cleaner — get advice; this is a legal/structural question, not a technical one (and I'm not a lawyer).

## 4. What the product deliberately is not

Draw the boundary early and keep it: ODIP-the-product does **not** do payroll (integrate: Employment Hero et al.), plan management, clinical documentation depth (integrate: Splose), or accounting (integrate: Xero). Each tenant brings their own Xero/EH credentials; connectors are product features, their configuration is tenant config. Multi-state support matters from customer one (the RP authorisation matrix in 09 §5 is already state-varying; Victorian-only assumptions must not creep in).

## 5. Sequencing against the build (extends 06)

- **Now → Phase 6 (during the Oassist build):** enforce the config-over-code rule on every feature; keep the cross-tenant test harness green; write the docs site as modules land (it doubles as Oassist's own manual — replacing the Practice Manual Word docs is already in scope).
- **Phase 7a (post-dogfood-gate):** isolation hardening + pen test, provisioning automation, import wizard generalisation, billing integration, legal package, marketing site with demo tenant.
- **Phase 7b:** first cohort — 3–5 holiday/STA providers, consulting-heavy onboarding at full subscription price (discount the onboarding, never the subscription), fortnightly feedback loop.
- **Phase 8:** widen the offer toward general practice management only when cohort-one churn is ~zero and support load per tenant is known and small.

## 6. Risks specific to productisation

1. **Solo bus factor becomes contractual.** Mitigate: escrow/continuity plan, boring stack, deployment automation, documentation discipline (§3.7, §3.8).
2. **Support load eats development.** Mitigate: cohort cap, async support, self-serve onboarding, in-product help; measure hours/tenant/month before growing the cohort.
3. **Regulatory maintenance becomes an obligation.** Once customers pay, the annual PAPL import and rule updates are a contractual duty on a schedule you don't control. Build the import tooling to be an hours-not-days job.
4. **Feature capture by the loudest customer.** Early customers will pull the product toward their quirks; the tenant-config surface (3.3) is the pressure valve — quirks become their config, not your code.
5. **Oassist conflict.** Competitors may hesitate to run on a rival's platform — the separate-entity structure and data-isolation story (3.2, 3.8) are the answer; be ready to show it.
