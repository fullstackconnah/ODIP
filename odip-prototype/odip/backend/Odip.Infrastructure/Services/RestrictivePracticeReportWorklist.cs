using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Incidents;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The monthly restrictive practice report worklist: one line per practice and month that is owed or already lodged. The GET, the CSV, lodge validation, the
/// participant alerts and the dashboard count all read it, so they cannot disagree. Static, like <see cref="ProviderTimeZoneResolver"/>: no state to inject.
/// </summary>
public static class RestrictivePracticeReportWorklist
{
    /// <summary>
    /// The lines for the practices in scope. <paramref name="tenantId"/> narrows every query to that organisation on top of the global tenant filter (a SuperAdmin
    /// context has none); null leaves the filter alone (the dashboard and alerts). <paramref name="withDetails"/> adds participant names, the uses of each month
    /// and the suggested type; without it a count or a state is all that is built. A deactivated practice keeps only the months that have a counted use or a
    /// lodged report, so the no-details path still looks up whether a deactivated practice used anything.
    /// shortcut: a deactivated routine practice has no counted uses, so its unlodged months drop; a DeactivatedOn date would keep the months it ran.
    /// shortcut: every line since each practice's start month is returned; add a from-month filter or paging past about 2,000 lines per organisation.
    /// </summary>
    public static async Task<List<RestrictivePracticeReportLineDto>> LinesAsync(
        OdipDbContext db, DateTime utcNow, Guid? tenantId, IReadOnlyCollection<Guid>? participantIds, bool withDetails, CancellationToken ct)
    {
        var practiceQuery = db.RestrictivePractices.AsNoTracking().Include(rp => rp.RelatedMedication)
            .Where(rp => rp.RequiresReporting != false && rp.AuthorisationDate != null);
        if (tenantId is { } t) practiceQuery = practiceQuery.Where(rp => rp.TenantId == t);
        if (participantIds != null) practiceQuery = practiceQuery.Where(rp => participantIds.Contains(rp.ParticipantId));
        var practices = await practiceQuery.ToListAsync(ct);
        if (practices.Count == 0) return [];

        var practiceIds = practices.Select(rp => rp.Id).ToList();
        var reports = await db.RestrictivePracticeMonthlyReports.AsNoTracking()
            .Where(r => practiceIds.Contains(r.RestrictivePracticeId) && (tenantId == null || r.TenantId == tenantId))
            .ToListAsync(ct);
        var reportsByPractice = reports.ToLookup(r => r.RestrictivePracticeId);

        var tenantIds = practices.Select(rp => rp.TenantId).Distinct().ToList();
        var settings = await db.ProviderSettings.AsNoTracking().Where(s => tenantIds.Contains(s.TenantId))
            .Select(s => new { s.TenantId, s.TimeZoneId, s.State }).ToListAsync(ct);
        var zones = tenantIds.ToDictionary(id => id, id =>
        {
            var row = settings.FirstOrDefault(s => s.TenantId == id);
            return ProviderTimeZoneResolver.For(row?.TimeZoneId, row?.State).Zone;
        });
        var todays = zones.ToDictionary(z => z.Key, z => ProviderLocalTime.TodayIn(utcNow, z.Value));

        // Months each practice could list, before the deactivated filter.
        var candidates = new List<(RestrictivePractice Practice, DateOnly Month)>();
        foreach (var rp in practices)
        {
            var zone = zones[rp.TenantId];
            var lodged = reportsByPractice[rp.Id].ToList();
            DateOnly? stop = lodged.Where(r => r.ReportType is RestrictivePracticeReportType.Eliminated or RestrictivePracticeReportType.ServiceCeased)
                .Select(r => (DateOnly?)r.Month).Min();
            var owed = RestrictivePracticeMonthlyReporting.MonthsOwed(rp, RestrictivePracticeMonthlyReporting.StartMonth(rp.ReportingFromMonth, rp.CreatedAt, zone),
                RestrictivePracticeMonthlyReporting.LastEndedMonth(todays[rp.TenantId]), stop);
            foreach (var m in owed.Concat(lodged.Select(r => r.Month)).Distinct()) candidates.Add((rp, m));
        }
        if (candidates.Count == 0) return [];

        var needUses = withDetails ? practices : practices.Where(rp => !rp.IsActive).ToList();
        var needIds = needUses.Select(rp => rp.Id).ToHashSet();
        var uses = await UsesAsync(db, needUses, candidates.Where(c => needIds.Contains(c.Practice.Id)).Select(c => c.Month).ToList(), zones, tenantId, ct);

        var lastEnded = candidates.Select(c => RestrictivePracticeMonthlyReporting.LastEndedMonth(todays[c.Practice.TenantId])).Max();
        var holidays = await PublicHolidayLoader.LoadAsync(db, new DateOnly(candidates.Min(c => c.Month).Year, 1, 1), new DateOnly(lastEnded.Year + 1, 12, 31), includePartDay: false, ct);
        var calendar = new HolidayCalendar(holidays);
        var nationalYears = holidays.Where(h => h.State == null && h.Source == PublicHolidayLoader.FeedSource).Select(h => h.Date.Year).ToHashSet();
        var dueByMonth = new Dictionary<DateOnly, (DateOnly DueOn, bool WeekendsOnly)>();

        var names = new Dictionary<Guid, string>();
        if (withDetails)
        {
            var pids = practices.Select(rp => rp.ParticipantId).Distinct().ToList();
            names = (await db.Participants.AsNoTracking().Where(p => pids.Contains(p.Id)).Select(p => new { p.Id, p.FirstName, p.LastName }).ToListAsync(ct))
                .ToDictionary(p => p.Id, p => $"{p.FirstName} {p.LastName}".Trim());
        }

        var lines = new List<RestrictivePracticeReportLineDto>();
        foreach (var (rp, month) in candidates)
        {
            var report = reportsByPractice[rp.Id].FirstOrDefault(r => r.Month == month);
            var monthUses = uses.GetValueOrDefault((rp.Id, month)) ?? [];
            if (!rp.IsActive && report == null && monthUses.Count == 0) continue;
            if (!dueByMonth.TryGetValue(month, out var due)) dueByMonth[month] = due = RestrictivePracticeMonthlyReporting.DueOn(month, calendar, nationalYears);
            var kind = KindOf(rp);
            lines.Add(new RestrictivePracticeReportLineDto
            {
                RestrictivePracticeId = rp.Id, ParticipantId = rp.ParticipantId, ParticipantName = names.GetValueOrDefault(rp.ParticipantId, string.Empty),
                PracticeType = report?.PracticeType ?? rp.Type, PracticeDescription = report?.PracticeDescription ?? rp.Description, UseKind = kind,
                AuthorisationDate = rp.AuthorisationDate, AuthorisationEndDate = rp.AuthorisationEndDate, Month = month, DueOn = due.DueOn, DueCountedWithoutHolidays = due.WeekendsOnly,
                State = RestrictivePracticeMonthlyReporting.State(due.DueOn, report != null, todays[rp.TenantId]),
                SuggestedType = withDetails && kind == RestrictivePracticeUseKind.Prn ? (monthUses.Count == 0 ? RestrictivePracticeReportType.NotUsed : RestrictivePracticeReportType.UsesReported) : null,
                Uses = withDetails ? monthUses : [],
                Report = report == null ? null : new RestrictivePracticeMonthlyReportDto
                {
                    Id = report.Id, ReportType = report.ReportType, VariedKind = report.VariedKind, VariedAlsoUnauthorised = report.VariedAlsoUnauthorised, UseCount = report.UseCount,
                    Note = report.Note, LodgedOn = report.LodgedOn, LodgedByName = report.LodgedByName, CreatedAt = report.CreatedAt,
                },
            });
        }
        return lines.OrderBy(l => l.State switch { MonthlyReportState.Overdue => 0, MonthlyReportState.Due => 1, _ => 2 })
            .ThenBy(l => l.Month).ThenBy(l => l.ParticipantName, StringComparer.Ordinal).ThenBy(l => l.PracticeType).ToList();
    }

    /// <summary>
    /// <see cref="RestrictivePracticeAuthorisation.UseKindOf"/> without the throw: a linked entry whose medicine did not load counts as routine (no uses), so one orphan
    /// row cannot fail the dashboard for every Admin.
    /// </summary>
    internal static RestrictivePracticeUseKind KindOf(RestrictivePractice rp) =>
        rp.RelatedMedicationId == null ? rp.UseKind
        : rp.RelatedMedication?.Type == MedicationType.Prn ? RestrictivePracticeUseKind.Prn : RestrictivePracticeUseKind.Routine;

    /// <summary>
    /// The counted uses per practice and month, in at most two queries. A linked chemical practice counts administered doses of its medicine (UTC, bucketed in the
    /// practice's own zone); an unlinked as-needed practice counts its authorised incidents (wall-clock local times, bucketed as they are); a routine practice has none.
    /// </summary>
    private static async Task<Dictionary<(Guid, DateOnly), List<RestrictivePracticeUseDto>>> UsesAsync(
        OdipDbContext db, List<RestrictivePractice> practices, List<DateOnly> months, IReadOnlyDictionary<Guid, TimeZoneInfo> zones, Guid? tenantId, CancellationToken ct)
    {
        var result = new Dictionary<(Guid, DateOnly), List<RestrictivePracticeUseDto>>();
        var linked = practices.Where(rp => rp.RelatedMedicationId != null && KindOf(rp) == RestrictivePracticeUseKind.Prn).ToList();
        var unlinked = practices.Where(rp => rp.RelatedMedicationId == null && rp.UseKind == RestrictivePracticeUseKind.Prn).ToList();
        if ((linked.Count == 0 && unlinked.Count == 0) || months.Count == 0) return result;

        var lowLocal = months.Min().ToDateTime(TimeOnly.MinValue);
        var highLocal = months.Max().AddMonths(1).ToDateTime(TimeOnly.MinValue);
        void Add(Guid practiceId, DateTime local, Guid? incidentId, Guid? doseId)
        {
            var key = (practiceId, new DateOnly(local.Year, local.Month, 1));
            if (!result.TryGetValue(key, out var list)) result[key] = list = [];
            list.Add(new RestrictivePracticeUseDto { LocalDateTime = DateTime.SpecifyKind(local, DateTimeKind.Unspecified), IncidentReportId = incidentId, MedicationAdministrationId = doseId });
        }

        if (unlinked.Count > 0)
        {
            var ids = unlinked.Select(rp => rp.Id).ToList();
            var incidents = await db.IncidentReports.AsNoTracking()
                .Where(i => i.IsActive && i.IsRestrictivePracticeAuthorised == true && ids.Contains(i.RestrictivePracticeId!.Value) && (tenantId == null || i.TenantId == tenantId)
                    && i.IncidentDateTime >= lowLocal && i.IncidentDateTime < highLocal)
                .Select(i => new { i.Id, PracticeId = i.RestrictivePracticeId!.Value, i.IncidentDateTime }).ToListAsync(ct);
            foreach (var i in incidents) Add(i.PracticeId, i.IncidentDateTime, i.Id, null);
        }

        if (linked.Count > 0)
        {
            // Each practice's zone may differ: take the widest UTC window over every zone in play, a day either side, then bucket exactly in memory.
            var zonesInPlay = linked.Select(rp => zones[rp.TenantId]).Distinct().ToList();
            var lowUtc = zonesInPlay.Min(z => ProviderLocalTime.LocalToUtc(lowLocal, z)).AddDays(-1);
            var highUtc = zonesInPlay.Max(z => ProviderLocalTime.LocalToUtc(highLocal, z)).AddDays(1);
            var medIds = linked.Select(rp => rp.RelatedMedicationId!.Value).Distinct().ToList();
            var doses = await db.MedicationAdministrations.AsNoTracking()
                .Where(d => d.Status == MedicationAdministrationStatus.Administered && d.AdministeredAt != null && medIds.Contains(d.ParticipantMedicationId)
                    && (tenantId == null || d.TenantId == tenantId) && d.AdministeredAt >= lowUtc && d.AdministeredAt < highUtc)
                .Select(d => new { d.Id, d.ParticipantMedicationId, At = d.AdministeredAt!.Value }).ToListAsync(ct);
            foreach (var rp in linked)
                foreach (var d in doses.Where(d => d.ParticipantMedicationId == rp.RelatedMedicationId))
                {
                    var local = ProviderLocalTime.UtcToLocal(ProviderLocalTime.AsUtc(d.At), zones[rp.TenantId]);
                    if (local >= lowLocal && local < highLocal) Add(rp.Id, local, null, d.Id);
                }
        }

        foreach (var list in result.Values) list.Sort((a, b) => a.LocalDateTime.CompareTo(b.LocalDateTime));
        return result;
    }
}
