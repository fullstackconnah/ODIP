using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A single recorded dose event (or non-event — Refused/Withheld/Missed) against a
/// <see cref="ParticipantMedication"/>. Forms the Medication Administration Record (MAR).
/// </summary>
public class MedicationAdministration : ITenantEntity
{
    /// <summary>Database name of the filtered unique index on (TenantId, IdempotencyKey) WHERE the key is
    /// not null (OdipDbContext + migration AddMedicationAdministrationIdempotencyKey). The recorder matches
    /// this name on PostgresException.ConstraintName to turn a racing duplicate submit into an idempotent
    /// replay instead of a 500.</summary>
    public const string IdempotencyIndexName = "IX_MedicationAdministrations_TenantId_IdempotencyKey";

    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantMedicationId { get; set; }
    public ParticipantMedication? ParticipantMedication { get; set; }

    /// <summary>Denormalized from ParticipantMedication for fast MAR queries.</summary>
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public Guid? TripInstanceId { get; set; }
    public TripInstance? TripInstance { get; set; }

    /// <summary>Null for PRN doses, which have no fixed schedule.</summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>Always stored as UTC. The client supplies its own local-clock instant (which
    /// already resolves to the correct UTC instant regardless of zone) via
    /// <see cref="Odip.Application.DTOs.CreateAdministrationDto.AdministeredAt"/>; when that's
    /// absent (no-JS-timestamp fallback) the server stamps <see cref="DateTime.UtcNow"/> instead.
    /// See <see cref="AdministeredAtTimeZone"/> for the zone that instant should be *displayed*
    /// in.</summary>
    public DateTime? AdministeredAt { get; set; }

    /// <summary>
    /// The IANA time zone (e.g. "Australia/Sydney") the client was in when it captured
    /// <see cref="AdministeredAt"/>, so the MAR/report/witness-queue UIs can render the dose time
    /// faithfully as it looked to the person who gave it — rather than reinterpreting the UTC
    /// instant in whichever zone the *viewing* browser happens to be in. Null for records with no
    /// client-supplied timestamp (no-JS fallback) or from before this field existed; UI falls back
    /// to the viewer's local zone in that case.
    /// </summary>
    public string? AdministeredAtTimeZone { get; set; }

    public MedicationAdministrationStatus Status { get; set; }
    public string? DoseGiven { get; set; }

    /// <summary>Set server-side from the recording user's resolved identity — never
    /// client-supplied. Resolved the same way as <see cref="WitnessUserId"/>'s self-witness check:
    /// <c>ICurrentTenant.ViewAsUserId</c> takes priority (SuperAdmin "view as" switching), falling
    /// back to the JWT's own subject claim. Falls back to raw JWT claims
    /// (<c>fullName</c>/<c>ClaimTypes.Name</c>) only when no user row can be resolved at all (e.g.
    /// a test constructing the controller with no HTTP context).</summary>
    public string RecordedByName { get; set; } = string.Empty;

    /// <summary>The resolved user who recorded this administration, when resolvable. Nullable
    /// because a small number of legacy/edge-case callers (see <see cref="RecordedByName"/> remarks)
    /// have no resolvable user id — <see cref="RecordedByName"/> is always populated regardless.</summary>
    public Guid? RecordedByUserId { get; set; }
    public User? RecordedByUser { get; set; }

    /// <summary>
    /// Kept populated for backward compatibility with existing reads/reports — mirrors
    /// <see cref="WitnessStaff"/>'s name when a staff witness is selected, or the legacy free-text
    /// witness name when one isn't (older/unmigrated callers).
    /// </summary>
    public string? WitnessName { get; set; }

    /// <summary>The user selected to witness this administration, if any. Only this user may
    /// approve/decline the resulting request.</summary>
    public Guid? WitnessUserId { get; set; }
    public User? WitnessUser { get; set; }

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    /// <summary>Required when Status is not Administered (refused/withheld/missed/wrong
    /// medication — MED-03).</summary>
    public string? Reason { get; set; }

    public string? PrnReason { get; set; }
    public string? PrnOutcome { get; set; }
    public DateTime? PrnOutcomeAt { get; set; }

    /// <summary>True when this dose was recorded despite breaching the PRN max-doses/min-interval ceiling.</summary>
    public bool LimitBreachAcknowledged { get; set; }

    /// <summary>MED-03: also required (non-whitespace) when Status is WrongMedication — holds
    /// what was actually given instead of the prescribed medication. Optional for every other
    /// status.</summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Optional client-generated key (a UUID per "record this dose" sheet is ideal) that makes a submit
    /// idempotent: a retry or double tap carrying the same key returns the record the first request
    /// created instead of creating another. Null for every pre-existing row and for callers that send no
    /// key. Uniqueness is (TenantId, key) over NON-NULL keys only (a filtered unique index), so it cannot
    /// conflict with any existing data. NOT a per-slot constraint — "one record per scheduled dose slot" is
    /// an application-level rule (existing data may already hold duplicates per slot, so a plain unique
    /// index on (medication, ScheduledAt) would fail the deploy migration).
    /// </summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>
    /// Set on an EARLIER record when a later one superseded it: the id of the record that replaced it. Null = this is the ACTIVE record for
    /// its slot (the only one the MAR, the shift package and the coordinator review show). Only a Refused, Withheld or Missed record is ever
    /// superseded, and only by a record saying the dose was given (Administered or WrongMedication: the participant refused at 09:00 and took
    /// it at 09:40; a Missed record turned out to be wrong because the dose was given): the earlier
    /// record is KEPT as history (it still appears in the participant history and the administration report, marked by this link) and the
    /// change is audited. Nullable uuid with no foreign key, so adding it is metadata-only and cannot fail on existing data. Soft link by
    /// design: administration records are never deleted.
    /// </summary>
    public Guid? SupersededByAdministrationId { get; set; }

    /// <summary>
    /// True when the recording user did NOT hold a current Medication Competency at the time (provider mode Warn lets the record through and
    /// flags it here; in Enforce mode such a record is refused, so it can only be false). A permanent fact about the record, never recomputed
    /// from the user later. NOT NULL with the constant default false: every existing record reads false.
    /// </summary>
    public bool RecordedWithoutCompetency { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
