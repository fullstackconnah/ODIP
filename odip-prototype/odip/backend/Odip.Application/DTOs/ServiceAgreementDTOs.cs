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
