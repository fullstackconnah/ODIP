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
  completion, routine and occurrence; one active completion per shift; one compatibility cell per staff member and participant; one leave request or
  recurring rule per staff member, type or day and dates among those not cancelled or declined; one shift per pattern and date) or a rule (one active record per
  scheduled medication slot) the script looks for the key and leaves the person's row alone. A live shift a person has taken over, by starting it by hand, by a coordinator returning its completion for correction or by a
  coordinator moving it to other times or another date, is theirs: the script leaves it alone, the history's handover reads do not wait for it, and
  the history writes its window's doses, like any other day's, once the window (and the close-out buffer after it) is over and nobody has finished
  the shift. An as-needed dose is judged as the app's recorder judges one: the script writes none that would break the medication's minimum
  interval or daily maximum beside a dose already recorded (a person's, or the other script's), on either side of it. The one exception to "leaves the
  person's row alone" is the finish of a live shift the script itself is working, which ends a break that is still running, whoever started it, as the
  app's Finish requires.

## Switches

Set in the stack's `.env` on the host; `deploy/compose.yaml` passes them to the API container, so a change needs `docker compose up -d`.

| Setting | Variable | Default | Effect |
|---|---|---|---|
| `DemoData:Scenarios` | `DEMO_DATA_SCENARIOS` | `Off` | Only the exact word `On` switches the top-up on. Anything else is Off and is reported once in the startup log. |
| `DemoData:Packs` | `DEMO_DATA_PACKS` | empty | The packs that may run, by name, any case. Only a comma separates names: a space or a semicolon does not, so `roster-weeks medications` is one name that is not a pack. Empty is every pack, and so is a value that is set but names no pack (only commas or spaces), which the startup log reports as a Warning. A name that is not a pack and matches nothing leaves that pack off, and the startup log says so in a Warning beside the `Demo data top-up is On` line: it names each such entry and lists the packs that will run and the packs that stay off. |
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
| `roster-weeks` | shifts and the completions of the ones that have ended; moves shift statuses forward (only the shifts it made: a Draft the app generated for a demo pattern is a person's, and a date that already has a shift of its pattern is not filled again) |
| `leave-coverage-tasks` | the tasks that ask a coordinator to re-cover a shift a staff member's leave takes |
| `medications` | the participants' medication charts |
| `live-set` | three live shifts a day that follow the provider's clock: start, doses, break, note, routine tick, handover, finish |
| `medication-history` | a week of medication administrations (with witnesses) outside the live shifts |
| `shift-package-history` | breaks, notes, routine ticks and read handovers on the closed shifts |
| `incidents` | the twelve incidents, the notes two of them hang from, and the script that ages them |
| `notifications` | the terminal notification rows for the shift package's and the incidents' events |

## Shipping a new pack Off

A pack writes into a live tenant every hour and nothing it writes is ever deleted, so a new pack should be able to deploy without running.

1. In the host's `.env`, set `DEMO_DATA_PACKS` to every pack that already runs, comma-separated, and leave out the new one. Do it before the deploy and read the value
   back: the deploy leaves `.env` alone, and a variable that is not there means every pack at the first tick of the new build. Deploy as usual.
   The startup log line `Demo data top-up is On: ...; packs that will run, 8 of 14: ...` lists the packs that will run, read from the list and in the order the code runs
   them (not the order they were typed): check that it names exactly the packs you meant, because a pack that is not in it is off.
2. Read the Warning the startup log puts beside that line, if there is one. A name in the list that is not a pack matches nothing, so the pack it was meant for stays off:
   the warning names each such entry and lists the packs that will run and the packs that stay off, so `roster-week` mistyped for `roster-weeks` shows up as a typo, with
   `roster-weeks` among those that stay off. There is no warning when every name is a pack. A value that is set but names no pack (a stray comma, a space) means every pack,
   and the warning says that; an unset or empty variable means every pack with no warning, so read the line after any edit of the variable.
3. Check the first tick's log line. When the new pack's rows are wanted, add its name to the list and run `docker compose up -d` (the options are read once, so this
   restarts the API), or empty the variable to run everything, which also switches on every pack added later.

To stop everything, set `DEMO_DATA_SCENARIOS=Off` (nothing is removed).

## Enabling the PR 2 packs

The six packs PR 2 adds are `medications`, `live-set`, `medication-history`, `shift-package-history`, `incidents` and `notifications`. They write into the live Demo
tenant every hour and nothing they write is ever deleted, so they are enabled once, on purpose, through the list described above (the eight PR 1 packs are the first eight
names in the table).

1. **Census first.** The packs skip a story whose people or rows are missing, so check that they are there before enabling: exactly one active tenant named `Demo` on
   `demo.odip.com.au`; the ten staff the packs name, by email (`DemoPeople.StaffEmails`); the seventeen participants they name, by NDIS number
   (`DemoPeople.ParticipantNdisNumbers`); the old seed's medications (`medications` skips itself when none is there); at least one of the old seed's shift notes
   (`78000000-0000-0000-0000-00000000000{1..6}`: without one the note stories skip); the old seed's morning routine `74000000-0000-0000-0000-000000000002`; and a provider
   settings row. Read the latest hourly line too: `Demo data tick for ... (tz database: present)`. If it says `MISSING, fixed +10:00` the provider's zone has fallen back
   to a fixed offset and the clock-change logic of these packs would write the wrong instants: do not enable until the host has its time zone data. Then run these three
   read-only checks and expect no rows (a status is a plain integer: 0 Pending, 1 Approved, 2 Declined, 3 Cancelled):

   ```
   SELECT "UserId", "LeaveType", "StartDate", "EndDate", count(*), array_agg("Id") FROM "LeaveRequests"
     WHERE "Status" IN (0, 1) GROUP BY 1, 2, 3, 4 HAVING count(*) > 1;
   SELECT "UserId", "DayOfWeek", "StartTime", "EndTime", "EffectiveFrom", "EffectiveTo", count(*), array_agg("Id") FROM "RecurringUnavailabilities"
     WHERE "Status" IN (0, 1) GROUP BY 1, 2, 3, 4, 5, 6 HAVING count(*) > 1;
   SELECT "ShiftPatternId", "ServiceDate", count(*), array_agg("Id") FROM "Shifts"
     WHERE "ShiftPatternId" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
   ```

   A row is a pair or a date the app would not have made, one of them written by the top-up (an id with `8` as the 15th character of its text form): a coordinator can
   cancel it in the app, which takes it out of the key; nothing is deleted.
2. **Which.** Enable the six together, or `medications` and `live-set` first. `medication-history` before `live-set` records today's live doses itself and removes the live
   set's deliberately open one; `live-set` without `medications` writes no doses; `incidents` needs the live morning shift (one story hangs a note off it) and the
   medications (one story is a dose).
3. **When.** In Sydney daytime, about 06:30 to 21:30. The live set casts its shifts only between 06:00 and 23:00 on the provider's clock, and a tick outside those hours lets
   `medication-history` record the doses already due in the live windows of today and yesterday itself: nothing is written twice, but the live story loses those doses and
   there is nothing live to watch. Never on the night of a clock change (the first Sunday of October and of April, around 02:00). Take a backup immediately before
   enabling: removing what the packs write is the purge below or a restore.
4. **Restart.** Changing the list is a change of `.env` and `docker compose up -d`, which restarts the API (the options are read once): expect a short gap.
5. **Afterwards**, read the startup line (it must list the packs you meant) and the first tick's summary: `0 packs failed`; the `skipped stories` line (a story whose
   people or rows are missing is skipped and named); `(tz database: present)`; and, for a day, any `duplicate key` or `conflicted on` in the API log.

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
   tenant has no state or time zone until the next tick writes one) and rows people made that hang on demo rows. It removes the audit history of the
   rows with a demo id; the audit rows of the rows people made (a person's acknowledgement, tick or break on a demo shift, a dose on a demo medication)
   have no demo id to find them by and stay. It does not touch the Demo tenant's staff, its participants or the old seed's shifts.
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

-- The audit rows that describe the rows with a demo id (an audit row has no foreign key, so it can go last). The table has no tenant column: a version-8 id is only
-- ever made by the top-up, which only ever wrote to the Demo tenant, so these are its.
DELETE FROM "AuditLogs"
  WHERE substr("EntityId"::text, 15, 1) = '8';

ROLLBACK;  -- change to COMMIT once the counts are what you expect
```
