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
