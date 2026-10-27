# Offline worker portal: design note

Recorded before the first UI edit, 2026-10-27 UTC. Binding source: the PWA SHAPE brief sections 3 to 5 (copy is verbatim from it). Skills: ponytail (full), impeccable, apple-design.

Mode: Operate. A worker mid-shift on a phone, often one-handed and without signal. Nothing here is a new visual idea: house `Callout`, `Button`, `ActionBar`, `Modal`, `ConfirmDialog`, `Badge`, lucide glyphs only (nothing may depend on a font loading offline).

## What and where
- Offline notice (shift screen and My shifts): `Callout tone="info" icon={WifiOff} polite` in the slot the warning callout used. Info, not warning: only an overdue dose is warning. States: online (absent), offline with saved copy (title, body, "Shift details saved at {time}" line), offline and the list has no saved detail.
- `WaitingToSend` (shift/ui.tsx): `CloudUpload` 14px + "Waiting to send", 12px muted ink, `whitespace-nowrap`, real text so never colour alone. Used on Start, note, break, tick/untick, handover read, Finish. Removed when sent (150ms opacity, instant under reduced motion).
- `SyncRow` (first row of the sticky `ActionBar`, also FinishFlow's) and `SyncBar` (last child of `/portal`, same classes as ActionBar). Four states: Waiting, Sending, All sent (leaves after 4 s), Some not sent. Neutral tone everywhere; words carry the state. Text is a `role="status"` span mounted for the bar's life. One `secondary` button (Send now / Review), `whitespace-nowrap`, height `--control-h`. Opacity-only enter/leave so nothing above it moves.
- `NotSentModal`: house `Modal`, grouped by shift (heading from the queue record, wraps), reason row per SHAPE 4c, Discard (`ghost-danger`), Try again for Finish-blocked items, Open shift. Footer Close and (when anything waits) Send now. Discard goes through the house `ConfirmDialog`. Empty: "Nothing left here."
- Finish blocked offline: `Callout tone="warning" polite` in the submit ActionBar's notice slot; submit `disabled` with `aria-describedby`.
- Already submitted elsewhere: `Callout tone="info" polite` above the submitted state.
- Sign out with unsent changes: house `ConfirmDialog`, focus on "Stay signed in".
- Review marker: house `Badge`, neutral, "Sent from offline", title text for when it reached the server.

## States covered
Default (online, nothing queued), offline, queued, sending, sent, not sent (each reason), finish blocked, already submitted, empty, held (other user or view-as mismatch never shows), focus (all controls keep the house ring), hover (house buttons), touch (>= 44 x 44 incl. TAP_AREA).

## apple-design rules applied
Feedback on press and immediate (the screen behaves as if the write happened; the marker tells the truth). Interruptible: no input lock while sending, Send now is disabled only while sending, same label so the row does not jump. Restraint: no per-item "Sent" tick, one status line. Reduced motion: opacity only, instant when reduced. Safe areas: bars use `--mobile-nav-h`, which already counts the inset.

## FIX2 (finish review items, recorded before the first FIX2 edit, 2026-10-28)
Skills called first: ponytail (full), impeccable, apple-design. Copy is the exact strings in FINISH-PR3.md. House components only; no new ones.
- **My shifts offline Callout**: add title "You're offline" (house `Callout` title). The "Needs a connection to open" line becomes `text-xs` muted (12 px, SHAPE 3b).
- **Not sent time line**: `recordedLine(iso)` in reasons.ts: today / yesterday / weekday-date, same day logic as `savedLine`. The too-old reason no longer repeats a time. dayLabel prints "Tue 20 Oct".
- **What's New + Completions**: two unshipped seed bodies say where the feature is (My shifts, Completions). The Completions "Sent from offline" Badge loses its hover-only title; "Reached Bunya Support {time}" is real text beside it (touch and screen readers get it). 12 px muted.
- **Install card**: android variant only, a worker sentence "Today's shifts stay open even with no signal." for support workers. iOS variant and Not now/Install actions unchanged.
- **Sync row never unmounts mid-action**: the `role="status"` span is always mounted (empty text when idle) so the first change is announced; idle row is `sr-only` (takes no space, so no layout shift); NotSentModal sits outside the sr-only div so it is never clipped. SyncBar keeps one wrapper; region role, label and bar classes only while visible. States: idle (nothing visible), waiting, sending, allSent (icon in primary ink), notSent, and Nothing left here with focus on Close after the last discard. Unchanged: row stays first in the existing sticky ActionBar; install prompt steps aside while visible; Discard and sign-out confirms open on the safe choice.
- **Queued-work copy**: waiting marker on its own line under a queued note; "Started {clock(..., tz)}" in the provider zone; Before/During "Waiting to send" separator is `&nbsp;&middot;&nbsp;` inside a `whitespace-nowrap` span with the marker, so a wrap never leaves a dangling dot; the blocked-dose message ends "What you've entered is kept."
- **apple-design rules applied**: feedback stays immediate and truthful (the status is announced the moment it mounts); never trap the user (the Not sent list stays open to the end, focus lands on Close); restraint (no new elements; the sr-only row adds none); consistency (one day-label style across Not sent); vibrancy/legibility (12 px muted only for secondary lines, 4.5:1 inherited from the house token).
