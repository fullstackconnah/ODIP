using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
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

    /// <summary>The dose is charted too early, or the time it was given is outside the allowed range (422); see the result <c>Code</c>.</summary>
    TimeRejected,
}

/// <summary>
/// Whether a user may record a dose right now, per the provider mode. Warn: always (a not-current credential gets <see cref="Reason"/>
/// as a warning and the record is flagged); Enforce: only with a current credential (otherwise <see cref="Reason"/> is the refusal).
/// <see cref="Code"/> is the competency status code (MEDICATION_COMPETENCY_MISSING / _EXPIRED / _UNVERIFIABLE) in both cases.
/// </summary>
public sealed record RecordingAccess(bool CanRecord, bool IsCurrent, MedicationCompetencyMode Mode, string? Reason, string? Code);

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
/// <param name="AdministeredAtLowerBoundUtc">The earliest instant the dose can have been given, when the caller knows one: the portal passes the
/// shift's actual start. When null, a scheduled dose is bounded below by the start of the slot's provider-local day (the MAR path) and a PRN
/// dose has no lower bound.</param>
public sealed record RecordAdministrationRequest(
    Guid MedicationId, CreateAdministrationDto Dto, Guid? AdministeringUserId, string FallbackRecordedByName,
    Guid? RequiredParticipantId = null, DateTime? AdministeredAtLowerBoundUtc = null);

/// <summary>
/// The one implementation of "record a medication administration", shared by the general
/// <c>POST medications/{id}/administrations</c> and the shift package's portal endpoint so the rules can't
/// drift between them. It is the original <c>MedicationsController.RecordAdministration</c> logic (reasons,
/// wrong-medication note, PRN reason and limits, staff-witness rule, notifications and obligation tasks)
/// plus, in order:
///
/// 1. <b>The Medication Competency gate</b>, applied per the provider <see cref="MedicationCompetencyMode"/>. A current, unexpired
///    credential on the recording user (<see cref="MedicationCompetencyGate"/>) always records. Without one: Enforce refuses
///    (403, no role bypass, including the coordinator MAR path); Warn (the default) records the dose and FLAGS it
///    (<see cref="MedicationAdministration.RecordedWithoutCompetency"/>).
/// 2. <b>Idempotent replay.</b> A submit carrying an <see cref="CreateAdministrationDto.IdempotencyKey"/> already
///    used for the SAME request (medication, slot and outcome) returns the earlier record (a double tap is safe); the same
///    key on a different request is refused, never silently dropped. The unique filtered index on the key backs this up
///    against a true race.
/// 3. <b>Temporal validation (422).</b> An Administered dose is refused when the slot is more than <see cref="EarlyAdministrationMinutes"/>
///    minutes away (ADMINISTRATION_TOO_EARLY), and a supplied <c>administeredAt</c> must lie between the earliest the dose could have been given
///    (the shift's actual start on the portal path, the start of the slot's provider-local day on the MAR path) and now plus
///    <see cref="ClockSkewMinutes"/> (ADMINISTRATION_TIME_OUT_OF_RANGE). All comparisons are on UTC instants; times in messages are provider-local.
/// 4. <b>One ACTIVE record per scheduled dose slot.</b> For a scheduled dose (ScheduledAt set), an active record that already
///    exists for (medication, ScheduledAt) blocks a second one: <see cref="RecordAdministrationOutcome.AlreadyRecorded"/>
///    with the existing record. The one exception: a later ADMINISTERED record SUPERSEDES an active Refused or Missed one (the
///    participant refused then took it; a cover worker takes over) - the earlier record is kept as history, linked through
///    <see cref="MedicationAdministration.SupersededByAdministrationId"/>, in the same transaction and under the same slot lock. An
///    Administered record is never superseded here; only the coordinator amend path changes it.
///    This is an application rule, not a unique index, because existing data may already
///    hold duplicates per slot — see <see cref="MedicationAdministration.IdempotencyKey"/>. On PostgreSQL the replay check, the slot
///    check and the insert run under a transaction-scoped advisory lock keyed on the slot, so two requests for one slot (two
///    devices, two workers, a double tap with no key) cannot both pass the check: the loser waits, then gets the winner's record
///    as a replay when its key matches and as a 409 when it does not.
/// </summary>
public sealed class MedicationAdministrationRecorder
{
    /// <summary>An ADMINISTERED dose cannot be charted more than this many minutes before the slot's time (422 ADMINISTRATION_TOO_EARLY).</summary>
    public const int EarlyAdministrationMinutes = 60;

    /// <summary>How far past "now" the time a dose was given may be (device clock skew) before it is refused (422 ADMINISTRATION_TIME_OUT_OF_RANGE).</summary>
    public const int ClockSkewMinutes = 5;

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

    /// <summary>Evaluates the Medication Competency credential for a user at the provider-local "today" (the credential only; see <see cref="CheckRecordingAccessAsync"/> for what the provider mode makes of it).</summary>
    public async Task<MedicationCompetencyCheck> CheckCompetencyAsync(Guid? userId, CancellationToken ct)
    {
        var user = userId.HasValue ? await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value, ct) : null;
        var provider = await ProviderTimeZoneResolver.ResolveAsync(_db, ct);
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(_clock.GetUtcNow().UtcDateTime, provider.Zone));
        return MedicationCompetencyGate.Evaluate(user, providerToday);
    }

    /// <summary>Whether <paramref name="userId"/> may record a dose now: the credential check combined with the provider mode (default Warn when there are no settings).</summary>
    public async Task<RecordingAccess> CheckRecordingAccessAsync(Guid? userId, CancellationToken ct)
    {
        var check = await CheckCompetencyAsync(userId, ct);
        var mode = await _db.ProviderSettings.Select(p => (MedicationCompetencyMode?)p.MedicationCompetencyMode).FirstOrDefaultAsync(ct)
            ?? MedicationCompetencyMode.Warn;
        return DescribeAccess(check, mode);
    }

    /// <summary>The pure half of <see cref="CheckRecordingAccessAsync"/>.</summary>
    public static RecordingAccess DescribeAccess(MedicationCompetencyCheck check, MedicationCompetencyMode mode)
    {
        if (check.IsCurrent) return new RecordingAccess(true, true, mode, null, null);
        return mode == MedicationCompetencyMode.Warn
            ? new RecordingAccess(true, false, mode, MedicationCompetencyGate.WarningMessage, check.Code)
            : new RecordingAccess(false, false, mode, check.Message, check.Code);
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

        // ── 1. Medication Competency (before any validation: in Enforce mode a worker without the credential should be
        //       told that first, not asked to fix a reason field they cannot then submit). In Warn mode the record goes ahead and
        //       is flagged RecordedWithoutCompetency. ──
        var settings = await _db.ProviderSettings.Select(p => new { p.State, p.MedicationCompetencyMode }).FirstOrDefaultAsync(ct);
        var provider = ProviderTimeZoneResolver.FromState(settings?.State);
        var providerToday = DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(nowUtc, provider.Zone));
        var competency = MedicationCompetencyGate.Evaluate(administeringUser, providerToday);
        var access = DescribeAccess(competency, settings?.MedicationCompetencyMode ?? MedicationCompetencyMode.Warn);
        if (!access.CanRecord)
            return Fail(RecordAdministrationOutcome.CompetencyRequired, access.Reason!, access.Code);
        var recordedWithoutCompetency = !competency.IsCurrent;

        var participantName = MedicationMapping.ParticipantName(med.Participant);
        AdministrationDto ToDto(MedicationAdministration a) =>
            MedicationMapping.ToAdministrationDto(a, participantName, med.Name, med.DoseDescription);

        // The slot lock comes BEFORE both the replay check and the one-record-per-slot check and is held until the insert commits (released
        // by disposal on every early return): a concurrent request for the same slot waits here, and once it gets in it sees the winner's
        // record - as a replay (200) when the key matches, as an AlreadyRecorded (409) when it does not.
        await using var slotLock = await SlotLock.AcquireAsync(_db, med.Id, dto.ScheduledAt, ct);

        // ── 2. Idempotent replay ──
        // A key means "this exact request": a replay is only honoured when the medication, slot and outcome all match. A client that
        // reused one key for two doses (generated once per page instead of per sheet) would otherwise have its second dose silently
        // dropped while the screen shows success.
        RecordAdministrationResult ReplayOf(MedicationAdministration prior)
        {
            if (prior.ParticipantMedicationId != med.Id)
                return Fail(RecordAdministrationOutcome.Invalid,
                    "This request key was already used for a different medication.", MedicationErrorCodes.AdministrationIdempotencyKeyReused);
            if (prior.ScheduledAt != dto.ScheduledAt || prior.Status != dto.Status)
                return Fail(RecordAdministrationOutcome.Invalid,
                    "This request key was already used for a different dose.", MedicationErrorCodes.AdministrationIdempotencyKeyReused);
            return new RecordAdministrationResult(RecordAdministrationOutcome.Replayed, ToDto(prior));
        }

        var key = string.IsNullOrWhiteSpace(dto.IdempotencyKey) ? null : dto.IdempotencyKey.Trim();
        if (key != null)
        {
            var prior = await _db.MedicationAdministrations
                .FirstOrDefaultAsync(a => a.IdempotencyKey == key && a.TenantId == med.TenantId, ct);
            if (prior != null) return ReplayOf(prior);
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

        // ── 3. Temporal validation (422) ──
        var timeRejection = ValidateTimes(dto, request.AdministeredAtLowerBoundUtc, nowUtc, provider.Zone);
        if (timeRejection is not null) return timeRejection;

        // ── 4. One ACTIVE record per scheduled dose slot (under the slot lock taken above) ──
        var toSupersede = new List<MedicationAdministration>();
        if (dto.ScheduledAt is { } scheduledAt)
        {
            var active = await _db.MedicationAdministrations
                .Where(a => a.ParticipantMedicationId == med.Id && a.ScheduledAt == scheduledAt && a.SupersededByAdministrationId == null)
                .OrderByDescending(a => a.CreatedAt)
                .ToListAsync(ct);
            if (active.Count > 0)
            {
                // Only Administered supersedes, and only Refused or Missed records (legacy duplicates are all checked: a single
                // Administered one anywhere in the slot blocks it). Anything else is the existing 409 with the newest active record.
                var supersedes = dto.Status == MedicationAdministrationStatus.Administered
                    && active.All(a => a.Status is MedicationAdministrationStatus.Refused or MedicationAdministrationStatus.Missed);
                if (!supersedes)
                    return new RecordAdministrationResult(
                        RecordAdministrationOutcome.AlreadyRecorded, ToDto(active[0]),
                        "This dose has already been recorded.", MedicationErrorCodes.AdministrationAlreadyRecorded);
                toSupersede = active;
            }
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
            RecordedWithoutCompetency = recordedWithoutCompetency,
        };
        _db.MedicationAdministrations.Add(admin);

        // The replaced Refused/Missed records stay as history, linked to their replacement (saved with it, or not at all).
        foreach (var earlier in toSupersede)
        {
            earlier.SupersededByAdministrationId = admin.Id;
            earlier.UpdatedAt = nowUtc;
        }

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
            await slotLock.CommitAsync(ct);
        }
        catch (DbUpdateException ex) when (key != null && ex.InnerException is PostgresException pg
                                          && pg.ConstraintName == MedicationAdministration.IdempotencyIndexName)
        {
            // A racing submit with the SAME key committed between our replay check and our insert. The filtered
            // unique index rejected this one — its outbox/task rows went down with the same transaction — so
            // drop everything tracked and return the winner, exactly as the sequential replay path would. (A failed statement
            // aborts a PostgreSQL transaction, so the slot lock's transaction is rolled back before the winner is read.)
            _db.ChangeTracker.Clear();
            await slotLock.RollbackAsync(ct);
            var winner = await _db.MedicationAdministrations.FirstOrDefaultAsync(a => a.IdempotencyKey == key && a.TenantId == med.TenantId, ct);
            if (winner != null) return ReplayOf(winner);
            throw;
        }

        return new RecordAdministrationResult(RecordAdministrationOutcome.Created, ToDto(admin));
    }

    /// <summary>
    /// Serialises concurrent recordings of ONE dose slot on PostgreSQL: a transaction-scoped advisory lock keyed on (medication, slot),
    /// taken before the "already recorded?" check and released when the transaction ends. There is deliberately no unique index on
    /// (medication, slot) - existing data may hold duplicates and a migration over them could fail on deploy - so this lock is what
    /// makes the one-record-per-slot rule hold under concurrency. The key is computed here (not with a server hash function) so it does
    /// not depend on the server version; a hash collision only serialises two unrelated slots briefly. A no-op for an unscheduled (PRN)
    /// dose and on a provider without advisory locks (the in-memory test provider). If the context is already inside a transaction the
    /// lock joins it and that transaction's owner commits.
    /// </summary>
    private sealed class SlotLock : IAsyncDisposable
    {
        private readonly IDbContextTransaction? _owned;

        private SlotLock(IDbContextTransaction? owned) => _owned = owned;

        public static async Task<SlotLock> AcquireAsync(OdipDbContext db, Guid medicationId, DateTime? slot, CancellationToken ct)
        {
            if (slot is null || !db.Database.IsNpgsql()) return new SlotLock(null);

            var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({KeyFor(medicationId, slot.Value)})", ct);
            return new SlotLock(owned);
        }

        public Task CommitAsync(CancellationToken ct) => _owned?.CommitAsync(ct) ?? Task.CompletedTask;

        public Task RollbackAsync(CancellationToken ct) => _owned?.RollbackAsync(ct) ?? Task.CompletedTask;

        public ValueTask DisposeAsync() => _owned?.DisposeAsync() ?? ValueTask.CompletedTask;

        private static long KeyFor(Guid medicationId, DateTime slot)
        {
            Span<byte> bytes = stackalloc byte[24];
            medicationId.TryWriteBytes(bytes);
            BitConverter.TryWriteBytes(bytes[16..], slot.Ticks);
            return BitConverter.ToInt64(SHA256.HashData(bytes), 0);
        }
    }

    private static RecordAdministrationResult Fail(RecordAdministrationOutcome outcome, string message, string? code = null) =>
        new(outcome, null, message, code);

    /// <summary>
    /// The temporal rules. (1) An Administered scheduled dose is refused when its slot is more than <see cref="EarlyAdministrationMinutes"/> minutes
    /// ahead of now (exactly 60 is allowed). (2) A supplied <c>administeredAt</c> (any status) must be no later than now + <see cref="ClockSkewMinutes"/>
    /// and no earlier than the lower bound: the caller's (the shift's actual start), else the start of the slot's provider-local day, else none (PRN on
    /// the MAR path has no slot to anchor to). Slots are provider-local wall clock and compared as UTC instants; messages show provider-local time.
    /// </summary>
    private static RecordAdministrationResult? ValidateTimes(
        CreateAdministrationDto dto, DateTime? callerLowerBoundUtc, DateTime nowUtc, TimeZoneInfo zone)
    {
        var nowLocal = ProviderLocalTime.UtcToLocal(nowUtc, zone);

        if (dto.Status == MedicationAdministrationStatus.Administered && dto.ScheduledAt is { } slot
            && ProviderLocalTime.LocalToUtc(slot, zone) > nowUtc.AddMinutes(EarlyAdministrationMinutes))
        {
            return Fail(RecordAdministrationOutcome.TimeRejected,
                $"This dose is not due until {FormatLocal(slot, nowLocal)}. It can be recorded from {FormatLocal(slot.AddMinutes(-EarlyAdministrationMinutes), nowLocal)}.",
                MedicationErrorCodes.AdministrationTooEarly);
        }

        if (dto.AdministeredAt is { } given)
        {
            var givenUtc = ProviderLocalTime.AsUtc(given);
            if (givenUtc > nowUtc.AddMinutes(ClockSkewMinutes))
            {
                return Fail(RecordAdministrationOutcome.TimeRejected,
                    "The time this dose was given can't be in the future. Check the time and try again.",
                    MedicationErrorCodes.AdministrationTimeOutOfRange);
            }

            // The caller's bound is the shift's actual start (the portal); otherwise the start of the slot's provider-local day (the MAR).
            DateTime? lowerUtc = null;
            var lowerWhat = string.Empty;
            if (callerLowerBoundUtc is { } caller)
            {
                lowerUtc = ProviderLocalTime.AsUtc(caller);
                lowerWhat = $"when the shift started ({FormatLocal(ProviderLocalTime.UtcToLocal(lowerUtc.Value, zone), nowLocal)})";
            }
            else if (dto.ScheduledAt is { } scheduled)
            {
                lowerUtc = ProviderLocalTime.LocalToUtc(scheduled.Date, zone);
                lowerWhat = $"the start of {scheduled.Date.ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture)}, the day this dose was scheduled for";
            }
            if (lowerUtc is { } lower && givenUtc < lower)
            {
                return Fail(RecordAdministrationOutcome.TimeRejected,
                    $"The time this dose was given can't be earlier than {lowerWhat}. Check the time and try again.",
                    MedicationErrorCodes.AdministrationTimeOutOfRange);
            }
        }

        return null;
    }

    /// <summary>A provider-local wall-clock time for a message: "14:00" on the same local day as now, "15 Jul 14:00" otherwise (invariant culture).</summary>
    private static string FormatLocal(DateTime local, DateTime nowLocal) =>
        local.Date == nowLocal.Date
            ? local.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture)
            : local.ToString("d MMM HH:mm", System.Globalization.CultureInfo.InvariantCulture);
}
