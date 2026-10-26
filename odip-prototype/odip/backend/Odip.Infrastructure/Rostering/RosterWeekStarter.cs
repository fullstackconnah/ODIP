using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>What Start rostering did to one week: the shifts it made, the participants it skipped (not ready to receive services) and how many shifts it left open (the regular was away).</summary>
public sealed record StartedWeek(List<Shift> Made, List<Guid> Skipped, int Away);

/// <summary>
/// Start rostering (L4) for one Monday-start week: makes the scheduled shifts of every live agreement pattern of a participant who may be rostered, applies the regular-away rule (L5)
/// and marks the week started. The one body behind <c>POST weeks/{weekStart}/start</c> and the Upcoming shifts import. It neither saves, nor takes the board lock, nor catches:
/// the caller holds the organisation's board lock, saves, commits, and decides what a unique violation or a busy participant lock means.
/// </summary>
public sealed class RosterWeekStarter(RosterShiftGenerator generator, RosterAvailability availability)
{
    /// <summary>Null when the week is already started: nothing is changed.</summary>
    public async Task<StartedWeek?> StartAsync(OdipDbContext db, Guid tenantId, DateOnly monday, Guid? startedBy, DateTime now, CancellationToken ct)
    {
        var end = monday.AddDays(6);
        if ((await StartedWeeks.MondaysAsync(db, tenantId, monday, monday, ct)).Count > 0) return null;

        var participantIds = await AgreementPatternsLiveIn(db, tenantId, monday, end).Select(p => p.ParticipantId).Distinct().OrderBy(id => id).ToListAsync(ct);
        var made = new List<Shift>();
        var skipped = new List<Guid>();
        foreach (var participantId in participantIds)
        {
            if (!(await ParticipantReadiness.CheckAsync(db, participantId, ct)).Allowed) { skipped.Add(participantId); continue; }
            // shortcut: the board lock is held while each participant's lock is waited for in turn (up to LockWait each), so a slow generation makes drag and drop answer busy; take the participant locks without waiting if that bites.
            await using var participantLock = await RosterGenerationLock.AcquireAsync(db, participantId, ct, generator.LockWait);
            // Read again under the lock: an approval that ended or replaced a pattern a moment ago is seen.
            var patterns = await AgreementPatternsLiveIn(db, tenantId, monday, end).Where(p => p.ParticipantId == participantId).ToListAsync(ct);
            made.AddRange((await generator.AddAsync(db, patterns, monday, end, ct)).MadeShifts);
        }

        var away = await availability.MarkRegularsAwayAsync(made, ct);
        db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday, StartedAt = now, StartedByUserId = startedBy });
        return new StartedWeek(made, skipped, away);
    }

    /// <summary>The organisation's agreement patterns (an approved revision made them) that are switched on and live on some day of [start, end]: what Start rostering generates (L4).</summary>
    internal static IQueryable<ShiftPattern> AgreementPatternsLiveIn(OdipDbContext db, Guid tenantId, DateOnly start, DateOnly end) =>
        db.ShiftPatterns.Where(p => p.TenantId == tenantId && p.SourceDraftId != null && p.IsActive && p.EffectiveFrom <= end && (p.EffectiveTo == null || p.EffectiveTo >= start));
}
