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
    /// <summary>When the claim was marked Rejected (a UTC instant); omitted while it is not rejected, and for a claim rejected before this was recorded.</summary>
    public DateTime? RejectedDate { get; init; }
    /// <summary>The NDIA's code for the rejection, when one was recorded (V17, V18, V27 and V28 say the funds ran out); omitted otherwise.</summary>
    public string? RejectionCode { get; init; }
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
    /// <summary>The catalogue unit of the line's item on its service date: "H" for an hourly item, "E" for the flat "Each" item (a sleepover night, quantity 1). Omitted when no catalogue row covers the date.</summary>
    public string? Unit { get; init; }
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
    /// <summary>
    /// The NDIA's code for rejecting the claim (budget phase 2b), sent with the Rejected status or later on a claim that is already rejected: V17, V18, V27 or V28 (any case), or anything else the NDIA gave, as typed.
    /// Left out, the code is unchanged; blank clears it. Refused on a claim that is not rejected.
    /// </summary>
    [StringLength(Odip.Domain.Funding.NdiaRejectionCodes.MaxLength)]
    public string? RejectionCode { get; init; }
}

public record UpdateClaimLineItemDto
{
    [Range(typeof(decimal), "0.01", "1000", ParseLimitsInInvariantCulture = true)]
    public decimal? Hours { get; init; }
    [Range(typeof(decimal), "0", "10000", ParseLimitsInInvariantCulture = true)]
    public decimal? UnitPrice { get; init; }
    [StringLength(50)]
    public string? SupportItemCode { get; init; }
    public ClaimType? ClaimType { get; init; }
    public string? CancellationReason { get; init; }
    public bool? ParticipantApproved { get; init; }
    public ClaimLineItemStatus? Status { get; init; }
    [StringLength(1000)]
    public string? RejectionReason { get; init; }
    [Range(typeof(decimal), "0", "1000000", ParseLimitsInInvariantCulture = true)]
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
    /// <summary>The confirmed participants this claim leaves out, and why (no NDIS number; funded another way): never dropped silently. Empty when nobody is left out.</summary>
    public List<TripClaimLeftOutDto> LeftOut { get; init; } = new();
}

/// <summary>A confirmed participant a trip claim leaves out, in the shape of <see cref="ShiftClaimLeftOutDto"/>: who (Description) and why (Reason). Their booking is not claimed.</summary>
public record TripClaimLeftOutDto
{
    public Guid ParticipantId { get; init; }
    /// <summary>The participant's name.</summary>
    public string Description { get; init; } = string.Empty;
    /// <summary>Why, as a sentence that does not repeat the name ("NDIS number missing. Add it to their profile, then preview the claim again to include them.").</summary>
    public string Reason { get; init; } = string.Empty;
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
    /// <summary>
    /// The completed, unclaimed shifts in the range that this claim leaves out, and why (a sleepover or a group shift, which shift claims do not price yet; a shift no catalogue rate covers). They
    /// stay completed and unclaimed. Never dropped silently: an empty list means nothing was left out.
    /// </summary>
    public List<ShiftClaimLeftOutDto> LeftOut { get; init; } = new();
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
    /// <summary>Something worth saying about a line that is priced but not worked out fully (no shift is flagged now that every band is priced; kept for a future caveat); omitted when there is nothing to say.</summary>
    public string? Note { get; init; }
}

/// <summary>A completed, unclaimed shift a shift claim leaves out, and the reason: the claim does not silently drop it, and it stays completed and unclaimed.</summary>
public record ShiftClaimLeftOutDto
{
    public Guid ShiftId { get; init; }
    public DateOnly ServiceDate { get; init; }
    /// <summary>The shift as the ledger describes it ("Shift 22:00–06:00 · 8 h").</summary>
    public string Description { get; init; } = string.Empty;
    /// <summary>Why, as a sentence ("It is a sleepover, which shift claims do not price yet.").</summary>
    public string Reason { get; init; } = string.Empty;
}

/// <summary>
/// A shift the claim priced but could not work out fully: a caveat from the estimator (none is raised now that shifts are split by rate band). The preview says so on the line;
/// a claim line has no column for it, so the generate response echoes it, and the caveat is not kept on the line once the claim exists.
/// </summary>
public record ShiftClaimFlaggedDto
{
    public Guid ShiftId { get; init; }
    public DateOnly ServiceDate { get; init; }
    /// <summary>The shift as the ledger describes it ("Shift 22:00–06:00 · 8 h").</summary>
    public string Description { get; init; } = string.Empty;
    /// <summary>What is not worked out (none is raised now).</summary>
    public string Caveat { get; init; } = string.Empty;
}

/// <summary>The claim made from shifts (<see cref="TripClaimListDto"/>), the completed shifts in the range it left out and why, and the shifts it priced with a caveat.</summary>
public record ShiftClaimGeneratedDto : TripClaimListDto
{
    public List<ShiftClaimLeftOutDto> LeftOut { get; init; } = new();
    /// <summary>The shifts that are in the claim but priced with a caveat (no shift is flagged now that every band is priced; kept for a future caveat); empty when there are none.</summary>
    public List<ShiftClaimFlaggedDto> Flagged { get; init; } = new();
}

/// <summary>The claim run: dates are optional, and the server fills the missing ones with the last 14 days up to yesterday in the organisation's time zone.</summary>
public record ShiftClaimRunRequestDto
{
    public DateOnly? From { get; init; }
    public DateOnly? To { get; init; }
}

/// <summary>What a claim run did (or, for a preview, would do) over the dates, for every participant in the organisation with completed, unclaimed shifts.</summary>
public record ShiftClaimRunDto
{
    public DateOnly From { get; init; }
    public DateOnly To { get; init; }
    /// <summary>Claims made: 0 on a preview.</summary>
    public int ClaimsMade { get; init; }
    public int ShiftCount { get; init; }
    public decimal Hours { get; init; }
    public decimal TotalAmount { get; init; }
    /// <summary>One row per participant claimed (or, on a preview, to be claimed), by name.</summary>
    public List<ShiftClaimRunParticipantDto> Participants { get; init; } = new();
    /// <summary>The completed, unclaimed shifts the run leaves out, each with the participant and the reason. Never dropped silently.</summary>
    public List<ShiftClaimRunLeftOutDto> LeftOut { get; init; } = new();
    /// <summary>The shifts in the claims that were priced with a caveat (no shift is flagged now that every band is priced; kept for a future caveat).</summary>
    public List<ShiftClaimRunFlaggedDto> Flagged { get; init; } = new();
    /// <summary>Participants the run could not claim: not failed (nothing left to claim) or failed (nothing saved for them, run again).</summary>
    public List<ShiftClaimRunSkippedDto> Skipped { get; init; } = new();
    /// <summary>On a preview only: what all these claims together would do to the participants' budgets. A warning, never a block.</summary>
    public ClaimBudgetDto? Budget { get; init; }
}

public record ShiftClaimRunParticipantDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public int ShiftCount { get; init; }
    public decimal Hours { get; init; }
    public decimal TotalAmount { get; init; }
    /// <summary>The claim made; null on a preview.</summary>
    public Guid? ClaimId { get; init; }
    public string? ClaimReference { get; init; }
}

public record ShiftClaimRunLeftOutDto : ShiftClaimLeftOutDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
}

public record ShiftClaimRunFlaggedDto : ShiftClaimFlaggedDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
}

public record ShiftClaimRunSkippedDto
{
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string Reason { get; init; } = string.Empty;
    /// <summary>True when something went wrong and nothing was saved for this participant; false when there was simply nothing left to claim.</summary>
    public bool Failed { get; init; }
}

// ══════════════════════════════════════════════════════════════
// INVOICE DTOs (Xero PR1)
// ══════════════════════════════════════════════════════════════

/// <summary>A claim's Invoices section (D19). InvoiceState is "preview" (not submitted, no rows), "issued" (has rows), "legacy" (submitted before numbering, no rows) or "none" (no plan- or self-managed payer).</summary>
public record ClaimInvoicesDto
{
    public string InvoiceState { get; init; } = "none";
    /// <summary>By number, each credit note directly under the invoice it credits.</summary>
    public List<InvoiceSummaryDto> Invoices { get; init; } = new();
    /// <summary>Every plan- and self-managed payer (the preview and legacy rows).</summary>
    public List<PayerGroupDto> Groups { get; init; } = new();
    /// <summary>The agency-managed participants on the claim (claimed in the BPR CSV, not invoiced).</summary>
    public int AgencyCount { get; init; }
}

public record InvoiceSummaryDto
{
    public Guid Id { get; init; }
    public InvoiceKind Kind { get; init; }
    public int Number { get; init; }
    public string DisplayNumber { get; init; } = string.Empty;
    public InvoiceStatus Status { get; init; }
    /// <summary>The booking (trip claim) or participant (shift claim) it bills for.</summary>
    public Guid GroupId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string BillToName { get; init; } = string.Empty;
    public PlanType PayerKind { get; init; }
    public DateOnly IssueDate { get; init; }
    public DateOnly? DueDate { get; init; }
    public decimal Total { get; init; }
    /// <summary>On a credit note: the invoice it credits.</summary>
    public string? CreditsDisplayNumber { get; init; }
    /// <summary>On a credited invoice: its credit note.</summary>
    public string? CreditedByDisplayNumber { get; init; }
    /// <summary>A payment is recorded against it (a covered line paid or part paid, or the claim marked paid): it can only be credited, never voided.</summary>
    public bool PaymentRecorded { get; init; }
}

/// <summary>One row of the invoice register (GET invoices). Additive only: PR 2 (the page) reads it. Never the bank details or the void reason.</summary>
public record InvoiceRegisterRowDto
{
    public Guid Id { get; init; }
    public InvoiceKind Kind { get; init; }
    public string DisplayNumber { get; init; } = string.Empty;
    public InvoiceStatus Status { get; init; }
    public DateOnly IssueDate { get; init; }
    public DateOnly? DueDate { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string BillToName { get; init; } = string.Empty;
    public PlanType PayerKind { get; init; }
    public string ClaimReference { get; init; } = string.Empty;
    /// <summary>Null once the claim is deleted (the row and its number stay).</summary>
    public Guid? TripClaimId { get; init; }
    /// <summary>On a credit note: the invoice it credits.</summary>
    public string? CreditsDisplayNumber { get; init; }
    /// <summary>On a credited invoice: its credit note.</summary>
    public string? CreditedByDisplayNumber { get; init; }
    /// <summary>Signed as the PDF prints it: a credit note is negative.</summary>
    public decimal Total { get; init; }
    /// <summary>The seller organisation at issue; the page shows it to a SuperAdmin with no organisation chosen.</summary>
    public string OrganisationName { get; init; } = string.Empty;
}

public record PayerGroupDto
{
    public Guid GroupId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string BillToName { get; init; } = string.Empty;
    public PlanType PayerKind { get; init; }
    /// <summary>Subtotal plus GST, as the invoice would be.</summary>
    public decimal Total { get; init; }
}

/// <summary>Why an invoice is voided or credited: required, 1 to 500 characters; kept in the audit log, never printed.</summary>
public record InvoiceReasonDto
{
    public string? Reason { get; init; }
}

/// <summary>The claims a submit confirm is about: one (claim detail, the trip tab's row) or a selection (the trip tab's bulk change), 1 to 100.</summary>
public record SubmitPreviewRequestDto
{
    public List<Guid> ClaimIds { get; init; } = new();
}

/// <summary>What marking these claims as submitted would issue now. Numbers are predictions: a concurrent issue can take them first.</summary>
public record SubmitPreviewDto
{
    public List<ClaimSubmitPreviewDto> Claims { get; init; } = new();
    /// <summary>The invoices all of them would issue together.</summary>
    public int InvoiceCount { get; init; }
}

public record ClaimSubmitPreviewDto
{
    public Guid ClaimId { get; init; }
    /// <summary>Empty unless the claim is Draft, Ready or Rejected (only those move to Submitted).</summary>
    public List<PendingInvoiceDto> ToIssue { get; init; } = new();
    /// <summary>The claim's invoices that stand already and stay as they are.</summary>
    public int AlreadyIssued { get; init; }
    /// <summary>An invoice is due and the organisation has no settings row: submitting would be refused.</summary>
    public bool MissingSettings { get; init; }
}

public record PendingInvoiceDto
{
    public Guid GroupId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string BillToName { get; init; } = string.Empty;
    public decimal Total { get; init; }
    /// <summary>Null when the settings are missing.</summary>
    public string? PredictedNumber { get; init; }
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
    /// <summary>The stored IANA zone, or null when unset (the State's default applies, and the form shows that default).</summary>
    public string? TimeZoneId { get; init; }
    /// <summary>Settings 2b: the organisation's own contact details, all optional (null when blank).</summary>
    public string? TradingName { get; init; }
    public string? ContactEmail { get; init; }
    public string? ContactPhone { get; init; }
    public string? Website { get; init; }
    /// <summary>How strictly this organisation applies participant readiness. Warn unless an Admin chose Enforce.</summary>
    public ParticipantReadinessMode ParticipantReadinessMode { get; init; } = ParticipantReadinessMode.Warn;

    /// <summary>"Warn" (default): a user without a current Medication Competency may record, and the record is flagged. "Enforce": refused (403).</summary>
    public MedicationCompetencyMode MedicationCompetencyMode { get; init; } = MedicationCompetencyMode.Warn;

    /// <summary>The organisation's staff come from Employment Hero: the frontend hides "New staff member" and the staff import, and the server refuses them.</summary>
    public bool EmploymentHeroConnected { get; init; }

    /// <summary>The row's version: the settings form sends back the one it loaded as UpsertProviderSettingsDto.ExpectedUpdatedAt.</summary>
    public DateTime UpdatedAt { get; init; }

    /// <summary>Invoice numbering and terms (Xero PR1).</summary>
    public string InvoiceNumberPrefix { get; init; } = "INV-";
    public string CreditNotePrefix { get; init; } = "CN-";
    public int InvoiceStartNumber { get; init; } = 1;
    public int PaymentTermsDays { get; init; } = 14;
    /// <summary>Read-only: the number the next invoice will get ("INV-0043"), from the organisation's counter, else the start number.</summary>
    public string NextInvoiceDisplayNumber { get; init; } = string.Empty;
    /// <summary>Read-only: the organisation has issued an invoice, so the start number is locked.</summary>
    public bool InvoicesIssued { get; init; }
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
    public string State { get; init; } = string.Empty;
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
    /// OPTIONAL: null or absent leaves the stored zone, because every settings section echoes the row. Otherwise it must be one of
    /// <c>StateTimeZoneMap.Zones</c>, or the request gets a 400 "Choose a time zone from the list."; a change of the effective zone writes one audit row.
    /// No data annotation: its 400 is an errors object, which the form would show as the wrong sentence.
    /// </summary>
    public string? TimeZoneId { get; init; }
    /// <summary>
    /// OPTIONAL organisation contact details: null or absent leaves the stored value (every section echoes the row), blank clears it, the server trims. Email and website are
    /// checked by the controller (400 with a sentence). No [EmailAddress] or [Url]: their 400 is an errors object, which the form would show as the wrong sentence.
    /// </summary>
    [StringLength(200)]
    public string? TradingName { get; init; }
    [StringLength(254)]
    public string? ContactEmail { get; init; }
    [StringLength(30)]
    public string? ContactPhone { get; init; }
    [StringLength(500)]
    public string? Website { get; init; }
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

    /// <summary>The UpdatedAt the form loaded. Another save since then makes this one a 409, enforced in the UPDATE itself. Null skips the check, so an older open tab still saves.</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }

    /// <summary>Each is applied only when sent and different from the stored value (every settings section echoes the whole row), and each change is
    /// audited as one field change. A changed start number is refused (409) once the organisation has issued an invoice.</summary>
    public string? InvoiceNumberPrefix { get; init; }
    public string? CreditNotePrefix { get; init; }
    public int? InvoiceStartNumber { get; init; }
    public int? PaymentTermsDays { get; init; }
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
