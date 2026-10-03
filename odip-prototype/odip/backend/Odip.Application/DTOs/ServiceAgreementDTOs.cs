using System.ComponentModel.DataAnnotations;
using Odip.Domain.Billing.Pricing;

namespace Odip.Application.DTOs;

public record CreateServiceAgreementDraftDto
{
    public DateOnly PlanStartDate { get; init; }
    public DateOnly PlanEndDate { get; init; }
    public DateOnly AgreementStartDate { get; init; }
    public DateOnly AgreementEndDate { get; init; }
    [Required, RegularExpression("^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$")] public string State { get; init; } = string.Empty;
    public List<string> ServiceTypes { get; init; } = [];
    [StringLength(500)] public string? Representative { get; init; }
    /// <summary>
    /// The weekly support blocks to price (the plan builder). The server prices them through the pricing engine and stores the lines it generates; the client sends no
    /// price and no code. Send these OR <see cref="Lines"/>, never both.
    /// </summary>
    public List<DraftBlockDto>? Blocks { get; init; }
    /// <summary>
    /// Hand-typed lines (hours of one catalogue code), kept for callers that predate the builder: the screen no longer sends them. A draft made this way has no blocks, is read
    /// as it always was, and is shown read-only with a note to rebuild it from blocks.
    /// </summary>
    public List<CreateServiceAgreementDraftLineDto> Lines { get; init; } = [];
    /// <summary>
    /// The version of the newest revision the caller started from (0 when it had none). When the participant's newest version is not that one by the time the save is made, somebody
    /// else saved in between and this save would silently replace their work as the newest: it is refused with 409 and the newer version number instead. Left out, nothing is checked
    /// (callers that predate the builder).
    /// </summary>
    [Range(0, int.MaxValue)] public int? BaseVersion { get; init; }
}

/// <summary>The body of the 409 a save answers when somebody else saved a newer version first: the version that is the participant's newest now.</summary>
public record DraftVersionConflictDto
{
    public int CurrentVersion { get; init; }
}

/// <summary>One block of a revision: the block exactly as the pricing engine takes it, and what its shifts will ask of a worker.</summary>
public record DraftBlockDto
{
    public PlanBlock Block { get; init; } = new();
    public DraftBlockRequirementsDto Requirements { get; init; } = new();
    /// <summary>
    /// True when the stored text of this block can no longer be read (the model it was written with has changed): <see cref="Block"/> is then an empty block, which a screen must not show as a block
    /// somebody planned. Output only: ignored on a save.
    /// </summary>
    public bool Unreadable { get; init; }
}

/// <summary>
/// What the shifts of a block ask of a worker, as chips and never as names: a gender preference, a driver, and skills. The pricing engine does not read it; the roster patterns
/// an approved revision creates (phase D) carry it. Stored as JSON beside the block.
/// </summary>
public record DraftBlockRequirementsDto
{
    public const string NoPreference = "NoPreference", Female = "Female", Male = "Male";
    public static readonly IReadOnlyList<string> WorkerGenders = new[] { NoPreference, Female, Male };

    /// <summary>The qualifications the staff record already carries (<c>User.IsFirstAidQualified</c>, <c>IsMedicationCompetent</c>, <c>IsManualHandlingCompetent</c>).</summary>
    public static readonly IReadOnlyList<string> KnownSkills = new[] { "FirstAid", "MedicationCompetent", "ManualHandling" };

    public string WorkerGender { get; init; } = NoPreference;
    public bool Driver { get; init; }
    public List<string> Skills { get; init; } = [];
}

public record CreateServiceAgreementDraftLineDto
{
    [Required, StringLength(200)] public string ServiceType { get; init; } = string.Empty;
    [Required, StringLength(50)] public string ItemCode { get; init; } = string.Empty;
    [Range(typeof(decimal), "0.01", "100000")] public decimal Hours { get; init; }
}

public record ServiceAgreementDraftDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public int Version { get; init; }
    public string Status { get; init; } = "UnapprovedDraft";
    public string TemplateVersion { get; init; } = string.Empty;
    public string TemplateDocxSha256 { get; init; } = string.Empty;
    public string TemplatePdfSha256 { get; init; } = string.Empty;
    public string State { get; init; } = string.Empty;
    public DateOnly PlanStartDate { get; init; }
    public DateOnly PlanEndDate { get; init; }
    public DateOnly AgreementStartDate { get; init; }
    public DateOnly AgreementEndDate { get; init; }
    public string? Representative { get; init; }
    /// <summary>The blocks the revision was priced from, in plan order; empty on a draft whose lines were typed by hand.</summary>
    public List<DraftBlockDto> Blocks { get; init; } = [];
    /// <summary>What the engine answered when the revision was saved (totals, issues, notices, holiday occurrences, open questions; no per-occurrence lines). Absent on a hand-typed draft.</summary>
    public PlanQuote? Pricing { get; init; }
    public List<ServiceAgreementDraftLineDto> Lines { get; init; } = [];
    /// <summary>
    /// True on an older revision in the list: its blocks, lines and answer are left out (a long onboarding is many revisions, each tens of kilobytes) and <c>GET .../{id}</c> has them. The newest
    /// revision, the one a plan is started from, is always in full.
    /// </summary>
    public bool IsSummary { get; init; }
    public int BlockCount { get; init; }
    public int LineCount { get; init; }
    /// <summary>What the revision's lines add up to over the agreement (a hand-typed line is hours times unit price, floored to the cent).</summary>
    public decimal Total { get; init; }
    /// <summary>What a reader must not miss, a sentence each, counted in shifts: shifts with a part not priced, public holiday shifts to decide, and provisional rates. Empty for a revision priced in full or typed by hand.</summary>
    public List<string> Caveats { get; init; } = [];
    /// <summary>
    /// Who approved this revision for rostering, when, and what that did (plan builder, phase D). Absent until somebody has. It is not <see cref="Status"/> (the template's state, the same for every
    /// revision) and it is not a signature: approval makes the weekly roster patterns, nothing more.
    /// </summary>
    public DraftApprovalDto? Approval { get; init; }
    /// <summary>
    /// Only in the answer to an approval: the shifts of the revision before this one that are dated on or after this one starts and still stand, which approval leaves exactly as they are for a
    /// coordinator to tidy by hand.
    /// </summary>
    public OldShiftsRemainingDto? OldShiftsRemaining { get; init; }
}

/// <summary>The body of POST .../approve.</summary>
public record ApproveDraftDto
{
    /// <summary>Required (true) when hand-made patterns of the participant overlap the ones this approval makes: they are never ended or changed, and approving without saying so is refused.</summary>
    public bool AcknowledgeOverlaps { get; init; }
}

/// <summary>The record of an approval: who, when and what it did. Never changed afterwards; there is no un-approving.</summary>
public record DraftApprovalDto
{
    public DateTime ApprovedAt { get; init; }
    public string ApprovedByName { get; init; } = string.Empty;
    /// <summary>The weekly roster patterns it made.</summary>
    public int PatternsCreated { get; init; }
    /// <summary>The patterns of earlier approved revisions it ended the day before this revision starts.</summary>
    public int PatternsEnded { get; init; }
    /// <summary>The open shifts it generated at once (none for a participant who is not active yet).</summary>
    public int ShiftsCreated { get; init; }
    /// <summary>The last day shifts were generated to; absent when none were (the participant was not active yet).</summary>
    public DateOnly? HorizonEnd { get; init; }
    /// <summary>The first day it made a shift for; absent when it made none.</summary>
    public DateOnly? FirstShiftDate { get; init; }
}

/// <summary>Shifts of the previous approved revision on or after the new one starts: left alone by approval, counted so they can be tidied. Open means nobody is assigned.</summary>
public record OldShiftsRemainingDto
{
    public int Open { get; init; }
    public int Assigned { get; init; }
    /// <summary>The first day of them; absent when there are none.</summary>
    public DateOnly? FirstDate { get; init; }
    /// <summary>The version of the revision they came from (the one whose patterns this approval ends); absent when there is none.</summary>
    public int? FromVersion { get; init; }
}

/// <summary>One reason an approval is refused, in plain words. <see cref="Code"/> is the pricing engine's reason name (NoItem, BlocksOverlap, ...) or one of this feature's own (HolidayUndecided, ReviewFlag, HandTyped, TimeZoneMismatch, ...).</summary>
public record ApprovalReasonDto
{
    public string Code { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;
    /// <summary>The block it is about ('PlanBlock.Id'); absent when it is about the whole revision.</summary>
    public string? BlockId { get; init; }
    public int? Count { get; init; }
    public DateOnly? FirstDate { get; init; }
}

/// <summary>A hand-made pattern of the participant that overlaps one the approval would make: listed so a coordinator can decide, and never ended or changed by approval.</summary>
public record OverlappingPatternDto
{
    public Guid Id { get; init; }
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public string? Notes { get; init; }
}

/// <summary>What approving a revision would do, with nothing done: the same reasons approval would refuse for, and the counts the confirm screen states.</summary>
public record DraftApprovalPreviewDto
{
    public bool CanApprove { get; init; }
    /// <summary>The revision has been approved already; nothing more can be done to it.</summary>
    public bool AlreadyApproved { get; init; }
    public List<ApprovalReasonDto> Reasons { get; init; } = [];
    public int PatternsToCreate { get; init; }
    public int PatternsToEnd { get; init; }
    /// <summary>The version whose patterns would end.</summary>
    public int? EndsFromVersion { get; init; }
    /// <summary>The day they would end: the day before this revision starts.</summary>
    public DateOnly? EndsOn { get; init; }
    /// <summary>The open shifts approval would generate at once: none while the participant is not active, and then <see cref="ShiftsNote"/> says why.</summary>
    public int ShiftsToCreate { get; init; }
    public string? ShiftsNote { get; init; }
    public OldShiftsRemainingDto OldShiftsRemaining { get; init; } = new();
    public List<OverlappingPatternDto> OverlappingPatterns { get; init; } = [];
    /// <summary>The provider's today plus the horizon (56 days), held to the end of the agreement.</summary>
    public DateOnly? HorizonEnd { get; init; }
}

public record ServiceAgreementDraftLineDto
{
    public string ServiceType { get; init; } = string.Empty;
    public decimal Hours { get; init; }
    public string ItemCode { get; init; } = string.Empty;
    public decimal UnitPrice { get; init; }
    public string CatalogueVersion { get; init; } = string.Empty;
    public DateOnly CatalogueEffectiveFrom { get; init; }
    public DateOnly? CatalogueEffectiveTo { get; init; }
    /// <summary>The block the line was generated from (its id in <see cref="ServiceAgreementDraftDto.Blocks"/>); absent on a hand-typed line.</summary>
    public string? BlockId { get; init; }
    /// <summary>The time band or kind of companion, in the engine's words; absent on a hand-typed line.</summary>
    public string? Band { get; init; }
    /// <summary>H hour, E each (a dollar amount is quantity x $1.00), D day or night. <see cref="Hours"/> is the quantity in this unit.</summary>
    public string Unit { get; init; } = "H";
    /// <summary>What the line claims for the agreement period. Authoritative: it is the sum of the occurrences' own totals, not hours times unit price. For a hand-typed line it is hours times unit price, floored to the cent.</summary>
    public decimal Total { get; init; }
    public int Occurrences { get; init; }
    /// <summary>The engine's flags on the line (Review, HolidayExposure, Provisional), written as the quote writes them.</summary>
    public PlannedLineFlags Flags { get; init; }
}

/// <summary>
/// A deliberately non-persistent walkthrough result. It is not evidence, an activation, a
/// booking, a billable event, or a claim.
/// </summary>
public record DemoJourneySimulationDto(string Banner, string Signing, string Activation, string Booking, string RateLabel);
