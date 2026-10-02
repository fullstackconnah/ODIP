# Support catalogue 2026-27: data model, import rules and the admin runbook

**Status:** shipped (plan builder, phase A, PR #181) with the phase A.1 follow-ups. **Date:** 2026-10-02, updated 2026-10-03.

## Why

The importer read only the 2025-26 layout (eight state columns), kept only RG 0125 items, stamped "today" as every start date and, on
commit, deactivated the whole community access group. The 2026-27 catalogue has a new layout (National / Remote / Very Remote), a new
STA structure, and NDIA has said prices will be updated again after 1 December 2026. Catalogue prices are date-effective data, and an
import must never reprice a service that already happened.

## Model

- **One row per item code per catalogue version.** `EffectiveFrom` / `EffectiveTo` are the catalogue's own start and end dates (`99991231`
  is open-ended). The row also carries the registration group, support category and PACE category, outcome domain and support purpose (as
  published), unit, Type (Priced / Quotable / Unit price $1), the five claim flags, `IsLegacy`, `PriceNational` / `PriceRemote` /
  `PriceVeryRemote` (null Remote or Very Remote = not eligible for that loading), `SourceDocument` and `CatalogueVersion`. The eight
  `PriceLimit_<STATE>` columns stay (a 2026-27 import fills all eight with the National price). Migration
  `AddCatalogueItemClassificationAndZonePrices` only adds nullable or defaulted columns.
- **Activity groups by family** (`CatalogueClassifier`, a table keyed by code prefix plus registration group, never by item name):
  `GRP_COMMUNITY_ACCESS` keeps exactly the ten RG 0125 standard and ICBS items it always held; `GRP_COMMUNITY_ACCESS_HI`,
  `GRP_PERSONAL_CARE`, `GRP_GROUP_ACTIVITIES`, `GRP_STA_SUPPORT`, `GRP_STA_ACCOMMODATION`, `GRP_SLEEPOVER`, `GRP_PROVIDER_TRAVEL`,
  `GRP_ACTIVITY_BASED_TRANSPORT`, `GRP_CENTRE_CAPITAL`, and `GRP_OTHER` for everything the map does not name.
- Items with no day band are stored with `DayType` Weekday (the column is not nullable); the group says what they are.

## Which row prices a service

A row is **valid on a date** when the date is inside its own window and the row was not withdrawn by hand (inactive with no end date).
`IsActive` is only the "in the current catalogue" flag of the Support Catalogue list: an import end-dates what it supersedes, and that row
is still the right row for the dates inside its window. Shift claims, trip claims (a run of same-type days is split only where a row its
lines can pick changes: the day type's row for a standard and an intensive participant, plus the evening row for a weekday run, so a new
Saturday price does not split a weekday run) and agreement drafts all pick the row valid on the **service date**
(`EffectiveCatalogueResolver.IsValidOn`), so importing a December price set does not reprice an unclaimed November service.
`EffectiveCatalogueResolver.Find` / `FindCatalogueItemAsync` return the single valid row and its price for (code, date, National /
Remote / VeryRemote) or a typed failure. On a day two versions overlap (the previous importer ended a row on the day it started its
replacement) the version with the later start wins, in the lookup, the draft and both claim engines alike; only rows that start on the
same day, a catalogue inserted twice, are ambiguous. Claims and drafts stay scoped to `GRP_COMMUNITY_ACCESS`; a draft line can only be a
weekday, hourly item of that group.

## Import rules (history-safe)

- The layout is told from the header row; every visible sheet (Current and Legacy) is read; every row is imported.
- A row superseded by a newer version is end-dated the day before the new row starts; an active row whose code is not in the file is
  end-dated the same way. Nothing is deleted and no group is deactivated as a whole.
- Importing a file again changes nothing. An import only ever shortens a row it holds, so an older file cannot bring back what a newer
  catalogue replaced or dropped (the preview says when a file would end a row later than it is stored).
- An older catalogue imported after a newer one is history. When the stored rows begin in a later NDIA financial year (1 July to 30 June)
  than everything the file starts, a code of the file that the newer catalogue does not hold (no later version of it in the file or the
  database) is end-dated the day before the newer catalogue starts and is not current; the preview names each one. So the codes the 2026-27
  catalogue dropped end on 30 June 2026 whether the 2025-26 file was imported before or after it, and importing the older file again
  shortens rows an earlier import left open. A republication of the same year (a December price set) does not make the July file older,
  so importing it again ends nothing.
- One exception, so a wrong workbook can be repaired: a code that a republished file left out is end-dated with an empty window (the row
  ends the day before it starts). Importing a file that lists the code again reopens that row (the preview names each one, "is
  reopened"), unless another row of the code covers its start. Rows a newer catalogue superseded or dropped keep their real window and
  stay ended. What this does and does not repair is spelled out under "Repairing a wrong import".
- One confirm at a time (a PostgreSQL advisory lock); rows duplicated by an earlier double import are healed by the next import.
- The version is proposed from the file (`2026-27`, or `2026-27 (2026-12-01)` when changed rows start later than the financial year began).
  Preview and confirm are SuperAdmin-only.

## Admin runbook (after deploy)

1. Deploy. The API applies the migration at start-up; no existing row changes and the demo seed does not run on an existing database.
2. Settings > Support Catalogue > Import Catalogue (SuperAdmin). Upload the NDIA workbook "NDIS Support Catalogue 2026-27"
   (https://www.ndis.gov.au/media/8038/download?attachment: sheets Current Support Items and Legacy Support Items).
3. Read the preview: layout, start date, rows and legacy rows, New / Updated / Unchanged / To end-date, and every warning (rows that
   start after today, codes that will be end-dated, rows whose stored end date is kept).
4. Keep the proposed version (20 characters at most) and Confirm Import. Only one confirm runs at a time: a second SuperAdmin's confirm
   waits up to 20 seconds for the first, then refuses with "Another catalogue import is still running"; let the first finish, preview the
   file again and confirm. Verify: about 995 active items, `GRP_COMMUNITY_ACCESS` has ten active items, and a weekday trip or shift prices
   at 73.58 with `04_104_0125_6_1`.
5. If services from before 1 July 2026 are still unclaimed, import the 2025-26 workbook as well: it is added as history and never touches
   the 2026-27 rows. For a later NDIA price update, import the new file the same way.
6. If the wrong file was confirmed, read "Repairing a wrong import" below before importing anything else: importing the right file
   repairs some mistakes and cannot repair others.

## Repairing a wrong import

An import never lengthens a row's window, so a second import repairs only what the first one broke in a way it can undo.

**Importing the right file repairs:**

- A truncated or wrong workbook that starts on the **same dates** as the rows it replaced (a cut-down copy of the right file, a file with
  codes missing). Every code it left out was end-dated with an empty window (the row ends the day before it starts). Import the complete
  right file: each such code is reopened in place, and the preview names it ("is reopened").
- Rows an earlier import left open-ended and current although a newer catalogue dropped their code (the 2025-26 codes the 2026-27
  catalogue dropped): import the older file again and it ends them (see "Import rules").
- A catalogue inserted twice by two simultaneous confirms: the next import ends the extra copy of every row.

**Importing the right file does not repair:**

- A wrong file that starts **later** than the rows it replaced, for example a changes-only workbook that starts on 1 December and was
  confirmed by mistake. Every code it left out had its 1 July row end-dated on 30 November with a real window, and the codes it did list
  were restarted. The complete file imported next finds each of those rows held (the preview says "an import never lengthens a row", ten
  lines and a count) and reopens none. Undoing it is a database edit by a developer: set the end date back to open and the row to
  current on the rows that were ended the day before the wrong file started, and only where no newer row of the same code exists; then
  import the right file, which should report every row unchanged.
- An end date that needs to be later than the stored one (see "Known limits").

**Take care with an older workbook of the same start date.** Two files that start on the same date cannot be told apart. If NDIA drops a
code in a republished workbook with the same start dates (its row is end-dated with an empty window), importing the older workbook later
reopens that code, open-ended and current, because the older file also lists it. The preview shows each such code as one "is reopened"
line (ten lines, then a count): read them before confirming.

## Do not roll back below this release after importing

After the import the table holds about a thousand rows in a dozen groups. The previous release's shift engine takes "the first active
item for the day type" across **all** groups (it would price an intensive weekday shift at an STA code), its agreement draft accepts
any weekday hourly code, and its importer deactivates the whole community group. The migration's `Down` is safe, but the data is not
backward compatible: roll forward, or restore the database from before the import.

## Known limits

- An import never lengthens a stored row's window; extending an end date needs a deliberate edit. The same rule means a wrong file that
  starts later than the rows it replaced cannot be undone by importing the right one, and an older workbook with the same start dates can
  reopen a code that a newer one dropped ("Repairing a wrong import").
- The Support Catalogue list is unpaginated (about 865 KB of JSON for 995 items) and shows a Weekday badge on items that have no day
  band; both move to the plan builder's catalogue work.
- A service dated before every catalogue row that covers it (for example before 1 July 2026 with only the 2026-27 file imported) is left
  out of a claim, not priced from a row that did not apply. When NO day of a trip, and none of the shifts in a range, has a row, the claim
  engines refuse with "No catalogue row covers this trip's dates (dd/MM/yyyy to dd/MM/yyyy). Import the catalogue for that period first."
  (shifts: "these shifts' dates") and save nothing; import the 2025-26 workbook for that period, then claim again.
- Generating a trip claim never saves a claim with no lines. When nothing could be priced it refuses with the cause: the trip has no days
  recorded, none of its confirmed participants has an NDIS number, the catalogue has no item for the trip's day types (for example
  Saturday) on its dates, or nothing is left to price (no active hours). The claim preview still shows the empty list.
