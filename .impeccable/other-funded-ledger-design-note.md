# Other-funded ledger: design note (impeccable + apple-design), written before any UI edit

Mode: Operate. Product register: calm, plain English, no new chrome. Restraint and simplicity are the rules that apply (apple-design 16: Purpose, Simplicity; honest status feedback).

## What changes
Two existing empty states say what is true for a participant funded another way. No new component, token, icon or layout.

## Where, and the house component
- **Funding tab** (`FundingLedger.tsx`, `LedgerBody` no-figures branch): the existing `Card` with h3 + muted paragraph. New optional prop `otherFunded` (default false). When true: heading "No NDIS budget", body "This participant is funded another way, so their shifts are not counted against an NDIS plan." Default copy untouched.
- **Claims tab** (`ClaimsTab.tsx`, `claims.length === 0` branch): the existing `EmptyState` (FileText icon). New optional props `otherFunded`, `funder`. When true: title "Not claimed to the NDIS", description "This participant is funded another way, so Bunya Support leaves them out of NDIS claims. Invoice {funder} directly." Blank or missing funder reads "their funder". Same icon, same spacing.
- Props come from `ParticipantDetailPage` (`p.fundingSource === 'Other'`, `p.fundingOrganisation`); no new endpoint.

## States
| State | Result |
|---|---|
| NDIS-funded, any tab | unchanged, byte for byte |
| Other-funded, Funding tab, server returns no plan | "No NDIS budget" card (replaces the false "No plan has started") |
| Other-funded, Claims tab, no claims, funder recorded | "Not claimed to the NDIS ... Invoice Acme Health directly." |
| Other-funded, Claims tab, no claims, no funder | same, "Invoice their funder directly." |
| Other-funded with older claims | claims table as today, no banner |
| Loading / error | unchanged PageState branches, which sit before the empty branch |
| Generate from shifts button | hidden for an Other-funded participant: generation always leaves their shifts out |

## Rules applied
Copy: plain English, no em dashes, "Bunya Support". Text wraps (no truncation); the funder name is inline text in a paragraph so a long name wraps at 390. Contrast, focus and touch targets are inherited from the existing components (nothing interactive is added). No motion.
