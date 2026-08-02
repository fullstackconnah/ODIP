# NDIS Claiming Integration — Design Spec
**Date:** 2026-03-27  
**Project:** Odip (Trip Planner)  
**Status:** Approved for implementation

---

## Overview

Odip manages NDIS group trips for disability support organisations. Currently, providers manually extract participant and trip data into spreadsheets to generate NDIS Bulk Payment Requests (BPR) and invoices after each trip. This feature automates that process by generating:

1. **BPR CSV files** — for agency-managed participants, uploaded to the NDIA myplace portal
2. **PDF tax invoices** — for plan-managed participants (sent to plan manager) and self-managed participants (sent to participant/guardian)

The integration uses the **CSV Export approach** (not direct PRODA API), meaning Odip generates correctly-formatted files that coordinators upload manually. This approach requires no NDIA registration, works immediately, and delivers the primary value (eliminating manual data extraction) without the 6–12 month PRODA onboarding timeline.

---

## Scope

### In scope
- TripClaim entity with Draft → Ready → Submitted → Paid/PartiallyPaid/Rejected lifecycle
- ClaimLineItem per participant per day-type group (Weekday / Saturday / Sunday / Public Holiday)
- BPR CSV generation (NDIA Bulk Payment Request format, 15 columns, PACE-aware)
- PDF invoice generation for plan-managed and self-managed participants
- SupportActivityGroup + SupportCatalogueItem entities seeded from NDIS catalogue
- ProviderSettings entity (org-level registration number, ABN, GST, PACE flag)
- PublicHoliday table (seeded with national holidays; admin-maintainable)
- Cancellation claims (ClaimType = CANC) for short-notice cancellations
- Auto-task creation when trip moves to Completed status
- Claim status tracking per participant booking (ClaimStatus enum)
- Participant plan dates and plan manager contact linkage

### Out of scope
- Direct PRODA API integration (future — requires NDIA Digital Partnership Program approval)
- Real-time claim status from NDIA (status updates are manual)
- Transport claims (Category 02) — deferred
- Non-face-to-face (NF2F) support claims — deferred
- Plan manager portal integrations (My Plan Manager, Plan Partners, etc.) — deferred

---

## Background: NDIS Claiming System

### What providers claim for on group trips
The trip itself (accommodation, activities, transport costs) is **not NDIS-claimable** — these are participant out-of-pocket (OOP) costs, already tracked in Odip via `PaymentStatus`. 

What IS claimable: **support worker hours** during the trip. These are claimed under **Category 04 (Assistance with Social, Economic and Community Participation)**, Registration Group 0125.

### BPR CSV format
The NDIA Bulk Payment Request is a UTF-8 CSV with 15 columns (PACE providers) or 13 columns (legacy myplace):

```
RegistrationNumber, NDISNumber, SupportsDeliveredFrom, SupportsDeliveredTo,
SupportNumber, ClaimReference, Quantity, Hours, UnitPrice, GSTCode,
AuthorisedBy, ParticipantApproved, InKindFundingProgram, ClaimType, ABN of Support Provider
```

Key validation rules:
- `SupportsDeliveredFrom/To` must be within the participant's active plan dates
- `UnitPrice` must not exceed the catalogue price limit for that support item and ratio
- `SupportNumber` must be a current, active item in the support catalogue
- `ClaimReference` must be unique (max 50 chars)
- Either `Quantity` or `Hours` — not both

### Group support pricing (post January 2024)
The same support item code is used for all ratios (e.g., `04_210_0125_6_1` for weekday daytime group activity). The **per-participant rate differs by ratio** — the support catalogue publishes separate price limits for 1:2, 1:3, 1:4, and 1:5.

Different item codes apply for different day types:
- `04_210_0125_6_1` — Weekday daytime
- `04_211_0125_6_1` — Weekday evening  
- `04_212_0125_6_1` — Saturday
- `04_213_0125_6_1` — Sunday
- `04_214_0125_6_1` — Public holiday

### Plan type affects claiming destination
| Plan Type | Claim destination | Format |
|---|---|---|
| AgencyManaged | NDIA directly (myplace portal) | BPR CSV |
| PlanManaged | Plan manager | PDF tax invoice |
| SelfManaged | Participant / guardian | PDF tax invoice |

---

## Domain Model

### New Entities

#### TripClaim
One per trip. Aggregates all claim line items and tracks the claim lifecycle.

```csharp
public class TripClaim
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; }

    public TripClaimStatus Status { get; set; } = TripClaimStatus.Draft;
    public string ClaimReference { get; set; }  // Auto: "TC-{TripCode}-{YYYYMMDD}", max 50 chars, unique
    public decimal TotalAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? SubmittedDate { get; set; }
    public DateTime? PaidDate { get; set; }

    public Guid? AuthorisedByStaffId { get; set; }
    public Staff? AuthorisedByStaff { get; set; }

    public string? Notes { get; set; }
    public ICollection<ClaimLineItem> LineItems { get; set; }
}
```

#### ClaimLineItem
One per participant per day-type group within a claim. A 3-day trip spanning Friday + Saturday + Sunday generates 3 line items per participant.

```csharp
public class ClaimLineItem
{
    public Guid Id { get; set; }
    public Guid TripClaimId { get; set; }
    public TripClaim TripClaim { get; set; }
    public Guid ParticipantBookingId { get; set; }
    public ParticipantBooking ParticipantBooking { get; set; }

    public string SupportItemCode { get; set; }           // e.g. "04_210_0125_6_1"
    public ClaimDayType DayType { get; set; }             // Weekday / Saturday / Sunday / PublicHoliday
    public DateOnly SupportsDeliveredFrom { get; set; }
    public DateOnly SupportsDeliveredTo { get; set; }

    public decimal Hours { get; set; }
    public decimal UnitPrice { get; set; }                // Per-participant rate for this ratio
    public decimal TotalAmount { get; set; }              // Hours * UnitPrice

    public GSTCode GSTCode { get; set; }                  // P1 (taxable) / P2 (GST free) / P5 (out of scope)
    public ClaimType ClaimType { get; set; } = ClaimType.Standard;  // STAN / CANC
    public bool ParticipantApproved { get; set; } = false;

    public ClaimLineItemStatus Status { get; set; } = ClaimLineItemStatus.Draft;
    public string? RejectionReason { get; set; }
    public decimal? PaidAmount { get; set; }
}
```

#### SupportActivityGroup
Groups related support item codes (one per day type) under a named activity type. Coordinators select an activity group for the trip; the system resolves the correct item code per day.

```csharp
public class SupportActivityGroup
{
    public Guid Id { get; set; }
    public string GroupCode { get; set; }        // e.g. "GRP_COMMUNITY_ACCESS"
    public string DisplayName { get; set; }      // e.g. "Group Community Access"
    public int SupportCategory { get; set; }     // 04
    public bool IsActive { get; set; } = true;
    public ICollection<SupportCatalogueItem> Items { get; set; }
}
```

#### SupportCatalogueItem
One row per item code per day type. Seeded from the NDIS support catalogue XLSX. Updated by admin when NDIA publishes a new price guide.

```csharp
public class SupportCatalogueItem
{
    public Guid Id { get; set; }
    public Guid ActivityGroupId { get; set; }
    public SupportActivityGroup ActivityGroup { get; set; }

    public string ItemNumber { get; set; }           // e.g. "04_210_0125_6_1"
    public string Description { get; set; }
    public string Unit { get; set; }                 // "H" for hour
    public ClaimDayType DayType { get; set; }

    public decimal PriceLimit_Standard { get; set; }
    public decimal PriceLimit_1to2 { get; set; }
    public decimal PriceLimit_1to3 { get; set; }
    public decimal PriceLimit_1to4 { get; set; }
    public decimal PriceLimit_1to5 { get; set; }
    public decimal PriceLimit_Remote { get; set; }
    public decimal PriceLimit_VeryRemote { get; set; }

    public string CatalogueVersion { get; set; }     // e.g. "2024-25"
    public DateOnly EffectiveFrom { get; set; }
    public DateOnly? EffectiveTo { get; set; }
    public bool IsActive { get; set; } = true;
}
```

#### ProviderSettings
Singleton entity. Org-level NDIS registration configuration.

```csharp
public class ProviderSettings
{
    public Guid Id { get; set; }
    public string RegistrationNumber { get; set; }   // 9-digit NDIS provider registration number
    public string ABN { get; set; }                  // 11-digit ABN
    public string OrganisationName { get; set; }
    public string Address { get; set; }
    public bool GSTRegistered { get; set; }          // → GSTCode P1 if true, P2 if false
    public bool IsPaceProvider { get; set; }         // → adds ClaimType + ABN columns to BPR

    // Invoice display
    public string? BankAccountName { get; set; }
    public string? BSB { get; set; }
    public string? AccountNumber { get; set; }
    public string? InvoiceFooterNotes { get; set; }
}
```

#### PublicHoliday
National and state-specific public holidays. Used to classify TripDays for correct item code selection.

```csharp
public class PublicHoliday
{
    public Guid Id { get; set; }
    public DateOnly Date { get; set; }
    public string Name { get; set; }
    public string? State { get; set; }    // null = national; "NSW", "VIC", etc. for state-specific
}
```

---

### Changes to Existing Entities

#### TripInstance — add 2 fields
```csharp
public Guid? DefaultActivityGroupId { get; set; }   // Default support activity type for the trip
public SupportActivityGroup? DefaultActivityGroup { get; set; }
public decimal ActiveHoursPerDay { get; set; } = 8; // Default active support hours per day
```

#### TripDay — add 3 fields
```csharp
public bool IsPublicHoliday { get; set; } = false;         // Override from PublicHoliday table
public OvernightSupportType OvernightType { get; set; } = OvernightSupportType.None;
public decimal OvernightHours { get; set; } = 0;
```

#### Participant — add 3 fields
```csharp
public DateOnly? PlanStartDate { get; set; }
public DateOnly? PlanEndDate { get; set; }
public Guid? PlanManagerContactId { get; set; }    // FK to Contact (ContactType = PlanManager)
public Contact? PlanManagerContact { get; set; }
```

#### ParticipantBooking — add 2 fields
```csharp
public ClaimStatus ClaimStatus { get; set; } = ClaimStatus.NotClaimed;
public DateOnly? CancellationNoticeDate { get; set; }   // Date notice was given — used for CANC eligibility
```

#### Contact — add 1 field
```csharp
public ContactType ContactType { get; set; }   // Extend enum to include PlanManager
```

---

### New Enums

```csharp
public enum TripClaimStatus
{
    Draft = 0,
    Ready = 1,
    Submitted = 2,
    Paid = 3,
    PartiallyPaid = 4,
    Rejected = 5
}

public enum ClaimLineItemStatus
{
    Draft = 0,
    Submitted = 1,
    Paid = 2,
    Rejected = 3
}

public enum ClaimDayType
{
    Weekday = 0,
    Saturday = 1,
    Sunday = 2,
    PublicHoliday = 3
}

public enum ClaimType
{
    Standard = 0,   // "STAN" in BPR
    Cancellation = 1  // "CANC" in BPR
}

public enum GSTCode
{
    P1 = 0,   // Taxable (10% GST)
    P2 = 1,   // GST Free
    P5 = 2    // Out of Scope / Input Taxed
}

public enum ClaimStatus
{
    NotClaimed = 0,
    InClaim = 1,
    Submitted = 2,
    Paid = 3,
    Rejected = 4
}

public enum OvernightSupportType
{
    None = 0,
    ActiveNight = 1,    // Hourly billing at overnight rate
    Sleepover = 2       // Flat per-night sleepover allowance
}
```

---

## Workflow

### 1. Trip Completion Trigger
When `TripInstance.Status` transitions to `Completed`:
- System auto-creates a `TaskType.GenerateNdisClaims` task assigned to the lead coordinator
- If `ProviderSettings` is not configured, the task description includes a warning to configure it first

### 2. Claim Generation (Draft)
Coordinator clicks "Generate Claim" on the completed trip. System:

1. Validates: `ProviderSettings` exists and is complete
2. Validates: all confirmed `ParticipantBooking` records have a participant with `NdisNumber`
3. Warns (not blocks): any participant missing `PlanStartDate`/`PlanEndDate`
4. Creates `TripClaim` with status `Draft`, auto-generates `ClaimReference`
5. For each confirmed booking, generates `ClaimLineItem` records:
   - Groups `TripDay` records by `ClaimDayType` (weekday/Saturday/Sunday/public holiday)
   - Consecutive days of same type → one line item (date range)
   - Looks up `SupportCatalogueItem` from trip's `DefaultActivityGroupId` + day type
   - Determines ratio from `ParticipantBooking.SupportRatioOverride` ?? `Participant.SupportRatio`
   - Sets `UnitPrice` from catalogue price limit for that ratio (standard pricing)
   - Sets `Hours` = days in group × `TripInstance.ActiveHoursPerDay`
   - Sets `GSTCode` from `ProviderSettings.GSTRegistered`
   - Sets `ClaimType = Standard` by default
6. Sets `ParticipantBooking.ClaimStatus = InClaim` for all included bookings
7. Calculates `TripClaim.TotalAmount`

### 3. Coordinator Review (Draft → Ready)
Coordinator reviews generated line items. Can:
- Override `Hours`, `UnitPrice`, `SupportItemCode` per line item
- Change `ClaimType` to `Cancellation` for short-notice cancellations
- Toggle `ParticipantApproved` per line item
- Remove a participant's line items from the claim
- Set `AuthorisedByStaffId`

Coordinator clicks "Mark Ready" → `TripClaim.Status = Ready`.

### 4. File Generation (Ready → Submitted)
From a Ready claim, coordinator downloads:
- **BPR CSV** — all agency-managed participant line items in NDIA BPR format
- **PDF Invoices** — one per plan-managed participant (addressed to plan manager), one per self-managed participant (addressed to participant/guardian)

After downloading and submitting externally:
- Coordinator clicks "Mark as Submitted" → `TripClaim.Status = Submitted`, `SubmittedDate = now`
- All included `ParticipantBooking.ClaimStatus` = `Submitted`

### 5. Payment Recording
As payments are confirmed:
- Coordinator marks individual `ClaimLineItem.Status` = `Paid` or `Rejected`
- On rejection: coordinator enters `RejectionReason`
- `TripClaim.Status` auto-updates:
  - All line items Paid → `Paid`
  - Mix of Paid + Rejected → `PartiallyPaid`
  - All Rejected → `Rejected`
- `ParticipantBooking.ClaimStatus` updates to reflect their individual outcome

---

## BPR CSV Generation

### Column mapping

| BPR Column | Source |
|---|---|
| RegistrationNumber | `ProviderSettings.RegistrationNumber` |
| NDISNumber | `Participant.NdisNumber` |
| SupportsDeliveredFrom | `ClaimLineItem.SupportsDeliveredFrom` (YYYY-MM-DD) |
| SupportsDeliveredTo | `ClaimLineItem.SupportsDeliveredTo` (YYYY-MM-DD) |
| SupportNumber | `ClaimLineItem.SupportItemCode` |
| ClaimReference | `ClaimLineItem.Id` (short GUID, max 50 chars — note: this is the BPR row reference, distinct from `TripClaim.ClaimReference` which is the human-readable claim ID) |
| Quantity | (empty) |
| Hours | `ClaimLineItem.Hours` formatted as `HHH:MM` |
| UnitPrice | `ClaimLineItem.UnitPrice` |
| GSTCode | `ClaimLineItem.GSTCode` → "P1" / "P2" / "P5" |
| AuthorisedBy | `TripClaim.AuthorisedByStaff.FullName` |
| ParticipantApproved | `ClaimLineItem.ParticipantApproved` → "Y" / "N" |
| InKindFundingProgram | (empty) |
| ClaimType | `ClaimLineItem.ClaimType` → "STAN" / "CANC" (PACE providers only) |
| ABN of Support Provider | `ProviderSettings.ABN` (PACE providers only) |

### Filtering
Only include line items where `ParticipantBooking.PlanType` (or `PlanTypeOverride`) = `AgencyManaged`.

### Validation before export
- `UnitPrice` ≤ catalogue price limit for the item and ratio → warn coordinator if exceeded
- `SupportsDeliveredFrom/To` within participant plan dates → warn if `PlanEndDate` is before trip end
- File must not exceed 5,000 rows or 10 MB

---

## Invoice Generation (Plan-Managed + Self-Managed)

### Invoice content
- Provider header: organisation name, ABN, address, registration number
- Invoice number: `INV-{ClaimReference}-{ParticipantId-short}`
- Invoice date: generation date
- Bill to: plan manager name + address (plan-managed) OR participant name + guardian (self-managed)
- Line items: support item code, description, date range, hours, unit price, total ex-GST
- GST line (if GSTRegistered)
- Total including GST
- Payment details: BSB, account number, account name
- Footer notes from `ProviderSettings.InvoiceFooterNotes`

---

## Cancellation Claims

A booking with `BookingStatus = Cancelled` and `CancellationNoticeDate` set within 2 business days of the trip start date is eligible for a CANC claim.

- Coordinator must manually set `ClaimLineItem.ClaimType = Cancellation`
- `Hours` = agreed support hours for the cancelled session
- `UnitPrice` = up to 100% of the agreed rate (coordinator confirms)
- In BPR: `ClaimType = "CANC"`

---

## Support Catalogue Management

### Initial seed
Migrations seed `SupportActivityGroup` and `SupportCatalogueItem` records for the 2024-25 catalogue covering Category 04 group community access items (weekday, Saturday, Sunday, public holiday).

### Updates
When NDIA publishes a new catalogue (typically July each year):
- Admin navigates to Settings → Support Catalogue
- Uploads new catalogue XLSX
- System imports new items, marks old versions as inactive (`IsActive = false`, `EffectiveTo = new version date`)
- Existing claims referencing old item codes are unaffected

---

## API Endpoints

```
POST   /api/v1/trips/{tripId}/claims              Create claim (Draft) from completed trip
GET    /api/v1/trips/{tripId}/claims              List claims for a trip
GET    /api/v1/claims/{claimId}                   Get claim detail with line items
PUT    /api/v1/claims/{claimId}                   Update claim (authoriser, notes, status transition)
PATCH  /api/v1/claims/{claimId}/line-items/{id}  Update individual line item (hours, price, claimType)
GET    /api/v1/claims/{claimId}/bpr-csv           Download BPR CSV
GET    /api/v1/claims/{claimId}/invoices          Download all invoices (ZIP)
GET    /api/v1/claims/{claimId}/invoices/{bookingId}  Download single participant invoice

GET    /api/v1/provider-settings                  Get provider configuration
PUT    /api/v1/provider-settings                  Update provider configuration

GET    /api/v1/support-catalogue                  List support activity groups + items
POST   /api/v1/support-catalogue/import           Import new catalogue version (admin)

GET    /api/v1/public-holidays                    List public holidays
POST   /api/v1/public-holidays                    Add public holiday (admin)
DELETE /api/v1/public-holidays/{id}               Remove public holiday (admin)
```

---

## Migrations Required

1. **AddNdisClaiming** — creates: TripClaim, ClaimLineItem, SupportActivityGroup, SupportCatalogueItem, ProviderSettings, PublicHoliday tables
2. **AddClaimingFieldsToExistingEntities** — adds: TripInstance (DefaultActivityGroupId, ActiveHoursPerDay), TripDay (IsPublicHoliday, OvernightType, OvernightHours), Participant (PlanStartDate, PlanEndDate, PlanManagerContactId), ParticipantBooking (ClaimStatus, CancellationNoticeDate), Contact (ContactType)
3. **SeedNdisCatalogueData** — seeds SupportActivityGroup + SupportCatalogueItem for 2024-25 Category 04 group access codes + national PublicHoliday records

---

## Implementation Notes

- Follow the existing pattern of auto-task creation on status transitions (see insurance task creation in `BookingsAccommodationController`)
- BPR dates must export as text strings `YYYY-MM-DD`, not as numeric date serials (Excel-safe export)
- PDF invoice generation: use a server-side PDF library (e.g. QuestPDF or iText) — do not use client-side rendering
- ClaimReference uniqueness: enforce with a unique index on `TripClaim.ClaimReference`
- Existing `PaymentStatus` on `ParticipantBooking` is unchanged — it tracks OOP cost collection independently of `ClaimStatus`

---

## Open Questions
- Which state(s) does the first client operate in? Determines which state-specific public holidays to seed.
- Does the first client use legacy myplace or PACE? Determines whether `IsPaceProvider` defaults to true.
- Preferred PDF library for invoice generation (.NET 9 compatible)?
