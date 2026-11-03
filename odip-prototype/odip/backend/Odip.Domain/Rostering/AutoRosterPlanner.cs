using System.Globalization;
using Odip.Domain.Enums;
using Odip.Domain.Rostering.Services;

namespace Odip.Domain.Rostering;

/// <summary>What the planner asks about a worker on a shift (R7, D8). The Infrastructure adapter answers from the real roster rules; the planner itself does no I/O.</summary>
public interface IAutoRosterOracle
{
    /// <summary>Why the probe's worker cannot take it (the L5 "away" test: leave, booked, excluded, any Blocking finding), null when they can.</summary>
    string? Away(Shift probe);

    /// <summary>Every finding for the probe, judged as a coordinator would (double-booking is Blocking).</summary>
    List<RosterFinding> Check(Shift probe);

    /// <summary>True when the apply gate would refuse these findings with no override reason.</summary>
    bool NeedsOverride(IReadOnlyList<RosterFinding> findings);

    /// <summary>The probe is placed: later checks see its worker as booked.</summary>
    void Book(Shift probe);
}

/// <summary>A person in the candidate pool, with the goal and the hours already rostered this week.</summary>
public sealed record AutoRosterWorker(Guid Id, string Name, decimal Goal, bool GoalIsDefault, decimal RosteredHours);

public sealed record AutoRosterInput(
    IReadOnlyList<Shift> OpenShifts,
    IReadOnlyList<AutoRosterWorker> Pool,
    IReadOnlyDictionary<Guid, Guid> RegularByPattern,
    IReadOnlyDictionary<(Guid UserId, Guid ParticipantId), (CompatibilityLevel Level, int Rank)> Compatibility,
    IReadOnlySet<Guid> NotReadyParticipants);

public sealed record AutoRosterAlternate(Guid StaffId, AutoRosterPick Pick, int Rank);

public sealed record AutoRosterPlacement(Guid ShiftId, Guid StaffId, AutoRosterPick Pick, int Rank, bool UnderGoal, string? RegularAway,
    IReadOnlyList<RosterFinding> Warnings, IReadOnlyList<AutoRosterAlternate> Alternates);

public enum AutoRosterRecommendationKind { OverGoal, Soft, Other }

public sealed record AutoRosterRecommendation(AutoRosterRecommendationKind Kind, Guid? StaffId, string Text);

public sealed record AutoRosterUncovered(Guid ShiftId, UncoveredReason Reason, IReadOnlyList<AutoRosterRecommendation> Recommendations);

public sealed record AutoRosterPlan(IReadOnlyList<AutoRosterPlacement> Placements, IReadOnlyList<AutoRosterUncovered> Uncovered);

/// <summary>
/// R7 auto-roster: a deterministic greedy fill of a week's open shifts (D8). Pass 1 gives each shift to its live regular when they are free; pass 2 fills the rest, most-constrained shift
/// first, with the first eligible person by (tier, under goal, rank, load, name, id). Every sort is total and no dictionary order is read, so the same input always gives the same plan.
/// </summary>
public static class AutoRosterPlanner
{
    private const int MaxAlternates = 3, MaxRecommendations = 3;

    private static readonly HashSet<string> HoursCodes = [RosterConflictService.OverHours, RosterConflictService.CasualFortnightHours];

    private static readonly HashSet<string> SoftRefusalCodes =
    [
        RosterConflictService.StaffLeavePending, RosterConflictService.StaffRecurringPending, RosterConflictService.CompetencyMissing,
        RosterConflictService.CredentialExpired, RosterConflictService.WscMissing,
    ];

    private enum Kind { Eligible, Excluded, Away, Hours, Override, Soft, Other }

    private sealed record Candidate(AutoRosterWorker Worker, CompatibilityLevel? Level, int Tier, int Rank, Kind Kind, List<RosterFinding> Findings, List<RosterFinding> Hard);

    // shortcut: every shift is probed against every pool member twice (count, then place), about shifts x pool x 2 oracle calls; add a per-shift cache if a week of 500 shifts runs slow.
    public static AutoRosterPlan Plan(AutoRosterInput input, IAutoRosterOracle oracle)
    {
        var pool = input.Pool.OrderBy(w => w.Id).ToList();
        var byId = pool.ToDictionary(w => w.Id);
        var draft = pool.ToDictionary(w => w.Id, _ => 0m);
        var placements = new List<AutoRosterPlacement>();
        var uncovered = new List<AutoRosterUncovered>();
        var shifts = input.OpenShifts.OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ThenBy(s => s.Id).ToList();

        Candidate Evaluate(Shift shift, AutoRosterWorker worker)
        {
            var (level, rank) = input.Compatibility.TryGetValue((worker.Id, shift.ParticipantId), out var row) ? (row.Level, row.Rank) : (CompatibilityLevel.Allowed, 0);
            var (tier, normalRank, _) = CompatibilityOrder.Key(level, rank, null);
            Candidate Result(Kind kind, List<RosterFinding>? all = null, List<RosterFinding>? blocking = null) => new(worker, level, tier, normalRank, kind, all ?? [], blocking ?? []);
            var probe = Probe(shift, worker.Id);
            if (oracle.Away(probe) is not null) return Result(Kind.Away);
            if (tier == 4) return Result(Kind.Excluded); // a free No-listed person is never placed, but counts for OnlyNoStaff
            var findings = oracle.Check(probe);
            var hard = findings.Where(f => !AutoRosterRules.SoftCodes.Contains(f.Code)).ToList();
            if (hard.Count == 0) return Result(oracle.NeedsOverride(findings) ? Kind.Override : Kind.Eligible, findings, hard);
            return Result(hard.All(f => HoursCodes.Contains(f.Code)) ? Kind.Hours : hard.All(f => SoftRefusalCodes.Contains(f.Code)) ? Kind.Soft : Kind.Other, findings, hard);
        }

        decimal HoursOf(AutoRosterWorker w) => w.RosteredHours + draft[w.Id];
        bool UnderGoal(AutoRosterWorker w, Shift s) => HoursOf(w) + s.DurationHours <= w.Goal;
        decimal Load(AutoRosterWorker w) => w.Goal <= 0 ? (HoursOf(w) > 0 ? decimal.MaxValue : 0m) : HoursOf(w) / w.Goal;
        IOrderedEnumerable<Candidate> Ordered(IEnumerable<Candidate> candidates, Shift s) => candidates
            .OrderBy(c => c.Tier).ThenBy(c => UnderGoal(c.Worker, s) ? 0 : 1).ThenBy(c => c.Rank).ThenBy(c => Load(c.Worker))
            .ThenBy(c => c.Worker.Name, StringComparer.OrdinalIgnoreCase).ThenBy(c => c.Worker.Id);

        void Place(Shift shift, Candidate c, AutoRosterPick pick, string? regularAway, IReadOnlyList<RosterFinding> warnings, List<Candidate> alternates)
        {
            var under = UnderGoal(c.Worker, shift);
            oracle.Book(Probe(shift, c.Worker.Id));
            draft[c.Worker.Id] += shift.DurationHours;
            placements.Add(new AutoRosterPlacement(shift.Id, c.Worker.Id, pick, c.Rank == int.MaxValue ? 0 : c.Rank, under, regularAway,
                warnings.OrderBy(f => f.Code, StringComparer.Ordinal).ThenBy(f => f.Message, StringComparer.Ordinal).ToList(),
                alternates.Select(a => new AutoRosterAlternate(a.Worker.Id, PickOf(a.Level), a.Rank == int.MaxValue ? 0 : a.Rank)).ToList()));
        }

        // Pass 1: the regular keeps their shift when free; hours never displace them. A regular the gate would stop goes to the uncovered list with the reason.
        var rest = new List<(Shift Shift, string? RegularAway)>();
        foreach (var shift in shifts)
        {
            if (input.NotReadyParticipants.Contains(shift.ParticipantId))
            {
                uncovered.Add(new AutoRosterUncovered(shift.Id, UncoveredReason.ParticipantNotReady, []));
                continue;
            }

            if (shift.ShiftPatternId is { } patternId && input.RegularByPattern.TryGetValue(patternId, out var regularId) && byId.TryGetValue(regularId, out var regular))
            {
                var probe = Probe(shift, regular.Id);
                if (oracle.Away(probe) is { } away) { rest.Add((shift, $"{regular.Name} is away: {away}")); continue; }
                var findings = oracle.Check(probe);
                if (oracle.NeedsOverride(findings))
                {
                    var why = string.Join(" ", findings.Where(f => f.Severity == RosterFindingSeverity.Blocking || f.RequiresReason).OrderBy(f => f.Code, StringComparer.Ordinal).ThenBy(f => f.Message, StringComparer.Ordinal).Select(f => f.Message));
                    uncovered.Add(new AutoRosterUncovered(shift.Id, UncoveredReason.NeedsOverride, [new(AutoRosterRecommendationKind.Soft, regular.Id, $"Regular {regular.Name}: {why}")]));
                    continue;
                }

                // OPEN-4: a pending leave or recurring request disqualifies the regular; pass 2 may place someone else.
                if (findings.FirstOrDefault(f => f.Code is RosterConflictService.StaffLeavePending or RosterConflictService.StaffRecurringPending) is { } pending)
                {
                    rest.Add((shift, $"{regular.Name} has a pending request: {pending.Message}"));
                    continue;
                }

                var (level, rank) = input.Compatibility.TryGetValue((regular.Id, shift.ParticipantId), out var row) ? (row.Level, row.Rank) : (CompatibilityLevel.Allowed, 0);
                Place(shift, new Candidate(regular, level, CompatibilityOrder.Tier(level), 0, Kind.Eligible, findings, []), AutoRosterPick.Regular, null, findings, []);
                continue;
            }

            rest.Add((shift, null));
        }

        // Pass 2: the shift fewest people can take first, so a scarce person is not spent on a shift others could cover.
        var counted = rest.Select(r => (r.Shift, r.RegularAway, Count: pool.Count(w => Evaluate(r.Shift, w).Kind == Kind.Eligible)))
            .OrderBy(r => r.Count).ThenBy(r => r.Shift.ServiceDate).ThenBy(r => r.Shift.StartTime).ThenBy(r => r.Shift.Id).ToList();
        foreach (var (shift, regularAway, _) in counted)
        {
            var all = pool.Select(w => Evaluate(shift, w)).ToList();
            var eligible = Ordered(all.Where(c => c.Kind == Kind.Eligible), shift).ToList();
            if (eligible.Count > 0)
            {
                Place(shift, eligible[0], PickOf(eligible[0].Level), regularAway, eligible[0].Findings, eligible.Skip(1).Take(MaxAlternates).ToList());
                continue;
            }

            uncovered.Add(new AutoRosterUncovered(shift.Id, ReasonFor(pool.Count, all), RecommendationsFor(shift, all, Ordered, HoursOf)));
        }

        // shifts is already in (date, start, id) order, so a shift's index is its sort key.
        var position = shifts.Select((s, i) => (s.Id, i)).ToDictionary(x => x.Id, x => x.i);
        return new AutoRosterPlan(placements.OrderBy(p => position[p.ShiftId]).ToList(), uncovered.OrderBy(u => position[u.ShiftId]).ToList());
    }

    private static AutoRosterPick PickOf(CompatibilityLevel? level) => level switch
    {
        CompatibilityLevel.Preferred => AutoRosterPick.Preferred,
        CompatibilityLevel.Backup => AutoRosterPick.Backup,
        CompatibilityLevel.Emergency => AutoRosterPick.Emergency,
        _ => AutoRosterPick.Allowed,
    };

    /// <summary>D10: the first reason that matches. A candidate is "refused" by one of the kinds below; an excluded person is never offered.</summary>
    private static UncoveredReason ReasonFor(int poolSize, List<Candidate> all)
    {
        if (poolSize == 0) return UncoveredReason.NoStaff;
        if (all.Any(c => c.Kind == Kind.Excluded)) return UncoveredReason.OnlyNoStaff;
        var offered = all;
        if (offered.All(c => c.Kind == Kind.Hours)) return UncoveredReason.HoursCapReached;
        if (offered.All(c => c.Kind is Kind.Hours or Kind.Override) && offered.Any(c => c.Kind == Kind.Override)) return UncoveredReason.NeedsOverride;
        return UncoveredReason.NobodyFree;
    }

    /// <summary>D10: display-only. The best person who is only over hours, the best who is only held by pending leave or a competency, else a plain pointer.</summary>
    private static List<AutoRosterRecommendation> RecommendationsFor(Shift shift, List<Candidate> all,
        Func<IEnumerable<Candidate>, Shift, IOrderedEnumerable<Candidate>> ordered, Func<AutoRosterWorker, decimal> hoursOf)
    {
        var recs = new List<AutoRosterRecommendation>();
        if (ordered(all.Where(c => c.Kind == Kind.Hours), shift).FirstOrDefault() is { } over)
        {
            var takes = (hoursOf(over.Worker) + shift.DurationHours).ToString("0.##", CultureInfo.InvariantCulture);
            recs.Add(new(AutoRosterRecommendationKind.OverGoal, over.Worker.Id, $"Ask {over.Worker.Name}: takes them to {takes} h (goal {over.Worker.Goal.ToString("0.##", CultureInfo.InvariantCulture)} h)"));
        }

        if (ordered(all.Where(c => c.Kind == Kind.Soft), shift).FirstOrDefault() is { } soft)
            recs.Add(new(AutoRosterRecommendationKind.Soft, soft.Worker.Id, $"{soft.Worker.Name}: {soft.Hard.OrderBy(f => f.Code, StringComparer.Ordinal).ThenBy(f => f.Message, StringComparer.Ordinal).First().Message}"));

        if (recs.Count == 0)
            recs.Add(new(AutoRosterRecommendationKind.Other, null, "No one on the list can take this. Add a casual to the participant's list, or move the shift."));
        return recs.Take(MaxRecommendations).ToList();
    }

    /// <summary>The shift as it would be with the worker on it: what the roster rules judge. Never the tracked row.</summary>
    private static Shift Probe(Shift shift, Guid userId) => new()
    {
        Id = shift.Id, ParticipantId = shift.ParticipantId, UserId = userId,
        ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
        EndsNextDay = shift.EndsNextDay, Ratio = shift.Ratio, NightType = shift.NightType,
    };
}
