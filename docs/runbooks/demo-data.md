# Demo data top-up: switches, shipping a new pack, and clearing it out

The Demo tenant (the one active tenant named `Demo` on `demo.odip.com.au`) is kept current by an hourly job in the API,
`DemoDataHostedService`, which asks `DemoDataMaintainer` to run a list of packs. Each pack adds the rows that tenant's roster, shift
package, medication chart and incident register would have by now, and moves a few of them forward in time. The code is in
`odip-prototype/odip/backend/Odip.Infrastructure/DemoData`; the tests that hold it to the app's own rules are in
`Odip.Tests/DemoData`.

What it will and will not do, because the production host has it switched on:

- It writes only to the Demo tenant, through a context guarded by `DemoTenantGuard`, which refuses a row for another tenant, a row that
  points at a person of another tenant, a type that is not on its allow-list and any change to a column that is not on its list.
- It **never deletes** anything. Switching it off stops later ticks; it does not remove what it wrote. The only way to remove the rows is the
  purge in the last section, which is the owner's to run by hand.
- A pack is one transaction, and a pack that fails rolls back and logs without stopping the others. Inside the live-set pack each live shift
  is its own savepoint, so one shift that cannot be written is undone whole, named in the log (`live-set: live-morning 2026-10-02`) and
  tried again at the next tick, while the other shifts and the later packs carry on.
- Rows it writes carry deterministic ids (UUID version 8, `DemoIds`), so a second tick finds them and adds nothing; the audit rows the database
  layer writes about them have random ids and are found by the id of the row they describe. A row a person makes in the portal has a random id;
  where the app holds a row to a natural key (one acknowledgement per reader and handover, one running break per completion, one tick per
  completion, routine and occurrence) or a rule (one active record per scheduled medication slot) the script looks for the key and leaves the
  person's row alone. The one exception is the finish of a live shift, which ends a break that is still running, whoever started it, as the app's
  Finish requires.

## Switches

Set in the stack's `.env` on the host; `deploy/compose.yaml` passes them to the API container, so a change needs `docker compose up -d`.

| Setting | Variable | Default | Effect |
|---|---|---|---|
| `DemoData:Scenarios` | `DEMO_DATA_SCENARIOS` | `Off` | Only the exact word `On` switches the top-up on. Anything else is Off and is reported once in the startup log. |
| `DemoData:Packs` | `DEMO_DATA_PACKS` | empty | The packs that may run, by name, comma-separated, any case. Empty is every pack. A name that is not a pack matches nothing and is reported in the startup log. |
| `DemoData:FirstRunDelaySeconds` | none | 30 | Wait after the host starts before the first tick (0 to 3600). |
| `DemoData:IntervalMinutes` | none | 60 | Gap between ticks (1 to 1440). |

## The packs, in the order they run

A pack may rely on rows an earlier pack wrote, and skips (and says so in the log) a story whose people or rows are missing. The names are
what `DEMO_DATA_PACKS` takes.

| Name | Writes |
|---|---|
| `provider-settings` | the provider settings row (state and time zone), when the tenant has none |
| `staff-credentials` | moves the expiry dates on existing staff (columns only, never identity or role) |
| `compatibility` | staff and participant compatibility cells |
| `emergency-contacts` | people and the contact roles that link them to participants |
| `shift-patterns` | the recurring shift patterns |
| `leave-and-availability` | leave requests, recurring unavailability and staff availability |
| `roster-weeks` | shifts and the completions of the ones that have ended; moves shift statuses forward |
| `leave-coverage-tasks` | the tasks that ask a coordinator to re-cover a shift a staff member's leave takes |
| `medications` | the participants' medication charts |
| `live-set` | three live shifts a day that follow the provider's clock: start, doses, break, note, routine tick, handover, finish |
| `medication-history` | a week of medication administrations (with witnesses) outside the live shifts |
| `shift-package-history` | breaks, notes, routine ticks and read handovers on the closed shifts |
| `incidents` | the twelve incidents, the notes two of them hang from, and the script that ages them |
| `notifications` | the terminal notification rows for the shift package's and the incidents' events |

## Shipping a new pack Off

A pack writes into a live tenant every hour and nothing it writes is ever deleted, so a new pack should be able to deploy without running.

1. In the host's `.env`, set `DEMO_DATA_PACKS` to every pack that already runs, comma-separated, and leave out the new one. Deploy as usual.
   The startup log line `Demo data top-up is On: ...; packs: ...` lists what will run.
2. Check the first tick's log line. When the new pack's rows are wanted, add its name to the list and run `docker compose up -d`, or empty the
   variable to run everything.
3. A name that is mistyped matches nothing, so that pack stays off, and the startup log says which name is not a pack.

To stop everything, set `DEMO_DATA_SCENARIOS=Off` (nothing is removed).

## Clearing it out

This is the owner's reference only: nothing in the repository, the deploy or the app runs it, and a person should read every line first.
It removes the rows the top-up wrote, found by their ids (UUID version 8: the 15th character of the text form is `8`; the old seed's ids are
hand-written and the app's own are random, so neither matches), together with the rows people made on top of them, which hold them by
`Restrict` foreign keys and would otherwise stop the delete (an acknowledgement, break, tick or note on a demo shift or completion, a dose
recorded on a demo medication, a contact role on a demo person, a notification log of a demo outbox row). Rows removed are in children-first
order, which `DemoRunbookTests` checks against the EF model.

Before you run it:

1. Set `DEMO_DATA_SCENARIOS=Off` and `docker compose up -d`, so no tick is running or about to. Take a backup (`pg_dump`).
2. Run it as written with `psql -v ON_ERROR_STOP=1`, ending in `ROLLBACK`. The script stops, and nothing is deleted, unless exactly one active
   Demo tenant is found. `psql` prints the row count of each `DELETE`; compare them with what you expect. When they are right, change the last
   line to `COMMIT` and run it again.
3. It does not undo what the top-up changed on rows it did not create: the staff expiry dates (the status of a shift the roster pack moved goes
   with the shift). It does remove, besides the rows the top-up wrote: the people, contact roles and provider settings row it created (so the
   tenant has no state or time zone until the next tick writes one), rows people made that hang on demo rows, and the audit history of everything
   it removes. It does not touch the Demo tenant's staff, its participants or the old seed's shifts.
4. After a purge, `DEMO_DATA_SCENARIOS=On` starts the demo over from the date of the next tick; it does not bring back the previous rows.
5. If the Demo tenant was ever billed, `ClaimLineItems` rows that name a demo shift (`Restrict`) stop the delete of that shift. Clear them
   first, after checking they belong to the Demo tenant: `DELETE FROM "ClaimLineItems" WHERE "ShiftId" IN (SELECT "Id" FROM demo_shift);`
   (run it after the temporary tables below exist, before the `Shifts` delete). Rows in `BookingTasks`, `IncidentReports` and
   `RestrictivePractices` that point at a demo row are set to null by the database, not blocked.

```sql
BEGIN;

-- The Demo tenant, found as the maintainer finds it. Exactly one row, or the transaction fails here and nothing below runs.
CREATE TEMP TABLE demo_tenant ON COMMIT DROP AS
  SELECT "Id" FROM "Tenants" WHERE "Name" = 'Demo' AND "IsActive" AND lower("EmailDomain") = 'demo.odip.com.au';
DO $$
BEGIN
  IF (SELECT count(*) FROM demo_tenant) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one active Demo tenant on demo.odip.com.au, found %', (SELECT count(*) FROM demo_tenant);
  END IF;
END $$;

-- An incident has no tenant column: it is the Demo tenant's through the user who reported it.
CREATE TEMP TABLE demo_incident ON COMMIT DROP AS
  SELECT "Id" FROM "IncidentReports"
  WHERE substr("Id"::text, 15, 1) = '8'
    AND "ReportedByUserId" IN (SELECT "Id" FROM "Users" WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant));

-- The parents other rows hang from. A completion of a demo shift is a demo completion whoever made it (a person who tapped Start).
CREATE TEMP TABLE demo_shift ON COMMIT DROP AS
  SELECT "Id" FROM "Shifts"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
CREATE TEMP TABLE demo_completion ON COMMIT DROP AS
  SELECT "Id" FROM "ShiftCompletions"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND (substr("Id"::text, 15, 1) = '8' OR "ShiftId" IN (SELECT "Id" FROM demo_shift));
CREATE TEMP TABLE demo_medication ON COMMIT DROP AS
  SELECT "Id" FROM "ParticipantMedications"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
CREATE TEMP TABLE demo_person ON COMMIT DROP AS
  SELECT "Id" FROM "People"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
CREATE TEMP TABLE demo_outbox ON COMMIT DROP AS
  SELECT "Id" FROM "NotificationOutbox"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';

-- Children before parents.
DELETE FROM "NotificationLogs"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND (substr("Id"::text, 15, 1) = '8' OR "OutboxId" IN (SELECT "Id" FROM demo_outbox));
DELETE FROM "NotificationOutbox"
  WHERE "Id" IN (SELECT "Id" FROM demo_outbox);
DELETE FROM "BookingTasks"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
DELETE FROM "IncidentInjuries"
  WHERE "IncidentReportId" IN (SELECT "Id" FROM demo_incident);
DELETE FROM "IncidentWitnesses"
  WHERE "IncidentReportId" IN (SELECT "Id" FROM demo_incident);
DELETE FROM "IncidentReports"
  WHERE "Id" IN (SELECT "Id" FROM demo_incident);
DELETE FROM "HandoverAcknowledgements"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "ShiftId" IN (SELECT "Id" FROM demo_shift) OR "SourceCompletionId" IN (SELECT "Id" FROM demo_completion));
DELETE FROM "ShiftRoutineChecks"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "ShiftCompletionId" IN (SELECT "Id" FROM demo_completion));
DELETE FROM "ShiftBreaks"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "ShiftCompletionId" IN (SELECT "Id" FROM demo_completion));
DELETE FROM "ShiftNotes"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "ShiftId" IN (SELECT "Id" FROM demo_shift));
DELETE FROM "ShiftCompletions"
  WHERE "Id" IN (SELECT "Id" FROM demo_completion);
DELETE FROM "MedicationAdministrations"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "ParticipantMedicationId" IN (SELECT "Id" FROM demo_medication));
DELETE FROM "ParticipantMedications"
  WHERE "Id" IN (SELECT "Id" FROM demo_medication);
DELETE FROM "Shifts"
  WHERE "Id" IN (SELECT "Id" FROM demo_shift);
DELETE FROM "LeaveRequests"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
DELETE FROM "RecurringUnavailabilities"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
DELETE FROM "StaffAvailabilities"
  WHERE substr("Id"::text, 15, 1) = '8' AND "UserId" IN (SELECT "Id" FROM "Users" WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant));
DELETE FROM "ShiftPatterns"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
DELETE FROM "StaffParticipantCompatibilities"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';
DELETE FROM "ParticipantContactRoles"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant)
    AND (substr("Id"::text, 15, 1) = '8' OR "PersonId" IN (SELECT "Id" FROM demo_person));
DELETE FROM "People"
  WHERE "Id" IN (SELECT "Id" FROM demo_person);
DELETE FROM "ProviderSettings"
  WHERE "TenantId" IN (SELECT "Id" FROM demo_tenant) AND substr("Id"::text, 15, 1) = '8';

-- The audit rows that describe the rows above (an audit row has no foreign key, so it can go last).
DELETE FROM "AuditLogs"
  WHERE substr("EntityId"::text, 15, 1) = '8';

ROLLBACK;  -- change to COMMIT once the counts are what you expect
```
