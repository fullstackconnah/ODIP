# Shift cancelled notice: design note (written before the first copy edit)

Owner ask: tell a worker when their published shift is cancelled. No new UI surface: the bell row and the email already exist; only their words are new.

## Copy
| Where | Words |
|---|---|
| Bell | "Your shift with {participant} on {Tue 3 Nov} at {9:00 am} was cancelled." Links to /portal/shifts/{id} (a cancelled shift's page still opens and says "This shift was cancelled.") |
| Email subject | "Shift cancelled: {participant} on {date}" |
| Email body | "Your shift with {participant}, {date} {start} to {end} has been cancelled." plus the existing "View your shifts" link |
| Bell for "taken off" (was blank) | "You've been taken off {participant} on {Tue 3 Nov} at {9:00 am}." Links to /portal, as the email does |

## Rules the copy follows
- Plain, first person to the worker, past tense, the fact first. No reason (Notes are internal), no apology filler, no blame.
- Same date and time formats as the ShiftAssigned and ShiftUnassigned texts; a missing participant reads "a participant".
- One notice per worker per cancel: the cancel replaces "taken off".
- States: Draft, unassigned and past-date cancels send nothing; un-cancel sends the existing "You're rostered with".
- apple-design: purpose and restraint (one short sentence, the answer to "what happened, which shift"), familiarity (reuses the house bell and email layouts), agency (the link goes straight to the shift). No motion, no new component.
