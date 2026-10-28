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
