using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// TRIP CLAIM DTOs
// ══════════════════════════════════════════════════════════════

public record TripClaimListDto
{
    public Guid Id { get; init; }
    /// <summary>Trip (default) or Shift — shift-completion design spec §1/§2.</summary>
    public ClaimKind Kind { get; init; } = ClaimKind.Trip;
    /// <summary>Set for Kind == Trip; null for Kind == Shift.</summary>
    public Guid? TripInstanceId { get; init; }
    public string TripName { get; init; } = string.Empty;
    /// <summary>Set for Kind == Shift; null for Kind == Trip.</summary>
    public Guid? ParticipantId { get; init; }
    public DateOnly? PeriodFrom { get; init; }
    public DateOnly? PeriodTo { get; init; }
    public TripClaimStatus Status { get; init; }
    public string ClaimReference { get; init; } = string.Empty;
    public decimal TotalAmount { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? SubmittedDate { get; init; }
}

public record TripClaimDetailDto : TripClaimListDto
{
    public decimal TotalApprovedAmount { get; init; }
    public Guid? AuthorisedByStaffId { get; init; }
    public string? AuthorisedByStaffName { get; init; }
    public DateTime? PaidDate { get; init; }
    public string? Notes { get; init; }
    public List<ClaimLineItemDto> LineItems { get; init; } = new();
    /// <summary>What this claim does to the participants' budgets as of now (budget feature, phase 2a); omitted when none of them has a plan that has started. A warning, never a block.</summary>
    public ClaimBudgetDto? Budget { get; init; }
}

public record ClaimLineItemDto
{
    public Guid Id { get; init; }
    public Guid TripClaimId { get; init; }
    /// <summary>Set for Kind == Trip line items; null for Kind == Shift.</summary>
    public Guid? ParticipantBookingId { get; init; }
    /// <summary>Set for Kind == Shift line items (design spec §1/§3); null for Kind == Trip.</summary>
    public Guid? ShiftId { get; init; }
    public Guid? ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string NdisNumber { get; init; } = string.Empty;
    public PlanType PlanType { get; init; }
    public string SupportItemCode { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public DateOnly SupportsDeliveredFrom { get; init; }
    public DateOnly SupportsDeliveredTo { get; init; }
    public decimal Hours { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TotalAmount { get; init; }
    public GSTCode GSTCode { get; init; }
    public ClaimType ClaimType { get; init; }
    public string? CancellationReason { get; init; }
    public bool ParticipantApproved { get; init; }
    public ClaimLineItemStatus Status { get; init; }
    public string? RejectionReason { get; init; }
    public decimal? PaidAmount { get; init; }
}

public record UpdateClaimDto
{
    public Guid? AuthorisedByStaffId { get; init; }
    [StringLength(2000)]
    public string? Notes { get; init; }
    public TripClaimStatus? Status { get; init; }
}

public record UpdateClaimLineItemDto
{
    public decimal? Hours { get; init; }
    public decimal? UnitPrice { get; init; }
    [StringLength(50)]
    public string? SupportItemCode { get; init; }
    public ClaimType? ClaimType { get; init; }
    public string? CancellationReason { get; init; }
    public bool? ParticipantApproved { get; init; }
    public ClaimLineItemStatus? Status { get; init; }
    [StringLength(1000)]
    public string? RejectionReason { get; init; }
    public decimal? PaidAmount { get; init; }
}

// ══════════════════════════════════════════════════════════════
// CLAIM PREVIEW / GENERATION DTOs
// ══════════════════════════════════════════════════════════════

public record ClaimPreviewRequestDto
{
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
    public decimal? ActiveHoursPerDay { get; init; }
}

public record GenerateClaimRequestDto
{
    public TimeOnly? DepartureTime { get; init; }
    public TimeOnly? ReturnTime { get; init; }
    public decimal? ActiveHoursPerDay { get; init; }
}

public record ClaimPreviewResponseDto
{
    public TimeOnly DepartureTime { get; init; }
    public TimeOnly ReturnTime { get; init; }
    public decimal ActiveHoursPerDay { get; init; }
    public int StaffCount { get; init; }
    public string State { get; init; } = string.Empty;
    public int ConfirmedParticipantCount { get; init; }
    public List<ClaimPreviewLineItemDto> LineItems { get; init; } = new();
    public decimal TotalAmount { get; init; }
    /// <summary>What generating this claim would do to each participant's budget (budget feature, phase 2a); omitted when none has a plan that has started. A warning, never a block.</summary>
    public ClaimBudgetDto? Budget { get; init; }
}

public record ClaimPreviewLineItemDto
{
    public string ParticipantName { get; init; } = string.Empty;
    public string NdisNumber { get; init; } = string.Empty;
    public string SupportItemCode { get; init; } = string.Empty;
    public string DayTypeLabel { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public DateOnly SupportsDeliveredFrom { get; init; }
    public DateOnly SupportsDeliveredTo { get; init; }
    public decimal Hours { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TotalAmount { get; init; }
}

// ══════════════════════════════════════════════════════════════
// CLAIM-FROM-SHIFTS DTOs (shift-completion design spec §2/§3, PR 3)
// ══════════════════════════════════════════════════════════════

public record GenerateShiftClaimRequestDto
{
    public DateOnly From { get; init; }
    public DateOnly To { get; init; }
}

public record ShiftClaimPreviewResponseDto
{
    public decimal TotalAmount { get; init; }
    public List<ShiftClaimPreviewLineItemDto> LineItems { get; init; } = new();
    /// <summary>What generating this claim would do to the participant's budget (budget feature, phase 2a); omitted when they have no plan that has started. A warning, never a block.</summary>
    public ClaimBudgetDto? Budget { get; init; }
}

public record ShiftClaimPreviewLineItemDto
{
    public Guid ShiftId { get; init; }
    public DateOnly ServiceDate { get; init; }
    public string DayTypeLabel { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public string SupportItemCode { get; init; } = string.Empty;
    public decimal Hours { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal TotalAmount { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PROVIDER SETTINGS DTOs
// ══════════════════════════════════════════════════════════════

public record ProviderSettingsDto
{
    public Guid Id { get; init; }
    public string RegistrationNumber { get; init; } = string.Empty;
    public string ABN { get; init; } = string.Empty;
    public string OrganisationName { get; init; } = string.Empty;
    public string Address { get; init; } = string.Empty;
    public string State { get; init; } = "VIC";
    public bool GSTRegistered { get; init; }
    public bool IsPaceProvider { get; init; }
    public string? BankAccountName { get; init; }
    public string? BSB { get; init; }
    public string? AccountNumber { get; init; }
    public string? InvoiceFooterNotes { get; init; }
    /// <summary>MED-02: primary manager contact — shown first by the (future) MED-01 missed-medication guidance.</summary>
    public string? ManagerName { get; init; }
    public string? ManagerPhone { get; init; }
    /// <summary>How strictly this organisation applies participant readiness. Warn unless an Admin chose Enforce.</summary>
    public ParticipantReadinessMode ParticipantReadinessMode { get; init; } = ParticipantReadinessMode.Warn;

    /// <summary>"Warn" (default): a user without a current Medication Competency may record, and the record is flagged. "Enforce": refused (403).</summary>
    public MedicationCompetencyMode MedicationCompetencyMode { get; init; } = MedicationCompetencyMode.Warn;
}

public record UpsertProviderSettingsDto
{
    [Required, StringLength(20)]
    public string RegistrationNumber { get; init; } = string.Empty;
    [Required, StringLength(20)]
    public string ABN { get; init; } = string.Empty;
    [Required, StringLength(200)]
    public string OrganisationName { get; init; } = string.Empty;
    [Required, StringLength(500)]
    public string Address { get; init; } = string.Empty;
    [StringLength(10)]
    public string State { get; init; } = "VIC";
    public bool GSTRegistered { get; init; }
    public bool IsPaceProvider { get; init; }
    [StringLength(200)]
    public string? BankAccountName { get; init; }
    [StringLength(10)]
    public string? BSB { get; init; }
    [StringLength(20)]
    public string? AccountNumber { get; init; }
    [StringLength(2000)]
    public string? InvoiceFooterNotes { get; init; }
    [StringLength(200)]
    public string? ManagerName { get; init; }
    [StringLength(30)]
    public string? ManagerPhone { get; init; }
    /// <summary>
    /// OPTIONAL, and the PUT changes the readiness mode ONLY when this is present: a request that
    /// leaves it out (null or absent) never touches the stored mode, so an older client or a stale
    /// browser tab that saves an unrelated field cannot revert a mode another Admin set. Only
    /// Admin (and SuperAdmin viewing as a tenant) may send it; an undefined value is rejected.
    /// </summary>
    public ParticipantReadinessMode? ParticipantReadinessMode { get; init; }

    /// <summary>Null = leave the setting as it is (a client that does not send it must not reset it to Warn by saving the other fields);
    /// on a brand-new settings row null means the default, Warn. The settings form sends it ONLY when the user changed it from the value it loaded
    /// (it is last-write-wins: a form that re-sent a stale value would silently undo another admin's change). Only Warn and Enforce are accepted
    /// (400 otherwise). A change that actually alters the stored mode writes one audit row (ProviderSettings, MedicationCompetencyMode, old, new, who).</summary>
    public MedicationCompetencyMode? MedicationCompetencyMode { get; init; }
}

// ══════════════════════════════════════════════════════════════
// SUPPORT CATALOGUE DTOs
// ══════════════════════════════════════════════════════════════

public record SupportActivityGroupDto
{
    public Guid Id { get; init; }
    public string GroupCode { get; init; } = string.Empty;
    public string DisplayName { get; init; } = string.Empty;
    public int SupportCategory { get; init; }
    public bool IsActive { get; init; }
    public List<SupportCatalogueItemDto> Items { get; init; } = new();
}

public record SupportCatalogueItemDto
{
    public Guid Id { get; init; }
    public string ItemNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    public string Unit { get; init; } = string.Empty;
    public ClaimDayType DayType { get; init; }
    public bool IsIntensive { get; init; }
    public decimal PriceLimit_ACT { get; init; }
    public decimal PriceLimit_NSW { get; init; }
    public decimal PriceLimit_NT { get; init; }
    public decimal PriceLimit_QLD { get; init; }
    public decimal PriceLimit_SA { get; init; }
    public decimal PriceLimit_TAS { get; init; }
    public decimal PriceLimit_VIC { get; init; }
    public decimal PriceLimit_WA { get; init; }
    public decimal PriceLimit_Remote { get; init; }
    public decimal PriceLimit_VeryRemote { get; init; }
    public string CatalogueVersion { get; init; } = string.Empty;
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public bool IsActive { get; init; }

    // What the 2026-27 catalogue holds (all null on a row imported before it). The zone prices are the truth; the PriceLimit_* above
    // are the 2025-26 shape the claim screens still read.
    public string? RegistrationGroup { get; init; }
    public int? SupportCategoryNumber { get; init; }
    public int? PaceSupportCategoryNumber { get; init; }
    public int? OutcomeDomain { get; init; }
    public int? SupportPurpose { get; init; }
    public CatalogueItemType? CatalogueType { get; init; }
    public CatalogueClaimFlag? NonFaceToFace { get; init; }
    public CatalogueClaimFlag? ProviderTravel { get; init; }
    public CatalogueClaimFlag? ShortNoticeCancellation { get; init; }
    public CatalogueClaimFlag? NdiaRequestedReports { get; init; }
    public CatalogueClaimFlag? IrregularSil { get; init; }
    public bool IsLegacy { get; init; }
    public decimal? PriceNational { get; init; }
    public decimal? PriceRemote { get; init; }
    public decimal? PriceVeryRemote { get; init; }
    public string? SourceDocument { get; init; }
}

// ══════════════════════════════════════════════════════════════
// PUBLIC HOLIDAY DTOs
// ══════════════════════════════════════════════════════════════

public record PublicHolidayDto
{
    public Guid Id { get; init; }
    public DateOnly Date { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? State { get; init; }
}

public record CreatePublicHolidayDto
{
    [Required]
    public DateOnly Date { get; init; }
    [Required, StringLength(100)]
    public string Name { get; init; } = string.Empty;
    [StringLength(10)]
    public string? State { get; init; }
}

// ══════════════════════════════════════════════════════════════
// CATALOGUE IMPORT DTOs
// ══════════════════════════════════════════════════════════════

public record CatalogueImportPreviewDto
{
    /// <summary>Proposed from the file's own start dates (for example "2026-27"); the admin confirms or edits it.</summary>
    public string DetectedVersion { get; init; } = string.Empty;
    /// <summary>The price layout the header row showed: National / Remote / Very Remote (2026-27) or one column per state (2025-26).</summary>
    public CatalogueFileFormat DetectedFormat { get; init; }
    /// <summary>The uploaded file's name; stored on every imported row.</summary>
    public string SourceDocument { get; init; } = string.Empty;
    /// <summary>The earliest start date in the file: the day the catalogue takes effect.</summary>
    public DateOnly? EffectiveFrom { get; init; }
    /// <summary>Rows that will be inserted (a code with no row for that start date yet).</summary>
    public int ItemsToAdd { get; init; }
    /// <summary>Rows already in the database exactly as the file has them: nothing will change.</summary>
    public int ItemsUnchanged { get; init; }
    /// <summary>Rows on the file's Legacy sheet.</summary>
    public int LegacyItems { get; init; }
    /// <summary>Existing rows this import end-dates (never deletes): superseded by a newer version, or no longer in the catalogue.</summary>
    public int ItemsToDeactivate { get; init; }
    public List<CatalogueImportRowDto> Rows { get; init; } = new();
    public List<string> Warnings { get; init; } = new();
}

/// <remarks>
/// The confirm step posts every row back, so a default (false, 0) is left out of the JSON: it reads back as the same default. About 1,000 rows then fit
/// well inside the 1 MB a reverse proxy commonly allows for a request body.
/// </remarks>
public record CatalogueImportRowDto
{
    public string ItemNumber { get; init; } = string.Empty;
    public string Description { get; init; } = string.Empty;
    /// <summary>From the code classification map; Weekday for items that are not banded by day (see <see cref="Family"/>).</summary>
    public ClaimDayType DayType { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool IsIntensive { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_ACT { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_NSW { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_NT { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_QLD { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_SA { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_TAS { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_VIC { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_WA { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_Remote { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public decimal PriceLimit_VeryRemote { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool IsNew { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool PriceChanged { get; init; }

    // What the file holds. The server recomputes DayType, IsIntensive, Family and GroupCode from the item number on confirm, so a posted row
    // cannot file itself under another family.
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool IsUnchanged { get; init; }
    public string Unit { get; init; } = "H";
    public string? RegistrationGroup { get; init; }
    public int? SupportCategoryNumber { get; init; }
    public int? PaceSupportCategoryNumber { get; init; }
    public int? OutcomeDomain { get; init; }
    public int? SupportPurpose { get; init; }
    public CatalogueItemType? CatalogueType { get; init; }
    public CatalogueClaimFlag? NonFaceToFace { get; init; }
    public CatalogueClaimFlag? ProviderTravel { get; init; }
    public CatalogueClaimFlag? ShortNoticeCancellation { get; init; }
    public CatalogueClaimFlag? NdiaRequestedReports { get; init; }
    public CatalogueClaimFlag? IrregularSil { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool IsLegacy { get; init; }
    /// <summary>The row's own start date from the file. Required: an import never stamps "today".</summary>
    public DateOnly EffectiveFrom { get; init; }
    /// <summary>The row's own end date; null = open-ended (99991231 in the file).</summary>
    public DateOnly? EffectiveTo { get; init; }
    public decimal? PriceNational { get; init; }
    public decimal? PriceRemote { get; init; }
    public decimal? PriceVeryRemote { get; init; }
    public string SourceDocument { get; init; } = string.Empty;
    /// <summary>The support family from the classification map (an informational name; "Other" for items the map does not name).</summary>
    public string Family { get; init; } = string.Empty;
    /// <summary>The activity group the row will be filed under.</summary>
    public string GroupCode { get; init; } = string.Empty;
}

public record ConfirmCatalogueImportDto
{
    [Required, StringLength(20)]
    public string CatalogueVersion { get; init; } = string.Empty;
    public List<CatalogueImportRowDto> Rows { get; init; } = new();
}

/// <summary>What a confirmed import did to the catalogue.</summary>
public record CatalogueImportResultDto(int Added, int Updated, int Unchanged, int EndDated);
