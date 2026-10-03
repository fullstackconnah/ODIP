using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>What a generation did: shifts made, days that already had one, and days a plan skipped for a public holiday.</summary>
public sealed record ShiftGeneration(int Created, int AlreadyThere, int HolidaysSkipped, DateOnly? FirstDate, DateOnly? LastDate)
{
    public static readonly ShiftGeneration None = new(0, 0, 0, null, null);

    /// <summary>The days that got no shift because there was no need for one: it was already there, or a plan skipped the day.</summary>
    public int Skipped => AlreadyThere + HolidaysSkipped;
}

/// <summary>
/// The one place a <see cref="ShiftPattern"/> becomes <see cref="Shift"/> rows, shared by the Generate button, the approval of an agreement revision and the daily top-up. A shift is made
/// for each day the pattern covers in the window that has no shift of that pattern yet (whatever became of it: a cancelled shift is not made again), as a Draft that copies the pattern's
/// times, ratio, night type, worker (none for a pattern an agreement made) and what it asks of a worker. A pattern an agreement revision made also leaves out the days that revision's plan
/// skips for a public holiday (its stored pricing marks them), so the roster does not ask for a shift the plan said would not happen.
/// <para>
/// Safe to run twice and to run at once: <see cref="GenerateAsync"/> takes the participant's <see cref="RosterGenerationLock"/> first (PostgreSQL), reads the patterns again, looks for
/// what is there and adds what is not. Nothing here is checked for conflicts and nothing is refused for a date in the past: the callers decide the window and whether the participant may be
/// rostered at all (<see cref="IRosterPlacementGate"/>).
/// </para>
/// </summary>
public sealed class RosterShiftGenerator
{
    private readonly ShiftPatternExpander _expander = new();

    /// <summary>
    /// Makes the shifts of <paramref name="patternIds"/> (patterns of <paramref name="participantId"/>) over [from, to] and saves them, holding the participant's generation lock. The patterns
    /// are read again once the lock is held: an approval that ended a pattern a moment ago is seen, and its shifts are not made.
    /// </summary>
    public async Task<ShiftGeneration> GenerateAsync(OdipDbContext db, Guid participantId, IReadOnlyCollection<Guid> patternIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (patternIds.Count == 0) return ShiftGeneration.None;

        await using var held = await RosterGenerationLock.AcquireAsync(db, participantId, ct);
        var ids = patternIds.ToList();
        var patterns = await db.ShiftPatterns.AsNoTracking().Where(p => ids.Contains(p.Id) && p.ParticipantId == participantId).ToListAsync(ct);
        var result = await AddAsync(db, patterns, from, to, ct);
        if (result.Created > 0) await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return result;
    }

    /// <summary>
    /// Adds the shifts of <paramref name="patterns"/> over [from, to] to <paramref name="db"/> and saves nothing: the caller saves them with its own work, in a transaction that holds the
    /// participant's <see cref="RosterGenerationLock"/> (an approval, whose patterns are not saved yet and so have no shifts to look for).
    /// </summary>
    public async Task<ShiftGeneration> AddAsync(OdipDbContext db, IReadOnlyCollection<ShiftPattern> patterns, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var occurrences = patterns.Select(pattern => (Pattern: pattern, Dates: _expander.Occurrences(pattern, from, to))).Where(x => x.Dates.Count > 0).ToList();
        if (occurrences.Count == 0) return ShiftGeneration.None;

        var existing = await ExistingAsync(db, occurrences.Where(x => db.Entry(x.Pattern).State != EntityState.Added).Select(x => x.Pattern.Id).ToList(),
            occurrences.SelectMany(x => x.Dates).Min(), occurrences.SelectMany(x => x.Dates).Max(), ct);
        var skippedDays = await SkippedHolidaysAsync(db, occurrences.Select(x => x.Pattern), ct);

        int created = 0, alreadyThere = 0, holidays = 0;
        DateOnly? first = null, last = null;
        foreach (var (pattern, dates) in occurrences)
        {
            foreach (var date in dates)
            {
                if (existing.Contains((pattern.Id, date))) { alreadyThere++; continue; }
                if (pattern.SourceDraftId is { } draftId && pattern.SourceBlockKey is { } blockKey && skippedDays.TryGetValue(draftId, out var skipped) && skipped.Contains((blockKey, date))) { holidays++; continue; }

                db.Shifts.Add(new Shift
                {
                    Id = Guid.NewGuid(), TenantId = pattern.TenantId, ParticipantId = pattern.ParticipantId, UserId = pattern.DefaultUserId,
                    ServiceDate = date, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay,
                    Ratio = pattern.Ratio, NightType = pattern.NightType, Status = ShiftStatus.Draft, ShiftPatternId = pattern.Id,
                    RequirementsJson = pattern.RequirementsJson,
                });
                created++;
                if (first is null || date < first) first = date;
                if (last is null || date > last) last = date;
            }
        }

        return new ShiftGeneration(created, alreadyThere, holidays, first, last);
    }

    /// <summary>The (pattern, day) pairs that already carry a shift of the pattern, of any status, in one query.</summary>
    private static async Task<HashSet<(Guid PatternId, DateOnly Date)>> ExistingAsync(OdipDbContext db, List<Guid> patternIds, DateOnly first, DateOnly last, CancellationToken ct)
    {
        if (patternIds.Count == 0) return new();
        var rows = await db.Shifts.AsNoTracking()
            .Where(s => s.ShiftPatternId != null && patternIds.Contains(s.ShiftPatternId.Value) && s.ServiceDate >= first && s.ServiceDate <= last)
            .Select(s => new { s.ShiftPatternId, s.ServiceDate }).ToListAsync(ct);
        return rows.Select(r => (r.ShiftPatternId!.Value, r.ServiceDate)).ToHashSet();
    }

    /// <summary>For each agreement revision the patterns come from: the (block, day) pairs its stored pricing says were skipped for a public holiday.</summary>
    private static async Task<Dictionary<Guid, HashSet<(string BlockKey, DateOnly Date)>>> SkippedHolidaysAsync(OdipDbContext db, IEnumerable<ShiftPattern> patterns, CancellationToken ct)
    {
        var draftIds = patterns.Where(p => p.SourceDraftId is not null && p.SourceBlockKey is not null).Select(p => p.SourceDraftId!.Value).Distinct().ToList();
        var skipped = new Dictionary<Guid, HashSet<(string, DateOnly)>>();
        if (draftIds.Count == 0) return skipped;

        var stored = await db.ServiceAgreementDrafts.AsNoTracking().Where(d => draftIds.Contains(d.Id)).Select(d => new { d.Id, d.PricingJson }).ToListAsync(ct);
        foreach (var draft in stored)
            skipped[draft.Id] = DraftJson.ReadQuote(draft.PricingJson)?.HolidayOccurrences.Where(h => h.Skipped).Select(h => (h.BlockId, h.Date)).ToHashSet() ?? new();
        return skipped;
    }
}
