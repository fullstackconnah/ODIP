# Motion PR 3: design note (written before any edit)

Skills called first: ponytail:ponytail (full), impeccable:impeccable, apple-design. Mode: Operate.

## What moves
1. **Folds:** `details[open] > :not(summary)` fades in, opacity only, 150 ms ease-out, inside `prefers-reduced-motion: no-preference`. No height animation, close instant. House curve elsewhere in index.css is ease-out / cubic-bezier(0.2,0,0,1); ease-out matches SlideOver/rail. Applies to every native details (portal Fold, agreement folds, AddActivityModal, sidebar "other workspaces").
2. **Portal routine tick** (DuringSection): box `transition-colors duration-100 ease-out` (fill + border); Check icon fades in over 100 ms using a tiny `.tick-in` opacity keyframe (the icon is mounted conditionally, so a transition cannot run on it). No scale, no bounce. Hit area, layout, busy dim (`disabled:opacity-60`), Waiting marker unchanged.
3. **Spinners under reduced motion:** the product-wide reduce rule forces `animation-iteration-count: 1` and 0.01 ms, freezing `.animate-spin`. A loading signal is essential motion, so a later `.animate-spin` rule in the reduce block restores `1s infinite`. Same specificity as `*` plus later source order plus !important both sides: ours wins on class specificity (0,1,0 > 0,0,0). `.animate-pulse` skeletons stay frozen (decorative).

## States
- Fold open: content fades 0 to 1 over 150 ms; summary unchanged. Fold close: instant. Open at page load: content fades once on mount (accepted; reported if it double-moves inside a fading page root).
- Fold, reduced motion: global rule makes it 0.01 ms, i.e. instant; the keyframe is not even declared as active (no-preference block).
- Tick: box fill/border 100 ms, check fades 100 ms. Untick: fill/border fade out 100 ms, check unmounts at once (no exit animation, matches "close instant" elsewhere). Tick while saving/busy: button disabled, 60% dim as before, transition still runs on state change. Waiting-to-send tick (offline queue): optimistic isChecked flips the same way; WaitingToSend marker unchanged.
- Tick, reduced motion: global rule zeroes transition and animation durations (colour still changes, instantly).
- Spinner, reduced motion: turns at 1s linear infinite (Tailwind's own `linear`).

## apple-design rules applied
Response (feedback instant, 100 ms is below perceptible lag), restraint (no scale/bounce on a routine tick), reduced motion (opacity/colour kept, spatial motion dropped; essential loading signal kept), interruptibility (transitions retarget from current value; close instant so nothing blocks input).

## Not changed
Summary looks and keyboard behaviour, tick row layout/hit area, offline queue, PR 1 and PR 2 files and lines. What's New: none.

## FIX1
Two more spinners keep turning under reduced motion (essential loading motion, decision 3): InvoicesPage download `Loader2` (`motion-safe:animate-spin` becomes `animate-spin`) and SyncRow `Loader2` (dropped `motion-reduce:animate-none`). No other spinner uses either class; no visual change with motion allowed.
Stale ParticipantDetailsFold comment corrected: the fold content fades in over 150 ms (global `details[open]` rule); apple-design rules applied: reduced motion keeps essential signals, restraint.

## FIX2
A fold that is open when it mounts doesn't fade (`data-fold-static`: sidebar "Other workspaces", Notes with saved text, Participant details open on edit); only a fold the user opens fades (150 ms opacity, close instant).
apple-design applied: restraint (no motion on first paint of a state the user didn't trigger), response (a user-opened fold still answers at once with the fade).
