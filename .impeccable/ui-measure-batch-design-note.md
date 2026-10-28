# Design note: ui-measure batch (written before the first UI edit, 2026-10-28 UTC)

Skills called first: ponytail:ponytail (full), impeccable:impeccable, apple-design. Mode: Operate. Class changes only; no new components.

1. IntakeBookingPanel footer (390 coarse, booked + dirty + invite): add `whitespace-nowrap` to footer buttons, let the row wrap (`flex-wrap`, `gap-x-3 gap-y-2`, `gap-x-2` under sm), right button group gets `ml-auto`. Fits one row at 390 (350 of 357); wraps by whole buttons at 360, never mid-label. House component: Footer slot + `Button`. States unchanged: unbooked `<span />` placeholder, disabled/aria-disabled, 44px coarse height, md+ one row.
2. DataTable pager (below md): wrap, `gap-y-2 py-2 mt-3`, spans `whitespace-nowrap`, button group `max-md:ml-auto`. Row 1 "Showing", row 2 "Page n of m [Previous][Next]". md+ unchanged (34px, one row). aria-live / aria-current / aria-labels / disabled / single-page-hidden unchanged. Pin logic untouched.
3. ActionButtons icon buttons (coarse): the house ghost wash `pointer-coarse:bg-[var(--color-accent)]` (Archive: `--color-error-container`, the ghost-danger pair) and `pointer-coarse:rounded-md`, matching `buttonClasses.ts` ghost. Mouse look, 36px visual / 44px hit, gap-2, labelled mode unchanged.
4. TripsPage: trip code hides to 1535 (was 1366) so the table fits at 1440 and the opaque pin fill never covers Lead. Budget comment updated. No column removed.

apple-design rules applied: feedback on press and touch affordance visible at rest (3), restraint and consistency, familiarity (one house wash), flexibility across pointer types, no mid-word breaks (clarity). No motion added.
