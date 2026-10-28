# Small UI polish: design note (written before the first UI edit)

Skills called first: ponytail:ponytail, impeccable:impeccable, apple-design. Mode: Operate (app UI). Refinement: the incumbent look, copy and behaviour stay.

## 1. Underline tabs: focus ring clipped
- What/where: `components/Tabs.tsx` underline button class. `ring-offset-1` becomes `ring-inset`. `sub` chips unchanged.
- House component: Tabs itself; `ring-inset` is house idiom (DataTable, NotificationList).
- States: unfocused (no ring); focus-visible (2px ring in `--color-ring`, inside the button box, so the list's overflow cannot clip it); active tab (2px bottom border still on the list baseline); touch (44px min height, same height focused or not); `overflow='scroll'` (mask fade and `pr-8` unchanged). No layout change.
- apple-design: restraint, feedback that is visible but never moves layout; keyboard focus is the only trigger.

## 2. Notes and plan-dates folds: stay open when cleared
- What/where: new `hooks/useStickyOpen.ts`; used on the Notes `<details>` (`AddActivityModal.tsx`) and the "Different NDIS plan dates?" `<details>` (`AgreementStep.tsx`).
- House pattern: a small hook beside `useFillOnce`; the fold stays a native `<details>` with the existing `group` chevron.
- States: closed on a blank add / no override; open at mount with prefill or override; opens when content arrives later (typing, library pick); STAYS open when content is cleared (and after "Use the recorded dates"); a manual close sticks until content goes false to true again. The chevron `group-open:rotate-180`, `sm:col-span-2` and `data-fold-static` are untouched.
- apple-design: agency and forgiveness, the control never moves under the person's hands.

## 3. Shift folds: Show becomes Hide when open
- What/where: `pages/portal/shift/ui.tsx`, `Section collapse` summary and `Fold` summary.
- Method: CSS only. Named groups `group/section` and `group/fold`, so a Fold inside an open Section keeps its own label. Two underlined spans, "Show" (`group-open/NAME:hidden`) and "Hide" (`hidden group-open/NAME:inline`); both 4 characters so the row does not reflow; the hidden one is display:none so assistive tech reads one word.
- States: closed reads "Show"; open reads "Hide"; the 44px summary row, `list-none`, hidden marker, `data-collapsed-section`, `id` and the non-collapse Section are unchanged; summary stays visible when open.
- apple-design: the label tells what a tap will do (feedback and predictability); nothing animates.
