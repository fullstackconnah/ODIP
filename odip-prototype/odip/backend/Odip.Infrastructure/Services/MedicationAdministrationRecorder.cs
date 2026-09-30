using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public enum RecordAdministrationOutcome
{
    /// <summary>A new administration record was created.</summary>
    Created,

    /// <summary>The idempotency key matched a record an earlier identical submit created; nothing new was written.</summary>
    Replayed,

    /// <summary>The medication does not exist (or is not one this caller may record against).</summary>
    NotFound,

    /// <summary>The request failed validation (missing reason, witness, PRN limit, reused key ...).</summary>
    Invalid,

    /// <summary>The recording user has no current Medication Competency credential (403).</summary>
    CompetencyRequired,

    /// <summary>The scheduled dose slot already has a record (409); <see cref="RecordAdministrationResult.Administration"/> is that record.</summary>
    AlreadyRecorded,
}

public sealed record RecordAdministrationResult(
    RecordAdministrationOutcome Outcome,
    AdministrationDto? Administration = null,
    string? Message = null,
    string? Code = null);

/// <summary>One "record this dose" request.</summary>
/// <param name="MedicationId">The medication the dose is for.</param>
/// <param name="Dto">The submitted record.</param>
/// <param name="AdministeringUserId">The caller's resolved staff user id (ViewAsUserId first, then the JWT subject), or null.</param>
/// <param name="FallbackRecordedByName">The JWT display name, used only when no user row can be resolved.</param>
/// <param name="RequiredParticipantId">When set (the portal package), the medication must belong to this participant.</param>
public sealed record RecordAdministrationRequest(
    Guid MedicationId, CreateAdministrationDto Dto, Guid? AdministeringUserId, string FallbackRecordedByName,
    Guid? RequiredParticipantId = null);

/// <summary>
/// The one implementation of "record a medication administration", shared by the general
/// <c>POST medications/{id}/administrations</c> and the shift package's portal endpoint so the rules can't
/// drift between them. It is the original <c>MedicationsController.RecordAdministration</c> logic (reasons,
/// wrong-medication note, PRN reason and limits, staff-witness rule, notifications and obligation tasks)
/// plus, in order:
///
/// 1. <b>The Medication Competency gate.</b> Recording ANY administration needs a current, unexpired
///    Medication Competency credential on the recording user — see <see cref="MedicationCompetencyGate"/>.
///    No role bypass, including the coordinator MAR path.
/// 2. <b>Idempotent replay.</b> A submit carrying an <see cref="CreateAdministrationDto.IdempotencyKey"/> already
///    used for this medication returns the earlier record (a double tap is safe). The unique filtered index
///    on the key backs this up against a true race.
/// 3. <b>One record per scheduled dose slot.</b> For a scheduled dose (ScheduledAt set), a record that already
///    exists for (medication, ScheduledAt) blocks a second one: <see cref="RecordAdministrationOutcome.AlreadyRecorded"/>
///    with the existing record. This is an application rule, not a unique index, because existing data may already
///    hold duplicates per slot — see <see cref="MedicationAdministration.IdempotencyKey"/>.
/// </summary>
public sealed class MedicationAdministrationRecorder
{
    private readonly OdipDbContext _db;
    private readonly INotificationRaiser _notificationRaiser;
    private readonly IObligationTaskService _obligationTasks;
    private readonly TimeProvider _clock;

    public MedicationAdministrationRecorder(
        OdipDbContext db, INotificationRaiser? notificationRaiser = null, IObligationTaskService? obligationTasks = null,
        TimeProvider? clock = null)
    {
        _db = db;
        _notificationRaiser = notificationRaiser ?? new Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Tasks.ObligationTaskService(db);
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>Evaluates the Medication Competency gate for a user at the provider-local "today".</summary>
    public async Task<MedicationCompetencyCheck> CheckCompetencyAsync(Guid? userId, CancellationToken ct)
    {
        var user = userId.HasValue ? await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct) : null;
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(_clock.GetUtcNow().UtcDateTime, provider.Zone));
        return MedicationCompetencyGate.Evaluate(user, providerToday);
    }

    public async Task<RecordAdministrationResult> RecordAsync(RecordAdministrationRequest request, CancellationToken ct)
    {
        var dto = request.Dto;
        var med = await _db.ParticipantMedications.Include(m => m.Participant).FirstOrDefaultAsync(m => m.Id == request.MedicationId, ct);
        if (med == null || (request.RequiredParticipantId is { } participantId && med.ParticipantId != participantId))
            return Fail(RecordAdministrationOutcome.NotFound, "Medication not found");

        var nowUtc = _clock.GetUtcNow().UtcDateTime;

        // The administering identity, resolved once by the caller (ViewAsUserId first, then the JWT subject —
        // §4.3) and reused for the competency gate, the self-witness check and RecordedByName/RecordedByUserId.
        var administeringUser = request.AdministeringUserId.HasValue
            ? await _db.Users.FirstOrDefaultAsync(u => u.Id == request.AdministeringUserId.Value, ct)
            : null;

        // ── 1. Medication Competency gate (before any validation: a worker without the credential should be
        //       told that first, not asked to fix a reason field they cannot then submit) ──
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(nowUtc, provider.Zone));
        var competency = MedicationCompetencyGate.Evaluate(administeringUser, providerToday);
        if (!competency.IsCurrent)
            return Fail(RecordAdministrationOutcome.CompetencyRequired, competency.Message!, competency.Code);

        var participantName = MedicationMapping.ParticipantName(med.Participant);
        AdministrationDto ToDto(MedicationAdministration a) =>
            MedicationMapping.ToAdministrationDto(a, participantName, med.Name, med.DoseDescription);

        // ── 2. Idempotent replay ──
        var key = string.IsNullOrWhiteSpace(dto.IdempotencyKey) ? null : dto.IdempotencyKey.Trim();
        if (key != null)
        {
            var prior = await _db.MedicationAdministrations
                .FirstOrDefaultAsync(a => a.IdempotencyKey == key && a.TenantId == med.TenantId, ct);
            if (prior != null)
            {
                return prior.ParticipantMedicationId == med.Id
                    ? new RecordAdministrationResult(RecordAdministrationOutcome.Replayed, ToDto(prior))
                    : Fail(RecordAdministrationOutcome.Invalid,
                        "This request key was already used for a different medication.",
                        MedicationErrorCodes.AdministrationIdempotencyKeyReused);
            }
        }

        if (dto.Status != MedicationAdministrationStatus.Administered && string.IsNullOrWhiteSpace(dto.Reason))
            return Fail(RecordAdministrationOutcome.Invalid, "A reason is required when a dose is refused, withheld, missed or the wrong medication was given.");

        // MED-03: wrong-medication recording additionally requires a note on what was actually
        // given instead of the prescribed medication — required on both ends (see
        // RecordAdministrationModal's requiresWrongMedNote).
        if (dto.Status == MedicationAdministrationStatus.WrongMedication && string.IsNullOrWhiteSpace(dto.Notes))
            return Fail(RecordAdministrationOutcome.Invalid, "A note describing what was given instead is required when recording a wrong medication administration.");

        if (med.Type == MedicationType.Prn && dto.Status == MedicationAdministrationStatus.Administered && string.IsNullOrWhiteSpace(dto.PrnReason))
            return Fail(RecordAdministrationOutcome.Invalid, "A PRN reason is required when recording an administered PRN dose.");

        // ── 3. One record per scheduled dose slot ──
        if (dto.ScheduledAt is { } scheduledAt)
        {
            var existing = await _db.MedicationAdministrations
                .Where(a => a.ParticipantMedicationId == med.Id && a.ScheduledAt == scheduledAt)
                .OrderByDescending(a => a.CreatedAt)
                .FirstOrDefaultAsync(ct);
            if (existing != null)
                return new RecordAdministrationResult(
                    RecordAdministrationOutcome.AlreadyRecorded, ToDto(existing),
                    "This dose has already been recorded.", MedicationErrorCodes.AdministrationAlreadyRecorded);
        }

        User? witnessStaff = null;
        if (med.IsHighRisk && dto.Status == MedicationAdministrationStatus.Administered)
        {
            if (dto.WitnessStaffId is null && string.IsNullOrWhiteSpace(dto.WitnessName))
                return Fail(RecordAdministrationOutcome.Invalid, "A witness is required for high-risk medication administration.");

            if (dto.WitnessStaffId.HasValue)
            {
                // Same-tenant scoping comes for free here: _db.Users is ambient-tenant-filtered
                // by OdipDbContext for any non-SuperAdmin caller, so a cross-tenant witness id
                // simply resolves to no row, same as "not found" (§4.4).
                witnessStaff = await _db.Users.FirstOrDefaultAsync(s => s.Id == dto.WitnessStaffId.Value && s.IsActive, ct);
                if (witnessStaff == null)
                    return Fail(RecordAdministrationOutcome.Invalid, "Selected witness staff member was not found.");

                if (administeringUser != null && administeringUser.Id == witnessStaff.Id)
                    return Fail(RecordAdministrationOutcome.Invalid, "A staff member cannot witness their own administration.");
            }
        }

        var limitBreachAcknowledged = false;
        if (med.Type == MedicationType.Prn && dto.Status == MedicationAdministrationStatus.Administered)
        {
            var last24hCutoff = nowUtc.AddHours(-24);
            var recent = await _db.MedicationAdministrations
                .Where(a => a.ParticipantMedicationId == med.Id
                    && a.Status == MedicationAdministrationStatus.Administered
                    && a.AdministeredAt != null && a.AdministeredAt >= last24hCutoff)
                .OrderByDescending(a => a.AdministeredAt)
                .ToListAsync(ct);

            string? breachMessage = null;
            if (med.PrnMaxDosesPer24h.HasValue && recent.Count >= med.PrnMaxDosesPer24h.Value)
                breachMessage = $"Maximum {med.PrnMaxDosesPer24h.Value} doses in 24 hours reached";
            else if (med.PrnMinIntervalMinutes.HasValue && recent.Count > 0)
            {
                var last = recent[0].AdministeredAt!.Value;
                if ((nowUtc - last).TotalMinutes < med.PrnMinIntervalMinutes.Value)
                    breachMessage = $"Minimum interval of {med.PrnMinIntervalMinutes.Value} minutes not yet elapsed";
            }

            if (breachMessage != null)
            {
                if (!dto.AcknowledgeLimitBreach)
                    return Fail(RecordAdministrationOutcome.Invalid, breachMessage);
                limitBreachAcknowledged = true;
            }
        }

        var administeredAt = dto.AdministeredAt;
        if (dto.Status == MedicationAdministrationStatus.Administered && administeredAt == null)
            administeredAt = nowUtc;

        var admin = new MedicationAdministration
        {
            Id = Guid.NewGuid(),
            ParticipantMedicationId = med.Id,
            ParticipantId = med.ParticipantId,
            TripInstanceId = dto.TripInstanceId,
            ScheduledAt = dto.ScheduledAt,
            AdministeredAt = administeredAt,
            AdministeredAtTimeZone = dto.AdministeredAtTimeZone,
            Status = dto.Status,
            DoseGiven = dto.DoseGiven,
            RecordedByName = administeringUser?.FullName ?? request.FallbackRecordedByName,
            RecordedByUserId = administeringUser?.Id,
            WitnessName = witnessStaff?.FullName ?? dto.WitnessName,
            WitnessUserId = witnessStaff?.Id,
            WitnessStatus = witnessStaff != null ? WitnessStatus.Pending : WitnessStatus.NotRequired,
            WitnessRequestedAt = witnessStaff != null ? nowUtc : null,
            Reason = dto.Reason,
            PrnReason = dto.PrnReason,
            Notes = dto.Notes,
            LimitBreachAcknowledged = limitBreachAcknowledged,
            IdempotencyKey = key,
        };
        _db.MedicationAdministrations.Add(admin);

        // NotificationEventType.WitnessRequested — only when a staff witness was nominated
        // (witnessStaff is null for a free-text/external witness, which has nothing to
        // approve). Design spec §5.
        if (witnessStaff is not null)
        {
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.WitnessRequested, "MedicationAdministration", admin.Id,
                new[] { witnessStaff.Id },
                new Odip.Infrastructure.Notifications.Templates.WitnessRequestedPayload(
                    witnessStaff.Email, admin.RecordedByName, participantName),
                ct);

            // Item 9 of the connection map: a staff witness was nominated and is pending sign-off.
            await _obligationTasks.EnsureAsync(new ObligationTaskSpec(
                SourceKey: $"med-witness:{admin.Id}",
                Type: TaskType.MedicationWitness,
                Title: $"Witness sign-off needed: {med.Name} for {participantName}",
                DueDate: DateOnly.FromDateTime(nowUtc.AddDays(1)),
                LinkTo: "/portal/witness-approvals",
                MedicationAdministrationId: admin.Id), ct);
        }

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (key != null && ex.InnerException is PostgresException pg
                                          && pg.ConstraintName == MedicationAdministration.IdempotencyIndexName)
        {
            // A racing submit with the SAME key committed between our replay check and our insert. The filtered
            // unique index rejected this one — its outbox/task rows went down with the same transaction — so
            // drop everything tracked and return the winner, exactly as the sequential replay path would.
            _db.ChangeTracker.Clear();
            var winner = await _db.MedicationAdministrations.FirstOrDefaultAsync(a => a.IdempotencyKey == key && a.TenantId == med.TenantId, ct);
            if (winner != null && winner.ParticipantMedicationId == med.Id)
                return new RecordAdministrationResult(RecordAdministrationOutcome.Replayed, ToDto(winner));
            throw;
        }

        return new RecordAdministrationResult(RecordAdministrationOutcome.Created, ToDto(admin));
    }

    private static RecordAdministrationResult Fail(RecordAdministrationOutcome outcome, string message, string? code = null) =>
        new(outcome, null, message, code);
}
