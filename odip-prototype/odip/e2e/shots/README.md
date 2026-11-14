# e2e/shots

Capture scripts run on the server runner: `bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to script> <outdir>`. Helpers and their rules are in `lib/README.md`.

## Templates (copy the newest)

| Script | Shows |
|---|---|
| `role-label-tenant-users.mjs` | newest: role badges in an organisation users table, numeric checks |
| `role-label-switcher.mjs` | view-as banner and user switcher list, numeric checks only |
| `role-label.mjs` | Settings > Profile role fact; sign-in and settings stubbed with `page.route` |
| `approval-roles-display.mjs` | agreement approval line, two states, light theme, 390 touch and 1280 |
| `polish-batch-102.mjs` | smallest example: one patched response, text and href checks |

## Self-checks (no app needed)

- `lib-selftest.mjs`: `lib/capture.mjs` crops an element taller than the 390 viewport and keeps touch emulation.
- `capture-helper-selfcheck.mjs`: `overlapCheck` bottom-edge samples and `hideChrome`.
- `layout-checks-proof.mjs`: `layoutCheck` and `fullPage` give exactly the faults their fixtures hold.

## Rules

- Copy the newest template; use `cropElement` and `fullPage` from `lib/capture.mjs`.
- Delete your script in the PR after the one that merges it, unless it is a better template.
