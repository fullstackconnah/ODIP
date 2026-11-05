using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Retention;

/// <summary>
/// The 7-year retention clock (spec 2026-10-14, data export and retention). A participant's record is due for purge 7 years after the LATER of
/// the day they were archived (<see cref="Participant.RetentionStartsOn"/>) and their last service, claim, invoice, trip or incident, so a record
/// made after archive for older services pushes the date out. The nightly scan, the due list, the purge's confirm check and its in-transaction
/// re-check all read it through <see cref="EffectiveStartsAsync"/> and <see cref="IsDue"/>, so they cannot disagree.
/// </summary>
public static class RetentionClock
{
    public const int Years = 7;

    /// <summary>Archiving starts the clock on the provider-local date; restoring (or finalising a draft as active) stops it.</summary>
    public static void OnActiveChanged(Participant p, bool active, DateOnly? providerToday = null)
    {
        p.RetentionStartsOn = active ? null : providerToday ?? throw new ArgumentNullException(nameof(providerToday), "Archiving needs the provider's date.");
        p.RetentionStartEstimated = false;
    }

    /// <summary>The provider-local date for an organisation, the one "today" the clock and the due list use.</summary>
    public static async Task<DateOnly> TodayAsync(OdipDbContext db, Guid tenantId, TimeProvider clock, CancellationToken ct) =>
        ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone);

    public sealed record RetentionStatus(DateOnly Start, DateOnly DueOn, bool Estimated, bool Due);

    /// <summary>One archived participant's clock as of the provider's today, or null when they have none (not archived, a draft, or no start). The one answer the due list, the confirm check and the in-transaction re-check share.</summary>
    public static async Task<RetentionStatus?> StatusAsync(OdipDbContext db, Guid tenantId, Guid participantId, TimeProvider clock, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(clock.GetUtcNow().UtcDateTime, zone);
        var starts = await EffectiveStartsAsync(db, tenantId, zone, participantId, ct);
        if (!starts.TryGetValue(participantId, out var start)) return null;
        var stored = await db.Set<Participant>().IgnoreQueryFilters([TenantFilter.Name]).Where(p => p.TenantId == tenantId && p.Id == participantId)
            .Select(p => new { p.RetentionStartsOn, p.RetentionStartEstimated }).FirstAsync(ct);
        return new RetentionStatus(start, DueOn(start), stored.RetentionStartEstimated && stored.RetentionStartsOn == start, IsDue(start, today));
    }

    /// <summary>A 29 Feb start comes due on 28 Feb seven years on (.NET's AddYears).</summary>
    public static DateOnly DueOn(DateOnly effectiveStart) => effectiveStart.AddYears(Years);

    public static bool IsDue(DateOnly effectiveStart, DateOnly providerToday) => DueOn(effectiveStart) <= providerToday;

    /// <summary>
    /// The effective start of each archived (not draft) participant of ONE organisation that has a clock, or of just <paramref name="onlyParticipantId"/>.
    /// Every query names <paramref name="tenantId"/> itself, so it is right on a context with the tenant filter off.
    /// shortcut: one grouped query per source for the whole organisation, nightly; store the pushed date if a very large tenant makes this slow.
    /// </summary>
    public static async Task<Dictionary<Guid, DateOnly>> EffectiveStartsAsync(OdipDbContext db, Guid tenantId, TimeZoneInfo zone, Guid? onlyParticipantId, CancellationToken ct)
    {
        IQueryable<E> Q<E>() where E : class => db.Set<E>().IgnoreQueryFilters([TenantFilter.Name]);
        var archived = Q<Participant>().Where(p => p.TenantId == tenantId && !p.IsActive && !p.IsDraft && p.RetentionStartsOn != null);
        if (onlyParticipantId is { } one) archived = archived.Where(p => p.Id == one);

        var starts = (await archived.Select(p => new { p.Id, p.RetentionStartsOn }).ToListAsync(ct)).ToDictionary(p => p.Id, p => p.RetentionStartsOn!.Value);
        if (starts.Count == 0) return starts;

        void Push(Guid? id, DateOnly? date)
        {
            if (id is { } key && date is { } d && starts.TryGetValue(key, out var current) && d > current) starts[key] = d;
        }
        DateOnly LocalDate(DateTime utc) => DateOnly.FromDateTime(ProviderLocalTime.UtcToLocal(utc, zone));

        foreach (var r in await Q<Shift>().Where(s => s.TenantId == tenantId && archived.Any(a => a.Id == s.ParticipantId))
            .GroupBy(s => s.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(s => s.ServiceDate) }).ToListAsync(ct))
            Push(r.Id, r.Last);

        // A claim line reaches its participant through its claim, its booking or its shift (a group claim has no participant of its own).
        foreach (var r in await Q<ClaimLineItem>().Join(Q<TripClaim>().Where(c => c.TenantId == tenantId && c.ParticipantId != null && archived.Any(a => a.Id == c.ParticipantId)),
                l => l.TripClaimId, c => c.Id, (l, c) => new { c.ParticipantId, l.SupportsDeliveredTo })
            .GroupBy(x => x.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(x => x.SupportsDeliveredTo) }).ToListAsync(ct))
            Push(r.Id, r.Last);
        foreach (var r in await Q<ClaimLineItem>().Where(l => l.ParticipantBookingId != null).Join(Q<ParticipantBooking>().Where(b => archived.Any(a => a.Id == b.ParticipantId)),
                l => l.ParticipantBookingId!.Value, b => b.Id, (l, b) => new { b.ParticipantId, l.SupportsDeliveredTo })
            .GroupBy(x => x.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(x => x.SupportsDeliveredTo) }).ToListAsync(ct))
            Push(r.Id, r.Last);
        foreach (var r in await Q<ClaimLineItem>().Where(l => l.ShiftId != null).Join(Q<Shift>().Where(s => s.TenantId == tenantId && archived.Any(a => a.Id == s.ParticipantId)),
                l => l.ShiftId!.Value, s => s.Id, (l, s) => new { s.ParticipantId, l.SupportsDeliveredTo })
            .GroupBy(x => x.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(x => x.SupportsDeliveredTo) }).ToListAsync(ct))
            Push(r.Id, r.Last);

        // A claim made after the archive for earlier services still pushes the date out.
        foreach (var r in await Q<TripClaim>().Where(c => c.TenantId == tenantId && c.ParticipantId != null && archived.Any(a => a.Id == c.ParticipantId))
            .GroupBy(c => c.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(c => c.CreatedAt) }).ToListAsync(ct))
            Push(r.Id, LocalDate(r.Last));

        // Complaints about the participant are records too, so one made after the archive pushes the date out.
        foreach (var r in await Q<Complaint>().Where(c => c.TenantId == tenantId && c.ParticipantId != null && archived.Any(a => a.Id == c.ParticipantId))
            .GroupBy(c => c.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(c => c.CreatedAt) }).ToListAsync(ct))
            Push(r.Id, LocalDate(r.Last));

        foreach (var r in await Q<Invoice>().Where(i => i.TenantId == tenantId && archived.Any(a => a.Id == i.ParticipantId))
            .GroupBy(i => i.ParticipantId).Select(g => new { Id = g.Key, Last = g.Max(i => i.IssueDate) }).ToListAsync(ct))
            Push(r.Id, r.Last);

        foreach (var r in await Q<IncidentReport>().Where(i => i.InvolvedParticipantId != null && archived.Any(a => a.Id == i.InvolvedParticipantId))
            .GroupBy(i => i.InvolvedParticipantId).Select(g => new { Id = g.Key, Occurred = g.Max(i => i.IncidentDateTime), Created = g.Max(i => i.CreatedAt) }).ToListAsync(ct))
        {
            Push(r.Id, DateOnly.FromDateTime(r.Occurred)); // stored as entered; one day either way does not matter against seven years
            Push(r.Id, LocalDate(r.Created));
        }

        // A trip's last day, through the participant's bookings. A handful per person, so the end date is worked out here.
        foreach (var r in await Q<ParticipantBooking>().Where(b => archived.Any(a => a.Id == b.ParticipantId))
            .Join(Q<TripInstance>().Where(t => t.TenantId == tenantId), b => b.TripInstanceId, t => t.Id, (b, t) => new { b.ParticipantId, t.StartDate, t.DurationDays }).ToListAsync(ct))
            Push(r.ParticipantId, r.StartDate.AddDays(Math.Max(r.DurationDays - 1, 0)));

        return starts;
    }
}
