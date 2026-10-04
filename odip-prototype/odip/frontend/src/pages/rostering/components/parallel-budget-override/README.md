# Budget override / emergency — presentational components

Source-only slice of budget phase 3 (`SPEC-P3.md`): the three components that show a person
**why** an ad-hoc shift is going past the recorded budget, **what they must write** to go ahead
anyway, and **what was recorded** afterwards.

Built at the accepted phase-1 base `c53533597d0f8163dea7cd321b807de9394c3215` (#190) on branch
`feat/hermes-budget-override-ui`. Nothing outside this folder is edited. There is no API call, no
hook, no mutation and no route in here: the components are handed a server's answer and render it.

## What is here

| File | What it is |
|---|---|
| `BudgetOverrideReasonFields.tsx` | The two ways through an over-budget ad-hoc shift, and the written reason each needs. |
| `BudgetFindingDetails.tsx` | The authoritative pool / period / remaining / cost / overrun readout. |
| `BudgetEmergencyReviewMarker.tsx` | The compact marker a shift saved over budget carries, with its audit facts. |
| `budgetOverrideTypes.ts` | The view model and the pure rules over it (no JSX, no hook, no arithmetic). |
| `budgetFigures.ts` | How a server-sent figure reads on screen, and the one sentence naming the overrun. |
| `fixtures.ts` | Literal server answers for the tests. Not a shared test-fixtures file. |
| `index.ts` | The public surface. Import from here; nothing inside is reached around it. |

## The contract in one page

### `BudgetOverrideReasonFields`

Fully controlled. It holds no state: it renders what it is given and calls back. A caller owns
`choice`, `reason`, `submitted`, `pending`, `disabled` and `error`.

```tsx
<BudgetOverrideReasonFields
  findings={findings.filter(f => f.code.startsWith('BUDGET_'))}
  capabilities={{ canOverrideAsAdmin, canRecordEmergency }}
  choice={choice}
  reason={reason}
  submitted={submitted}
  pending={createShift.isPending}
  disabled={!canWrite}
  error={saveError}
  onChoiceChange={setChoice}
  onReasonChange={setReason}
/>
```

- **Rendered as nothing at all** when `findings` is empty. A reason field is not a voluntary note
  on an ordinary shift; that is `RosterGateFields`' job.
- **Pass the budget findings only.** This component shows them with the shared `FindingsList`, so
  handing it a staff-leave finding too would print that finding twice on the shift panel.
- **`capabilities` is the caller's answer**, derived from the real session role. This folder reads no
  hook, no session and no permission table. A presentational component that guessed would be a
  second source of truth about who may do what.
- **An unauthorised path is not rendered**, disabled or otherwise. Only the authorised choices appear.
- **It shows no money of its own.** The server's finding text passes through verbatim (it is the
  server's sentence, and whether a restricted viewer is sent one at all is the server's decision).
  Place `<BudgetFindingDetails>` separately for the figures — that component honours `restricted`.
- **No prop can switch the emergency path off.** The owner decided it cannot be switched off, so
  there is no such prop, and the component's copy says so.
- **`submitted` gates the validation.** Nothing complains until a save was attempted or the server
  refused, so a first word is never interrupted.

Wiring it to a save (the integration owner's job, not this lane's):

```tsx
if (!canSubmit(choice, reason)) { setSubmitted(true); return }
await createShift.mutateAsync({
  ...payload,
  overrideReason: storedReason(choice, reason),          // emergency path gets the server's prefix
  acknowledgedFindingCodes: [                          // the code is what the marker reads
    ...warningFindings.map(f => f.code),
    ...(choice === 'emergency' ? [BUDGET_FINDING_CODES.emergency] : []),
  ],
})
```

`canSubmit` is a client-side courtesy for the button, not the enforcement: the server re-checks
every save, and the component says so on screen.

Two obligations ride on that snippet, and they belong to the integration owner, not to this lane:

- **De-duplicate the codes.** `warningFindings.map(f => f.code)` produces a duplicate entry
  whenever a participant has two findings with the same code (two over-budget pools both
  `BUDGET_FORECAST_OVER`). The shared `FindingsList` then logs React's "Encountered two children
  with the same key" warning. Spread a `Set` instead: `[...new Set(warningFindings.map(f => f.code))]`.
- **The marker depends on which codes you send.** `markerForAcknowledgedCodes` grants the Admin
  override marker for `BUDGET_FORECAST_OVER` **only**. A shift that is merely `BUDGET_APPROACHING`
  or `BUDGET_OVER` gets **no** marker, and neither does an unrecognised `BUDGET_*` code: an Admin
  override is an Admin's act with an audited reason behind it, so a no-reason warning can never
  be one. Send the codes the user actually acknowledged, and a warning-only shift will not be
  dressed up as an override.

### `BudgetFindingDetails`

```tsx
<BudgetFindingDetails figures={figures} />
```

`figures` is `BudgetPeriodFigures`: `pool`, `period`, and five `BudgetFigure` values
(`available`, `remaining`, `shiftCost`, `projectedTotal`, `projectedOverrun`), plus optional
`restricted`.

A `BudgetFigure` is one of three things, and keeping them apart is the whole point:

| Value | Prints | Means |
|---|---|---|
| `{ kind: 'value', amount }` | `$8,000.00` | the server's number, including `$0.00` |
| `{ kind: 'notRecorded' }` | `–` | the server said nothing is recorded |
| `{ kind: 'unknown' }` | `–` | the request has not answered, or failed |

- **No arithmetic anywhere.** Nothing sums, subtracts or compares. `remaining` is the server's
  remaining, not `available` minus `used`, because the server knows about roll-forward and this
  component does not.
- **A missing forecast is not a zero**, and a missing allowance is not a zero. Both print an en
  dash, and both get a screen-reader-only sentence saying which kind of missing it is.
- **`restricted: true` puts no amount in the DOM** and says `Hidden` in every money cell, so
  nothing can be inferred from which figure happens to be blank. Pool and period still show: they
  are not money, and the reader needs to know what the warning is about.

### `BudgetEmergencyReviewMarker`

```tsx
const kind = markerForAcknowledgedCodes(shift.acknowledgedFindingCodes)   // 'emergency' | 'adminOverride' | null
if (kind) {
  <BudgetEmergencyReviewMarker details={{ kind, state, reason, recordedAt, reviewedBy, reviewedAt, reviewTaskTitle }} />
}
```

- **`markerForAcknowledgedCodes` is mandatory, not a convenience.** The marker is read from the
  codes the server acknowledged. `Shift.OverrideReason` is free text that the server prefixes with
  `"Emergency or safety: "` on the emergency path — but nothing stops a coordinator typing those
  words into an ordinary override reason, and a marker parsed out of the string would put a false
  emergency into a compliance audit record. This is design finding **F-16**.
- **The Admin override marker is earned by `BUDGET_FORECAST_OVER` and nothing else.**
  `markerForAcknowledgedCodes` tests for that one exact code. `BUDGET_APPROACHING` and
  `BUDGET_OVER` are **no-reason warnings**, so a shift that is only approaching — or that is over on
  the server but was never pushed past — can never have been overridden, and it gets **no** marker.
  An unrecognised `BUDGET_*` code also gets none: a prefix match is what previously let a warning, or
  a code this lane has never seen, forge "Over budget: Admin override" onto a shift nobody
  overrode. A marker is an audit claim, so it is only rendered when a code supports it.
- **`BUDGET_EMERGENCY` outranks everything.** When the emergency code is on the save, the
  emergency marker wins regardless of which other codes accompany it — it is the stronger, later
  fact, and an Admin override on the same save is its administrative shadow.
- **No invented approval.** There is no `approved` state. A pending emergency says
  "Admin review pending" in the warning tone and carries the sentence "this has not been approved".
- **A missing reviewer says so.** The row reads `Reviewed by: Not reviewed yet`. An absent row
  would read as "nobody needs to review this", which is the one reading a pending safety shift
  must never give.
- **A restricted view renders the marker and the review state, and nothing else** — no reason, no
  reviewer, no task title.
- **Not a link.** The board chip around it is the target; a nested link inside a clickable chip is
  a keyboard trap.
- **`data-budget-marker="emergency" | "adminOverride"`** on the root, for the board chip and the
  slide-over to find it by.

### Copy, and what it must never say

These are the owner decisions (shape rounds 1–3) as this lane renders them. A future edit that
contradicts one of these is a policy change, and needs the owner, not a reviewer.

- Warnings are the **default**. Hard limits are a Settings switch this lane does not touch.
- **Only an ad-hoc shift's overrun may ever be hard-blocked.** Nothing in this folder blocks an
  agreement, a claim, or a delivered support.
- **Never blocked, in any mode:** recording a support that was actually delivered. The wording
  never says a shift cannot be saved or that support cannot be claimed; a test asserts the absence
  of such a sentence.
- An **Admin override** is an Admin's, with a written reason recorded in the audit log.
- A **Coordinator's emergency or safety** reason always remains possible, saves at once, and is
  reviewed by an Admin afterwards. It cannot be switched off.
- The minimum emergency description is 10 trimmed characters. Ten spaces of padding is not ten
  characters of explanation, and there is a test for exactly that.

## The three design-preflight findings this lane acts on

From `t_1fbc9426` (design preflight, source-only, not parent-verified):

- **F-16 (mandatory, applied here).** The marker comes from `AcknowledgedFindingCodes`, never from
  parsing the stored reason. Implemented as `markerForAcknowledgedCodes`, with a test that a
  coordinator typing the emergency prefix into the wrong box cannot forge a marker.
- **F-19 (recommended, applied here).** The emergency description has its own label, "What made this
  an emergency or safety need", and a hint that states the 10-character minimum and that an Admin
  reviews it afterwards. It is a separate field from the Admin override reason, in DOM order after
  the emergency control.
- **F-22 (recommended, applied here).** This lane adds **no** `role="status"` region. The pending
  state is a visual line, because `ShiftSlideOver` already keeps the panel's one polite region and
  its tests assert there is exactly one. A test asserts zero live status regions here.

Found but **out of this lane's write boundary** — reported to the parent, not fixed here:

- **F-01, F-02, F-06, F-07, F-08** are in `ShiftSlideOver.tsx`, which this lane may not edit. F-08
  in particular (the emergency control belongs in the body, not the footer beside Delete) is a
  placement decision the integration owner makes when they place `<BudgetOverrideReasonFields>`;
  this component is a body-level block and is ready to drop in under the refusal.
- **F-03, F-04, F-05** are in `FindingsList` / `RosterGateFields`, the shared-primitive owner's files.
  This lane reuses both unchanged. Filtering to `BUDGET_*` codes does **not** make the duplicate-key
  problem (F-04) unreachable from this call site: `FindingsList` keys by `finding.code`, and a
  participant with two over-budget pools has **two findings with the same `BUDGET_FORECAST_OVER`
  code**. React then logs "Encountered two children with the same key", and the duplicate flows
  straight into `acknowledgedFindingCodes` as two identical entries. This lane is not editing the
  shared primitive; **de-duplicating the codes before sending them is the integration owner's
  obligation** at the wiring points above (see the two notes under "Wiring it to a save").
- **F-26** (marker words in `title` *and* accessible name on the board chip) is a `ShiftChip`
  concern, in the same out-of-boundary group as F-01.

## Known obligations this slice deliberately does NOT discharge

Recorded so nobody reads a green suite here as more than it is. None of these is fixed in this
folder, and each needs its owner:

- **Restricted viewers get no money (F-13).** Correct by design here — this folder shows no figure
  of its own, and whether a money-bearing finding is sent to a SupportWorker or ReadOnly at all is
  the **server DTO's** decision. A client-side filter would be a false second security boundary.
  The integration owner *may* additionally strip budget findings for restricted roles as defence
  in depth in the `findings.filter(...)` above; it is not required by this slice.
- **De-duplicate `acknowledgedFindingCodes` before sending them** (the F-04 duplicate-key route
  above). Two findings with the same code produce a duplicate entry, which React warns about in
  `FindingsList` and which reaches the server. The marker itself is unaffected — a repeated
  `BUDGET_FORECAST_OVER` still reads as one genuine override — but the warning and the redundant
  code are still the caller's to remove.
- **Unknown codes are not markers.** `markerForAcknowledgedCodes` only knows
  `BUDGET_FORECAST_OVER` and `BUDGET_EMERGENCY`. If phase 3 adds a third over-budget code, adding
  it here is a deliberate contract change, with its own test — never a prefix match.
- **K1–K10 rendered scenes, the real shift panel, and any API, enforcement, Settings or migration
  behaviour** are the integration lane's, and are not exercised by these component tests.

## Rendering, testing and what is NOT claimed

- Uses the real shared primitives and design tokens only: `FormField`, `FindingsList`,
  `StatusBadge`, the `--color-*` tokens, `TONE` semantics, `formatCurrency`, `formatDateTimeAu`.
  No new colour, no new font, no new control.
- **Tested:** 154 tests across 4 files, focused Vitest with `--maxWorkers=2`, plus whole-project
  `tsc -b`, whole-project `npm run lint` compared against a measured pre-change baseline, and
  `npm run build`.
- **NOT claimed, explicitly:** no screenshot, no browser, no rendered layout, no 200% zoom pass, no
  390px reflow measurement, no contrast measurement over tinted parents, and no accessibility
  conformance. jsdom does no layout, so the "long content at a phone width" tests assert on
  wrapping classes and preserved text, **not** on pixels. The K1–K10 rendered scenes in the design
  preflight remain for the integration lane, on the real shift panel, where this component is
  actually placed.
- **This is not a finished feature.** There is no API adapter, no enforcement, no migration, no
  Settings change and no review task. It is importable, tested presentational source.
