using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>One due dose: a Regular medication's schedule slot inside the requested window.</summary>
/// <param name="Medication">The medication, with <see cref="ParticipantMedication.Participant"/> loaded.</param>
/// <param name="ScheduledAt">Provider-local wall-clock slot time (Kind Unspecified), as stored on <see cref="MedicationAdministration.ScheduledAt"/>.</param>
/// <param name="TimeOfDay">The slot's time of day ("08:00").</param>
/// <param name="Administration">The record for this slot (newest by CreatedAt if legacy data holds several), or null when nothing is recorded yet.</param>
/// <param name="IsOverdue">True for an unrecorded slot more than 60 minutes past its provider-local time.</param>
public sealed record MedicationSlot(
    ParticipantMedication Medication, DateTime ScheduledAt, TimeSpan TimeOfDay,
    MedicationAdministration? Administration, bool IsOverdue);

/// <summary>A PRN ("as needed") medication with its rolling-24-hour dosing picture. PRN has no schedule, so no slots.</summary>
public sealed record PrnMedicationStatus(
    ParticipantMedication Medication, int DosesInLast24h, DateTime? LastDoseAt,
    MedicationAdministration? OutcomePendingAdministration);

public sealed record MedicationWindowResult(
    IReadOnlyList<MedicationSlot> Slots, IReadOnlyList<PrnMedicationStatus> Prn);

/// <summary>
/// The MAR slot computation, extracted from <c>MedicationsController.GetMar</c> into a service with a
/// WINDOW form: a half-open provider-local interval [start, end) that may span two calendar dates (an
/// overnight shift). The MAR's own "one calendar day" is just the window [00:00, next 00:00), so
/// <c>GET medications/mar</c> and the shift package compute due doses with one implementation.
///
/// Time: slots are provider-local wall-clock values; "overdue" is decided against the provider's time
/// zone (see <see cref="Odip.Domain.Rostering.ProviderLocalTime"/>), not UTC. The clock is injectable
/// (<see cref="TimeProvider"/>) so midnight/DST behaviour is testable.
/// </summary>
public sealed class MedicationSlotService
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public MedicationSlotService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    public DateTime UtcNow => _clock.GetUtcNow().UtcDateTime;

    /// <summary>
    /// Due slots (and, when <paramref name="includePrn"/>, the PRN picture) for active medications in
    /// [<paramref name="windowStartLocal"/>, <paramref name="windowEndLocal"/>). <paramref name="participantId"/>
    /// limits it to one participant; null spans the whole tenant (the coordinator MAR). Medications are
    /// returned in database order and slots in enumeration order — callers that need a display order sort.
    /// </summary>
    public async Task<MedicationWindowResult> GetWindowAsync(
        DateTime windowStartLocal, DateTime windowEndLocal, Guid? participantId,
        TimeZoneInfo zone, bool includePrn, CancellationToken ct)
    {
        var now = UtcNow;
        var windowStartDate = windowStartLocal.Date;

        var medQuery = _db.ParticipantMedications
            .Include(m => m.Participant)
            .Where(m => m.Status == MedicationStatus.Active);
        if (participantId.HasValue)
            medQuery = medQuery.Where(m => m.ParticipantId == participantId.Value);

        // ── Regular medications expanded into per-time-of-day slots ──
        var regularMeds = await medQuery
            .Where(m => m.Type == MedicationType.Regular
                && m.StartDate < windowEndLocal
                && (m.EndDate == null || m.EndDate >= windowStartDate))
            .ToListAsync(ct);

        var regularMedIds = regularMeds.Select(m => m.Id).ToList();
        var windowAdministrations = regularMedIds.Count == 0
            ? new List<MedicationAdministration>()
            : await _db.MedicationAdministrations
                .Where(a => regularMedIds.Contains(a.ParticipantMedicationId)
                    && a.ScheduledAt != null && a.ScheduledAt >= windowStartLocal && a.ScheduledAt < windowEndLocal)
                .ToListAsync(ct);

        var slots = new List<MedicationSlot>();
        foreach (var m in regularMeds)
        {
            foreach (var scheduledAt in MedicationSlotCalculator.EnumerateSlots(m, windowStartLocal, windowEndLocal))
            {
                var administration = windowAdministrations
                    .Where(a => a.ParticipantMedicationId == m.Id && a.ScheduledAt == scheduledAt)
                    .OrderByDescending(a => a.CreatedAt)
                    .FirstOrDefault();
                slots.Add(new MedicationSlot(
                    m, scheduledAt, scheduledAt.TimeOfDay, administration,
                    MedicationSlotCalculator.IsOverdue(scheduledAt, administration != null, now, zone)));
            }
        }

        if (!includePrn)
            return new MedicationWindowResult(slots, Array.Empty<PrnMedicationStatus>());

        // ── PRN medications with rolling 24h counts (instants, so zone-independent) ──
        var prnMeds = await medQuery.Where(m => m.Type == MedicationType.Prn).ToListAsync(ct);
        var prnMedIds = prnMeds.Select(m => m.Id).ToList();
        var last24hCutoff = now.AddHours(-24);

        var recentPrnAdministrations = prnMedIds.Count == 0
            ? new List<MedicationAdministration>()
            : await _db.MedicationAdministrations
                .Where(a => prnMedIds.Contains(a.ParticipantMedicationId)
                    && a.Status == MedicationAdministrationStatus.Administered
                    && a.AdministeredAt != null && a.AdministeredAt >= last24hCutoff)
                .ToListAsync(ct);

        var pendingOutcomeAdministrations = prnMedIds.Count == 0
            ? new List<MedicationAdministration>()
            : await _db.MedicationAdministrations
                .Where(a => prnMedIds.Contains(a.ParticipantMedicationId)
                    && a.Status == MedicationAdministrationStatus.Administered
                    && a.PrnOutcome == null)
                .OrderByDescending(a => a.AdministeredAt)
                .ToListAsync(ct);

        var prn = new List<PrnMedicationStatus>();
        foreach (var m in prnMeds)
        {
            var doses = recentPrnAdministrations.Where(a => a.ParticipantMedicationId == m.Id).ToList();
            var pending = pendingOutcomeAdministrations.FirstOrDefault(a => a.ParticipantMedicationId == m.Id);
            prn.Add(new PrnMedicationStatus(m, doses.Count, doses.Count > 0 ? doses.Max(a => a.AdministeredAt) : null, pending));
        }

        return new MedicationWindowResult(slots, prn);
    }
}
