# Participant sub-tabs: design note (written before the first edit, 2026-10-28)

Skills called first: ponytail:ponytail (full), impeccable:impeccable, apple-design. No visual change in either fix; both are focus or default-state changes.

## Fix 1: focus returns to the current chip after a vetoed switch
- What: when a tab or sub-tab switch is vetoed by the Discard changes dialog (Keep editing), DOM focus and the roving tabindex return to the chip that is still selected.
- Where: `components/Tabs.tsx` (tab button `onFocus` sets `focusedId`); `pages/ParticipantDetailPage.tsx` (`refocus` ref set when `guarded` parks a switch; an effect refocuses the selected chip of that tablist once `pendingSwitch` is null).
- House components: Tabs (main and `variant="sub"`), ConfirmDialog (unchanged copy, focusCancel stays).
- States: vetoed arrow, vetoed Home/End, vetoed mouse click (lead decision: focus also returns to the current chip), Discard (switch happens; the effect lands on the new selected chip, harmless), clean switch (no dialog, no effect), main strip and sub strip, uncontrolled Tabs elsewhere (onFocus only syncs the roving marker to the focused tab, same as the existing click/arrow paths).
- apple-design: interruptibility and spatial consistency (the user returns to where they were), no latency (focus restored in the commit that closes the dialog), no new motion. Reduced-motion unaffected. Focus ring unchanged (existing focus-visible styles).
- impeccable: accessibility (roving tabindex 0 on the selected chip, so Tab re-enters the strip at the right place; focus return to a sensible element after a dialog).

## Fix 2: an editor's empty fixed-list sub-tab opens
- What: `NotRecordedFold` takes optional `defaultOpen`; `FixedListFrame` passes it, so Conditions, Daily living and Consents show their rows at once for an editor with nothing answered.
- Where: `pages/participant-detail/NotRecordedFold.tsx`, `FixedListFrame.tsx` (its only callers are the three sections). `data-fold-static` is set when open by default so PR #440's fold fade does not animate an already-open fold.
- House component: NotRecordedFold (native `<details>`, chevron turns via `group-open`).
- States: editor with nothing answered (open, can still collapse via summary click, Enter or Space; chevron shows rotated), viewer (plain line, no `<details>`), zero rows (plain line), some answered (no fold, count and reveal button), deep link `#daily-living` etc. (useScrollToHash sets `open`, harmless when already open), mobile 390 (same layout, summary keeps its 44px control height), focus ring on summary unchanged.
- apple-design: restraint and agency (content first, the fold still collapsible); no copy change, no motion added.

## FIX3
- Focus after the unsaved-changes dialog: Discard puts focus on the chip the user asked for (the newly selected one), on the main strip and the sub strip, by keyboard and mouse; Keep editing keeps it on the current chip, as before. No visual change: same roving tabindex, same focus ring. The dialog's own focus trap while open, page load and clean switches are untouched.
- apple-design: agency and familiarity (the thing you chose is the thing that has focus); impeccable: accessibility (focus never lands on a deselected control).
