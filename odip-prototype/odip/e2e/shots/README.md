# e2e/shots

Capture scripts run on the server runner: `bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to script> <outdir>`. Helpers and their rules are in `lib/README.md`.

## Templates (copy the newest)

| Script | Shows |
|---|---|
| `role-label-tenant-users.mjs` | newest: crop plus full page of a tenant users list at 1280 and 390 |
| `role-label-switcher.mjs` | a header switcher crop at both breakpoints |
| `role-label.mjs` | settings page role label crops |
| `approval-roles-display.mjs` | approvals role display crops and full page |
| `polish-batch-102.mjs` | smallest example: one crop and one full page |

## Self-checks (no app needed)

- `lib-selftest.mjs`: `lib/capture.mjs` crops an element taller than the 390 viewport and keeps touch emulation.
- `capture-helper-selfcheck.mjs`: `overlapCheck` bottom-edge samples and `hideChrome`.
- `layout-checks-proof.mjs`: `layoutCheck` and `fullPage` give exactly the faults their fixtures hold.

## Rules

- Copy the newest template; use `cropElement` and `fullPage` from `lib/capture.mjs`.
- Delete your script in the PR after the one that merges it, unless it is a better template.
