using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Computes participant risk alerts at read time — no <c>Alert</c> entity, no migration, nothing
/// persisted. Every rule derives from data that already exists elsewhere in the domain (see
/// task-6-brief.md sub-task 6c / odip-domain-map.md for what backs each rule). All tenant scoping
/// comes for free from <c>OdipDbContext</c>'s global <c>ITenantEntity</c> query filters — this
/// service never touches <c>ICurrentTenant</c> directly.
///
/// Rules implemented (five from the brief; two from the original list were dropped — see below):
/// 1. <b>restrictive-practice-review-overdue</b> (Warning) — an active <see cref="RestrictivePractice"/>
///    row whose <see cref="RestrictivePractice.ReviewDate"/> is in the past.
/// 2. <b>high-risk-medication-witness-gap</b> (Critical) — an active, <see cref="ParticipantMedication.IsHighRisk"/>
///    medication with an Administered dose in the last 7 days whose <see cref="MedicationAdministration.WitnessStatus"/>
///    is Pending or Declined (i.e. never reached Approved).
/// 3. <b>routine-coverage-gap</b> (Warning) — a high-support or overnight-support participant with
///    no active <see cref="ParticipantRoutine"/> row at all.
/// 4. <b>plan-expired</b> (Critical) / <b>plan-expiring-soon</b> (Warning) — <see cref="Participant.PlanEndDate"/>
///    is in the past, or within <see cref="PlanExpiryWarningDays"/> days.
/// 5. <b>missed-dose-signal</b> (Warning) — an active, Regular, Daily-frequency medication with
///    zero <see cref="MedicationAdministration"/> rows (any status) in the last 7 days. Deliberately
///    simple per the brief: only Daily-frequency Regular meds are checked (not SpecificDays/EveryNDays),
///    and PRN medications are skipped entirely (no fixed schedule to be "missed" against).
///
/// Dropped: a medication/support-profile "review overdue" rule was NOT added here — it would
/// duplicate <c>MedicationsController.ToListDto</c>'s existing per-medication
/// <c>ComplianceFlags</c> ("ReviewOverdue"/"ConsentMissing"), which is out of scope for this
/// participant-level slice (M12's future central alert framework is the place to unify the two).
/// </summary>
public class ParticipantAlertsService
{
    /// <summary>A plan ending within this many days (but not yet past) is a Warning, not Critical.</summary>
    private const int PlanExpiryWarningDays = 30;

    /// <summary>Lookback window for the medication-administration-based signals (rules 2 and 5).</summary>
    private const int AdministrationWindowDays = 7;

    private readonly OdipDbContext _db;
    public ParticipantAlertsService(OdipDbContext db) => _db = db;

    /// <summary>Narrow projection of a recent <see cref="MedicationAdministration"/> — just what rules 2/5 need.</summary>
    private sealed record RecentAdministration(Guid ParticipantMedicationId, MedicationAdministrationStatus Status, WitnessStatus WitnessStatus);

    /// <summary>
    /// Computes alerts for one participant (<paramref name="participantId"/> set) or every
    /// participant visible to the current tenant (null). Always returns one
    /// <see cref="ParticipantAlertsDto"/> per matching participant, even with an empty
    /// <see cref="ParticipantAlertsDto.Alerts"/> list, so callers can look a participant up by id
    /// without a separate existence check.
    ///
    /// <paramref name="activeOnly"/> (fix round 1, review finding): when true, excludes archived
    /// (<c>IsActive == false</c>) participants from the result entirely — a churned participant's
    /// stale data (e.g. a <c>PlanEndDate</c> from before they left) would otherwise generate a
    /// permanent, undismissable alert. Defaults to false so a direct single-participant lookup
    /// (<see cref="Odip.Api.Controllers.ParticipantAlertsController.GetForParticipant"/>) keeps
    /// computing alerts regardless of active status — a coordinator looking at an archived
    /// participant's own detail page still wants to see them. The aggregate endpoint
    /// (<see cref="Odip.Api.Controllers.ParticipantAlertsController.GetAggregate"/>) passes
    /// <c>true</c> explicitly, since every current aggregate consumer (participants table,
    /// dashboard) only cares about active participants.
    /// </summary>
    public async Task<List<ParticipantAlertsDto>> GetAlertsAsync(Guid? participantId, bool activeOnly = false, CancellationToken ct = default)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var planWarningCutoff = today.AddDays(PlanExpiryWarningDays);
        var administrationWindowStart = DateTime.UtcNow.AddDays(-AdministrationWindowDays);

        var participantsQuery = _db.Participants.AsQueryable();
        if (participantId.HasValue) participantsQuery = participantsQuery.Where(p => p.Id == participantId.Value);
        // INTAKE-08: the aggregate (activeOnly=true) also excludes drafts, same reasoning as the
        // archived-participant exclusion right above — a draft's incomplete data (e.g. no
        // PlanEndDate yet) shouldn't surface as a permanent alert on the participants table.
        if (activeOnly) participantsQuery = participantsQuery.Where(p => p.IsActive && !p.IsDraft);

        var participants = await participantsQuery
            .Select(p => new
            {
                p.Id,
                p.FirstName,
                p.LastName,
                p.PreferredName,
                p.IsActive,
                p.IsHighSupport,
                p.OvernightSupport,
                p.PlanEndDate,
            })
            .ToListAsync(ct);

        if (participants.Count == 0) return new List<ParticipantAlertsDto>();

        var participantIds = participants.Select(p => p.Id).ToList();
        var alertsByParticipant = participantIds.ToDictionary(id => id, _ => new List<ParticipantAlertDto>());
        void Add(Guid pid, string type, AlertSeverity severity, string message, string deepLinkTab) =>
            alertsByParticipant[pid].Add(new ParticipantAlertDto
            {
                Type = type,
                Severity = severity,
                Message = message,
                DeepLinkTab = deepLinkTab,
            });

        // ── Rule 1: restrictive practice review overdue ──
        var overdueReviews = await _db.RestrictivePractices
            .Where(rp => participantIds.Contains(rp.ParticipantId) && rp.IsActive
                && rp.ReviewDate != null && rp.ReviewDate < today)
            .Select(rp => new { rp.ParticipantId, rp.Type, rp.ReviewDate })
            .ToListAsync(ct);
        foreach (var rp in overdueReviews)
        {
            Add(rp.ParticipantId, "restrictive-practice-review-overdue", AlertSeverity.Warning,
                $"{rp.Type} restrictive practice review was due {rp.ReviewDate:yyyy-MM-dd} and is overdue",
                "restrictive-practices");
        }

        // ── Rules 2 & 5 share the active-medications + recent-administrations data ──
        var activeMeds = await _db.ParticipantMedications
            .Where(m => participantIds.Contains(m.ParticipantId) && m.Status == MedicationStatus.Active)
            .Select(m => new { m.Id, m.ParticipantId, m.Name, m.IsHighRisk, m.Type, m.Frequency })
            .ToListAsync(ct);
        var activeMedIds = activeMeds.Select(m => m.Id).ToList();

        var recentAdministrations = activeMedIds.Count == 0
            ? new List<RecentAdministration>()
            : await _db.MedicationAdministrations
                .Where(a => activeMedIds.Contains(a.ParticipantMedicationId)
                    && ((a.AdministeredAt != null && a.AdministeredAt >= administrationWindowStart)
                        || (a.AdministeredAt == null && a.ScheduledAt != null && a.ScheduledAt >= administrationWindowStart)))
                .Select(a => new RecentAdministration(a.ParticipantMedicationId, a.Status, a.WitnessStatus))
                .ToListAsync(ct);

        // Rule 2: high-risk medication administered without an approved witness
        foreach (var med in activeMeds.Where(m => m.IsHighRisk))
        {
            var hasWitnessGap = recentAdministrations.Any(a => a.ParticipantMedicationId == med.Id
                && a.Status == MedicationAdministrationStatus.Administered
                && a.WitnessStatus != WitnessStatus.Approved
                && a.WitnessStatus != WitnessStatus.NotRequired);
            if (hasWitnessGap)
            {
                Add(med.ParticipantId, "high-risk-medication-witness-gap", AlertSeverity.Critical,
                    $"{med.Name}: high-risk medication administered in the last {AdministrationWindowDays} days without an approved witness",
                    "medications");
            }
        }

        // Rule 5: missed-dose signal — active, Regular, Daily meds with no administration recorded
        foreach (var med in activeMeds.Where(m => m.Type == MedicationType.Regular && m.Frequency == MedicationFrequency.Daily))
        {
            var hasAnyRecord = recentAdministrations.Any(a => a.ParticipantMedicationId == med.Id);
            if (!hasAnyRecord)
            {
                Add(med.ParticipantId, "missed-dose-signal", AlertSeverity.Warning,
                    $"{med.Name}: no administration recorded in the last {AdministrationWindowDays} days",
                    "medications");
            }
        }

        // ── Rule 3: routine coverage gap ──
        var participantsWithActiveRoutines = (await _db.ParticipantRoutines
            .Where(r => participantIds.Contains(r.ParticipantId) && r.IsActive)
            .Select(r => r.ParticipantId)
            .Distinct()
            .ToListAsync(ct)).ToHashSet();

        foreach (var p in participants)
        {
            var needsCoverage = p.IsHighSupport || p.OvernightSupport != OvernightSupportType.None;
            if (needsCoverage && !participantsWithActiveRoutines.Contains(p.Id))
            {
                Add(p.Id, "routine-coverage-gap", AlertSeverity.Warning,
                    "High-support/overnight participant has no active routines recorded",
                    "routines");
            }
        }

        // ── Rule 4: plan end date ──
        foreach (var p in participants)
        {
            if (p.PlanEndDate is not { } planEndDate) continue;

            if (planEndDate < today)
            {
                Add(p.Id, "plan-expired", AlertSeverity.Critical,
                    $"NDIS plan end date ({planEndDate:yyyy-MM-dd}) has passed",
                    "details");
            }
            else if (planEndDate <= planWarningCutoff)
            {
                Add(p.Id, "plan-expiring-soon", AlertSeverity.Warning,
                    $"NDIS plan ends {planEndDate:yyyy-MM-dd}",
                    "details");
            }
        }

        // ── Assemble, rank Critical-first within each participant ──
        var result = new List<ParticipantAlertsDto>();
        foreach (var p in participants)
        {
            var alerts = alertsByParticipant[p.Id]
                .OrderBy(a => (int)a.Severity)
                .ThenBy(a => a.Type, StringComparer.Ordinal)
                .ToList();

            result.Add(new ParticipantAlertsDto
            {
                ParticipantId = p.Id,
                ParticipantName = string.IsNullOrEmpty(p.PreferredName) ? $"{p.FirstName} {p.LastName}" : $"{p.PreferredName} {p.LastName}",
                IsActive = p.IsActive,
                Alerts = alerts,
                CriticalCount = alerts.Count(a => a.Severity == AlertSeverity.Critical),
                WarningCount = alerts.Count(a => a.Severity == AlertSeverity.Warning),
                InfoCount = alerts.Count(a => a.Severity == AlertSeverity.Info),
            });
        }

        return result;
    }
}
