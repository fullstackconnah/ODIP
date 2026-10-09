using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>What a generation did: shifts made, days that already had one, and days a plan skipped for a public holiday.</summary>
public sealed record ShiftGeneration(int Created, int AlreadyThere, int HolidaysSkipped, DateOnly? FirstDate, DateOnly? LastDate, IReadOnlyList<Shift>? Made = null)
{
    public static readonly ShiftGeneration None = new(0, 0, 0, null, null);

    /// <summary>The shifts this generation made (the same objects it added to the context), for a caller that wants to say what they do to a budget. Empty when none were made.</summary>
    public IReadOnlyList<Shift> MadeShifts => Made ?? Array.Empty<Shift>();

    /// <summary>The days that got no shift because there was no need for one: it was already there, or a plan skipped the day.</summary>
    public int Skipped => AlreadyThere + HolidaysSkipped;
}

/// <summary>
/// The one place a <see cref="ShiftPattern"/> becomes <see cref="Shift"/> rows, shared by the Generate button, the approval of an agreement revision and the daily top-up. A shift is made
/// for each day the pattern covers in the window that has no shift of that pattern yet (whatever became of it: a cancelled shift is not made again, but a DELETED one is not remembered here: see
/// <see cref="ShiftPattern.GeneratedThrough"/>), as a Draft that copies the pattern's
/// times, ratio, night type, worker (none for a pattern an agreement made) and what it asks of a worker. A pattern an agreement revision made also leaves out the days that revision's plan
/// skips for a public holiday (its stored pricing marks them), so the roster does not ask for a shift the plan said would not happen.
/// <para>
/// Each generation also records how far it has reached on the pattern (<see cref="ShiftPattern.GeneratedThrough"/>, the end of the window held to the pattern's end, never moved back). The daily
/// top-up starts from the day after it, so it extends the roster and never fills a hole: a shift a coordinator deleted stays deleted, and a Generate over its day makes it again.
/// </para>
/// <para>
/// Safe to run twice and to run at once: <see cref="GenerateAsync"/> takes the participant's <see cref="RosterGenerationLock"/> first (PostgreSQL), reads the patterns again, looks for
/// what is there and adds what is not. Nothing here is checked for conflicts and nothing is refused for a date in the past: the callers decide the window and whether the participant may be
/// rostered at all (<see cref="IRosterPlacementGate"/>).
/// </para>
/// </summary>
public sealed class RosterShiftGenerator
{
    private readonly ShiftPatternExpander _expander = new();

    public RosterShiftGenerator(TimeSpan? lockWait = null) => LockWait = lockWait ?? RosterGenerationLock.DefaultWait;

    /// <summary>How long a generation (and an approval, which takes the same lock through this generator) waits for another one of the same participant: <see cref="RosterGenerationLock.DefaultWait"/>, shorter only in a test.</summary>
    public TimeSpan LockWait { get; }

    /// <summary>
    /// Makes the shifts of <paramref name="patternIds"/> (patterns of <paramref name="participantId"/>) over [from, to] and saves them, holding the participant's generation lock. The patterns
    /// are read again once the lock is held: an approval that ended a pattern a moment ago is seen, and its shifts are not made. <paramref name="onlyWhenContiguous"/> is for a person's own window (the
    /// Generate button): one that starts after a gap past what was already covered does not move <see cref="ShiftPattern.GeneratedThrough"/>, so the top-up can still fill the gap. When nothing was covered yet
    /// (<see cref="ShiftPattern.GeneratedThrough"/> is null) the gap is measured from the first day the top-up would make, the provider's <paramref name="providerToday"/> or the pattern's start when that is later; without it the window is not recorded.
    /// </summary>
    public async Task<ShiftGeneration> GenerateAsync(OdipDbContext db, Guid participantId, IReadOnlyCollection<Guid> patternIds, DateOnly from, DateOnly to, CancellationToken ct, bool onlyWhenContiguous = false, DateOnly? providerToday = null)
    {
        if (patternIds.Count == 0) return ShiftGeneration.None;

        await using var held = await RosterGenerationLock.AcquireAsync(db, participantId, ct, LockWait);
        var ids = patternIds.ToList();
        // Tracked: how far generation has reached is kept on the pattern and saved with the shifts.
        var patterns = await db.ShiftPatterns.Where(p => ids.Contains(p.Id) && p.ParticipantId == participantId).ToListAsync(ct);
        var result = await AddAsync(db, patterns, from, to, ct, onlyWhenContiguous, providerToday);
        await db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return result;
    }

    /// <summary>
    /// Adds the shifts of <paramref name="patterns"/> over [from, to] to <paramref name="db"/> and saves nothing: the caller saves them with its own work, in a transaction that holds the
    /// participant's <see cref="RosterGenerationLock"/> (an approval, whose patterns are not saved yet and so have no shifts to look for).
    /// </summary>
    public async Task<ShiftGeneration> AddAsync(OdipDbContext db, IReadOnlyCollection<ShiftPattern> patterns, DateOnly from, DateOnly to, CancellationToken ct, bool onlyWhenContiguous = false, DateOnly? providerToday = null)
    {
        foreach (var pattern in patterns) Cover(pattern, from, to, onlyWhenContiguous, providerToday);

        var occurrences = patterns.Select(pattern => (Pattern: pattern, Dates: _expander.Occurrences(pattern, from, to))).Where(x => x.Dates.Count > 0).ToList();
        if (occurrences.Count == 0) return ShiftGeneration.None;

        var existing = await ExistingAsync(db, occurrences.Where(x => db.Entry(x.Pattern).State != EntityState.Added).Select(x => x.Pattern.Id).ToList(),
            occurrences.SelectMany(x => x.Dates).Min(), occurrences.SelectMany(x => x.Dates).Max(), ct);
        var skippedDays = await SkippedHolidaysAsync(db, occurrences.Select(x => x.Pattern), ct);

        int created = 0, alreadyThere = 0, holidays = 0;
        DateOnly? first = null, last = null;
        var made = new List<Shift>();
        foreach (var (pattern, dates) in occurrences)
        {
            foreach (var date in dates)
            {
                if (existing.Contains((pattern.Id, date))) { alreadyThere++; continue; }
                if (pattern.SourceDraftId is { } draftId && pattern.SourceBlockKey is { } blockKey && skippedDays.TryGetValue(draftId, out var skipped) && skipped.Contains((blockKey, date))) { holidays++; continue; }

                var shift = new Shift
                {
                    Id = Guid.NewGuid(), TenantId = pattern.TenantId, ParticipantId = pattern.ParticipantId, UserId = pattern.DefaultUserId,
                    ServiceDate = date, StartTime = pattern.StartTime, EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay,
                    Ratio = pattern.Ratio, NightType = pattern.NightType, Status = ShiftStatus.Draft, ShiftPatternId = pattern.Id,
                    RequirementsJson = pattern.RequirementsJson,
                };
                db.Shifts.Add(shift);
                made.Add(shift);
                created++;
                if (first is null || date < first) first = date;
                if (last is null || date > last) last = date;
            }
        }

        return new ShiftGeneration(created, alreadyThere, holidays, first, last, made);
    }

    /// <summary>
    /// Records how far generation has reached for the pattern: the end of the window, held to the pattern's own end, never moved back. Nothing is recorded when the pattern is switched off, when the window lay outside it, or (a
    /// person's own window) when it starts after a gap past what was covered: the top-up starts from the day after what is recorded, so that gap would never be filled (<see cref="JoinsOn"/>).
    /// </summary>
    private static void Cover(ShiftPattern pattern, DateOnly from, DateOnly to, bool onlyWhenContiguous, DateOnly? providerToday)
    {
        if (!pattern.IsActive) return;                                                           // a pattern that is switched off covers nothing (it makes no shift)
        var covered = pattern.EffectiveTo is { } end && end < to ? end : to;
        if (covered < from || covered < pattern.EffectiveFrom) return;
        if (onlyWhenContiguous && !JoinsOn(pattern, from, providerToday)) return;
        if (pattern.GeneratedThrough is null || covered > pattern.GeneratedThrough) pattern.GeneratedThrough = covered;
    }

    /// <summary>
    /// Whether a person's own window starts where the top-up would carry on from, so that recording it leaves no gap behind it. With something recorded, that is the day after it, or earlier. With NOTHING recorded
    /// yet (null: the normal state of a pattern whose participant was not active when its revision was approved, which got patterns and no shifts) the top-up's first day is the provider's today, or the pattern's own
    /// start when that is later (it has no days before that): a window that starts after it would hide the days between from the top-up for good. Without the provider's today nothing can be said, so it does not join.
    /// </summary>
    private static bool JoinsOn(ShiftPattern pattern, DateOnly from, DateOnly? providerToday)
    {
        if (pattern.GeneratedThrough is { } through) return from <= through.AddDays(1);
        if (providerToday is not { } today) return false;
        return from <= (pattern.EffectiveFrom > today ? pattern.EffectiveFrom : today);
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
