using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A register entry for a restrictive practice in use for a participant. Consolidates what was
/// previously fragmented across three places: <see cref="Participant.HasRestrictivePracticeFlag"/>
/// (now derived — true iff a participant has any active row here — rather than independently
/// writable), <see cref="SupportProfile.RestrictivePracticeDetails"/> (legacy free text, one-time
/// backfilled into a single <see cref="RestrictivePracticeType.Unclassified"/> row per participant
/// by the AddRestrictivePractices migration), and <see cref="ParticipantMedication.IsChemicalRestraint"/>
/// (kept as the linkage flag on the medication; also one-time backfilled into a
/// <see cref="RestrictivePracticeType.ChemicalRestraint"/> row with <see cref="RelatedMedicationId"/>
/// set). Never hard-deleted by the backfill, but the CRUD API does allow a hard delete — unlike
/// <see cref="ParticipantMedication"/>/<see cref="ParticipantNote"/> this register mirrors
/// <see cref="ParticipantRoutine"/>'s shape, with <see cref="IsActive"/> as the normal way to
/// retire an entry without losing its authorisation history.
/// </summary>
public class RestrictivePractice : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public RestrictivePracticeType Type { get; set; }
    public string Description { get; set; } = string.Empty;
    public string? AuthorisedBy { get; set; }
    public DateOnly? AuthorisationDate { get; set; }
    public DateOnly? ReviewDate { get; set; }
    /// <summary>Routine or as needed. Ignored while <see cref="RelatedMedicationId"/> is set: read it through <c>RestrictivePracticeAuthorisation.UseKindOf</c>.</summary>
    public RestrictivePracticeUseKind UseKind { get; set; } = RestrictivePracticeUseKind.Routine;
    /// <summary>Last day the authorisation applies (inclusive); null means open-ended.</summary>
    public DateOnly? AuthorisationEndDate { get; set; }
    /// <summary>When this practice was first used; starts the behaviour support plan due dates.</summary>
    public DateOnly? FirstUsedOn { get; set; }
    /// <summary>When the interim behaviour support plan was put in place.</summary>
    public DateOnly? InterimBspDate { get; set; }
    /// <summary>When the comprehensive behaviour support plan was put in place.</summary>
    public DateOnly? ComprehensiveBspDate { get; set; }
    /// <summary>First day of the month this entry joins the monthly report. Null means the month the row was created (CreatedAt, provider zone); the migration backfilled existing rows to its deploy month.</summary>
    public DateOnly? ReportingFromMonth { get; set; }
    /// <summary>Whether this restraint needs reporting to the NDIS Commission; null until answered.</summary>
    public bool? RequiresReporting { get; set; }

    /// <summary>
    /// Only meaningful when <see cref="Type"/> is <see cref="RestrictivePracticeType.ChemicalRestraint"/> —
    /// links the <see cref="ParticipantMedication"/> this restraint is based on. Must belong to
    /// the same participant (enforced by the controller).
    /// </summary>
    public Guid? RelatedMedicationId { get; set; }
    public ParticipantMedication? RelatedMedication { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>The row's version as well as its last change: a concurrency token (OdipDbContext). Held in whole microseconds, as PostgreSQL stores it, so the value a GET sends, returned as ExpectedUpdatedAt, still matches the stored one.</summary>
    public DateTime UpdatedAt { get => _updatedAt; set => _updatedAt = Micro(value); }
    private DateTime _updatedAt = Micro(DateTime.UtcNow);
    private static DateTime Micro(DateTime value) => new(value.Ticks - value.Ticks % 10, value.Kind);
}
