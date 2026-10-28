# Agreements B: design note

The shape brief for PR B is SHAPE.md in the lead's scratchpad (agreements/). This file keeps the fix-round notes with the branch.

## FIX1

- **Renew disabled for a role that can't approve** (`pages/agreements/AgreementsBulkBar.tsx`).
  - What: the Renew action is disabled when `!canApprove`. Reprice and Extend stay enabled for that role. The pattern is the bar's existing one: the desktop line beside Clear (the same `text-sm` muted slot that holds `approveReason`/`note`) and, on a phone, the menu item's own `description` line (as Approve already does).
  - Reason line, exact: "Your role can't renew agreements. An Admin can change who may approve in Settings, Plan pricing."
  - States: approver (Renew as today); non-approver with rows ticked (Renew disabled with reason, the others enabled); none ticked (all off, no reason line); more than 100 ticked (the "Choose 100 or fewer" reason wins, it is the louder one).
  - House components: `Button` (disabled), `Dropdown` menu item `disabled` + `description`. No new element.
  - apple-design: forgiveness and agency (don't offer an action that can only fail; say why), familiarity (same disabled-with-reason pattern as Approve).
- **Server-worded Callout for a refused whole request** (`AgreementActionDialog.tsx`).
  - What: 400 and 403 show the server's first error (`extractErrorMessage`), then " Nothing was changed."; no message falls back to "Something went wrong. Nothing was changed." The 429 and no-answer Callouts, tones and "Show drafts waiting" are unchanged.
  - House component: the dialog's existing `Callout` (tone unchanged). States: 400, 403, 429, no reply, other: all as before except the words.
  - apple-design: feedback says what happened in the server's plain words, and confirms nothing changed.

## FIX2 (written before the first FIX2 edit)

1. **The bar sticks below xl** (`AgreementsBulkBar.tsx`, the list wrapper in `AgreementsPage.tsx`, the review's group in `AgreementsReview.tsx`).
   - What: below `xl` the bar is `sticky` at `top-[calc(3rem+var(--safe-top))]` (the app header's own height, `AppLayout.tsx` header), `z-20` under the header's z-30, filled `--color-card` (opaque, so no row shows through), with `--shadow-hairline` (the header's own shadow). At `xl` and up it stays in flow. The bar's content row is unchanged, so ticking moves nothing.
   - Where: a sticky element only holds inside its parent, so the list page's bar now shares a parent with the table (the wrapper closes after the table or empty state instead of before it). The review's bar already shares its group's parent.
   - States: unticked, ticked, over 100 (danger line), phone (Actions menu opens from the stuck bar), dark, reduced motion (no motion added).
   - apple-design: translucent/hairline chrome stays out of the content's way; the bar never covers the last row (it sits at the top, not the bottom nav).
2. **Make counts only what will be made** (`AgreementActionDialog.tsx`, `agreementRows.ts`). Button reads `Make N drafts` where N = ticked minus skips (`bulkSkipCount`); every row skipped: disabled `Nothing to make`. States: none skipped, some skipped, all skipped, running (unchanged "Making N drafts…").
3. **Empty price list** (dialog, Reprice). `lists` loaded and empty: the field's one option reads `No price lists yet` (disabled select) and below it `An Admin can add one in Settings, Plan pricing.` (muted, 14px, like the dialog's other lines). Make stays disabled. Loading and error are unchanged.
4. **No "0 drafts"** (`AgreementsReview.tsx`): `No drafts were made.`
5. **Phone cards label the two dates** (review table). DataTable's caps labels are off for `mobile` columns, so the date cells render their column header as a small medium-weight prefix, `md:hidden`; desktop is unchanged.
6. **Focus ring on the notices block** (review): `rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]`, the house pattern. Headings with `tabIndex={-1}` stay ring-free. State: focused after a keyboard Approve.
7. **403 with no server message** (dialog): `Your role can't do this. Nothing was changed.`; 400 keeps `Something went wrong.`; server messages win.

## FIX3 (written before the first FIX3 edit)

1. **Phone card date label** (`AgreementsReview.tsx` `dated`). What: label and value share one wrapper `<span>`; the space sits inside the label (`{header} `), so the card reads "Last term 17 May 2026". Label is muted (`--color-muted-foreground`), not `font-medium`; still `md:hidden`, so desktop is unchanged. House pattern: DataTable meta cell, muted secondary text. States: phone card with and without a date (empty stays empty), desktop. apple-design: hierarchy by tone not weight (value leads, label recedes), proximity of label and value.
2. **In-flight copy** (`AgreementActionDialog.tsx`). What: "Making N drafts…" (line and button) uses `makeCount`, matching "Make N drafts"; the progress line counts agreements checked: "Working… n of total agreements checked". Title still counts ticked rows. States: nothing skipped, some skipped, long run (progress line). apple-design: feedback is specific and consistent with the button the person pressed.
3. **Bar gap** (`AgreementsBulkBar.tsx`). What: drop `mb-3`; parents are already `gap-3`, so the bar sits 12 px above the first row (house card spacing). States: sticky and in-flow bar, unticked and ticked.
4. **Plural** (`outcomeWords.ts`). "1 needs review", "2 need review". Copy only; the notice and its tones are unchanged.
