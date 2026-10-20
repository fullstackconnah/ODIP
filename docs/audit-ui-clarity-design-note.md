# Audit UI clarity — prospective design note

Mode: Operate. Baseline: `origin/main` `f4f8030b3225b193aadd6e9b2dc692b7db320478`.

1. **PRN outcome:** retain the existing protected modal and actions. When the pending administration ID resolves exactly against loaded MAR data, show one compact contextual block: participant, medicine/strength, and the actual administration timestamp/dose. With no exact record, show no inferred dose context.
2. **Dashboard:** keep Alerts before decisions and retain each destination link. Combine the critical count into its heading and make critical items compact linked rows, using existing semantic critical color only as an indicator.
3. **Claim notes:** line items remain the primary review surface. An empty note editor is a labeled disclosure; existing or intentionally opened notes remain editable with the existing save/status/error path and a real label/input association.
4. **Alpha sign-ups:** on phone, the first scan exposes name, organisation, status and the retained actionable request. The follow-up warning precedes collapsible historical submissions; wording preserves that retained content can be older than the latest received submission.
5. **Public validation:** preserve inline field errors and focus; the summary uses a direction-neutral singular/plural sentence.

States preserved across the five changes: normal, empty, loading, error, keyboard focus, hover/touch, and role/permission restrictions. No new components, dependencies, APIs, mutations, or visual world changes.
