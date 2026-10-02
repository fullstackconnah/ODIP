# Support catalogue 2026-27: data model, import rules and the admin runbook

**Status:** implemented on `feat/catalogue-2026-27` (plan builder, phase A). **Date:** 2026-10-02.

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
is still the right row for the dates inside its window. Shift claims, trip claims (a run of same-type days is split where the valid rows
change) and agreement drafts all pick the row valid on the **service date** (`EffectiveCatalogueResolver.IsValidOn`), so importing a
December price set does not reprice an unclaimed November service. `EffectiveCatalogueResolver.Find` / `FindCatalogueItemAsync` return
the single valid row and its price for (code, date, National / Remote / VeryRemote) or a typed failure. Claims and drafts stay scoped to
`GRP_COMMUNITY_ACCESS`; a draft line can only be a weekday, hourly item of that group.

## Import rules (history-safe)

- The layout is told from the header row; every visible sheet (Current and Legacy) is read; every row is imported.
- A row superseded by a newer version is end-dated the day before the new row starts; an active row whose code is not in the file is
  end-dated the same way. Nothing is deleted and no group is deactivated as a whole.
- Importing a file again changes nothing. An import only ever shortens a row it holds, so an older file cannot bring back what a newer
  catalogue replaced or dropped (the preview says when a file would end a row later than it is stored).
- One confirm at a time (a PostgreSQL advisory lock); rows duplicated by an earlier double import are healed by the next import.
- The version is proposed from the file (`2026-27`, or `2026-27 (2026-12-01)` when changed rows start later than the financial year began).
  Preview and confirm are SuperAdmin-only.

## Admin runbook (after deploy)

1. Deploy. The API applies the migration at start-up; no existing row changes and the demo seed does not run on an existing database.
2. Settings > Support Catalogue > Import Catalogue (SuperAdmin). Upload the NDIA workbook "NDIS Support Catalogue 2026-27"
   (https://www.ndis.gov.au/media/8038/download?attachment: sheets Current Support Items and Legacy Support Items).
3. Read the preview: layout, start date, rows and legacy rows, New / Updated / Unchanged / To end-date, and every warning (rows that
   start after today, codes that will be end-dated, rows whose stored end date is kept).
4. Keep the proposed version (20 characters at most) and Confirm Import. Verify: about 995 active items, `GRP_COMMUNITY_ACCESS` has ten
   active items, and a weekday trip or shift prices at 73.58 with `04_104_0125_6_1`.
5. If services from before 1 July 2026 are still unclaimed, import the 2025-26 workbook as well: it is added as history and never touches
   the 2026-27 rows. For a later NDIA price update, import the new file the same way.

## Do not roll back below this release after importing

After the import the table holds about a thousand rows in a dozen groups. The previous release's shift engine takes "the first active
item for the day type" across **all** groups (it would price an intensive weekday shift at an STA code), its agreement draft accepts
any weekday hourly code, and its importer deactivates the whole community group. The migration's `Down` is safe, but the data is not
backward compatible: roll forward, or restore the database from before the import.

## Known limits

- An import never lengthens a stored row's window; extending an end date needs a deliberate edit.
- The Support Catalogue list is unpaginated (about 865 KB of JSON for 995 items) and shows a Weekday badge on items that have no day
  band; both move to the plan builder's catalogue work.
- A service dated before every catalogue row that covers it (for example before 1 July 2026 with only the 2026-27 file imported) is left
  out of a claim, not priced from a row that did not apply. When NO day of a trip, and none of the shifts in a range, has a row, the claim
  engines refuse with "No catalogue row covers this trip's dates (dd/MM/yyyy to dd/MM/yyyy). Import the catalogue for that period first."
  (shifts: "these shifts' dates") and save nothing; import the 2025-26 workbook for that period, then claim again.
