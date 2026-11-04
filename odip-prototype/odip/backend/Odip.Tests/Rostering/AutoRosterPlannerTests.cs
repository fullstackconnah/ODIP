using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>R7 auto-roster planner (D8): the ordering key, the regular pass, the away and hours refusals, and that the same input always gives the same plan. Runs on the real roster rules via a Snapshot.</summary>
public class AutoRosterPlannerTests
{
    internal static readonly DateOnly Monday = new(2026, 11, 2);

    internal sealed class World : IAsyncDisposable
    {
        public OdipDbContext Db { get; } = NewDb(Guid.NewGuid().ToString());
        public Participant Mia { get; }
        public List<AutoRosterWorker> Pool { get; } = [];
        public List<Shift> Open { get; } = [];
        public Dictionary<Guid, Guid> Regulars { get; } = [];
        public Dictionary<(Guid, Guid), (CompatibilityLevel, int)> Compat { get; } = [];
        public HashSet<Guid> NotReady { get; } = [];

        public World()
        {
            Mia = Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
        }

        public AutoRosterWorker Worker(string name, decimal goal, decimal rostered = 0, CompatibilityLevel? level = null, int rank = 0)
        {
            var user = Db.Users.Add(new User
            {
                Id = Guid.NewGuid(), TenantId = TenantA, FirstName = name, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
                Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
            }).Entity;
            var worker = new AutoRosterWorker(user.Id, user.FullName, goal, false, rostered);
            Pool.Add(worker);
            if (level is { } l) Compat[(user.Id, Mia.Id)] = (l, rank);
            return worker;
        }

        public Shift Shift(int dayOffset, int from, int to, Guid? patternId = null)
        {
            var shift = new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = Mia.Id, ServiceDate = Monday.AddDays(dayOffset), StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(to, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft, ShiftPatternId = patternId ?? Guid.NewGuid(),
            };
            Open.Add(shift);
            return shift;
        }

        public async Task<AutoRosterPlan> PlanAsync(bool reversePool = false, Func<IAutoRosterOracle, IAutoRosterOracle>? wrap = null, int reach = 3)
        {
            await Db.SaveChangesAsync();
            var availability = new RosterAvailability(Db, new StaffUnavailabilityQuery(Db));
            var snapshot = await availability.LoadAsync(Pool.Select(w => w.Id).ToList(), [Mia.Id], Monday, Monday.AddDays(6), default);
            var pool = reversePool ? Enumerable.Reverse(Pool).ToList() : Pool;
            var open = reversePool ? Enumerable.Reverse(Open).ToList() : Open;
            return AutoRosterPlanner.Plan(new AutoRosterInput(open, pool, Regulars, Compat, NotReady, reach), (wrap ?? (o => o))(new SnapshotAutoRosterOracle(snapshot)));
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    [Fact]
    public async Task Regular_KeepsTheirShiftEvenWhenAnotherWorkerIsPreferred()
    {
        await using var w = new World();
        var regular = w.Worker("Rae", 38);
        w.Worker("Pat", 38, level: CompatibilityLevel.Preferred, rank: 1);
        var shift = w.Shift(0, 9, 13);
        w.Regulars[shift.ShiftPatternId!.Value] = regular.Id;

        var plan = await w.PlanAsync();

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(regular.Id, placed.StaffId);
        Assert.Equal(AutoRosterPick.Regular, placed.Pick);
    }

    /// <summary>The real rules never raise an override finding for a worker the away check passes, so this adds a RequiresReason finding for one worker to reach the NeedsOverride branch.</summary>
    private sealed class NeedsReasonFor(IAutoRosterOracle inner, Guid workerId, string code = "TEST_NEEDS_REASON") : IAutoRosterOracle
    {
        public string? Away(Shift probe) => inner.Away(probe);

        public List<RosterFinding> Check(Shift probe)
        {
            var findings = inner.Check(probe);
            if (probe.UserId == workerId) findings.Add(new RosterFinding(code, RosterFindingSeverity.Warning, "needs a reason", RequiresReason: true));
            return findings;
        }

        public bool NeedsOverride(IReadOnlyList<RosterFinding> findings) => inner.NeedsOverride(findings);

        public void Book(Shift probe) => inner.Book(probe);

        public IReadOnlyList<(TimeOnly Start, TimeOnly End)> FreeSegments(Shift probe) => inner.FreeSegments(probe);
    }

    [Fact]
    public async Task Regular_OnApprovedLeave_FallsToTheNextAndSaysWhy()
    {
        await using var w = new World();
        var regular = w.Worker("Rae", 38);
        var other = w.Worker("Pat", 38);
        var shift = w.Shift(1, 9, 13);
        w.Regulars[shift.ShiftPatternId!.Value] = regular.Id;
        w.Db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantA, UserId = regular.Id, LeaveType = LeaveType.Annual, StartDate = shift.ServiceDate, EndDate = shift.ServiceDate,
            Status = LeaveStatus.Approved, RequestedByUserId = regular.Id, RequestedAt = DateTime.UtcNow,
        });

        var plan = await w.PlanAsync();

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(other.Id, placed.StaffId);
        Assert.Contains("on approved leave", placed.RegularAway);
    }

    [Fact]
    public async Task Tier_PreferredBeatsBackupBeatsUnlisted_AndExcludedIsNeverPlaced()
    {
        await using var w = new World();
        w.Worker("Zed", 38);
        var backup = w.Worker("Bea", 38, level: CompatibilityLevel.Backup, rank: 1);
        var preferred = w.Worker("Yan", 38, level: CompatibilityLevel.Preferred, rank: 1);
        var excluded = w.Worker("Abe", 38, level: CompatibilityLevel.Excluded);
        w.Shift(0, 9, 13);

        var plan = await w.PlanAsync();

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(preferred.Id, placed.StaffId);
        Assert.Equal(AutoRosterPick.Preferred, placed.Pick);
        Assert.Equal(backup.Id, placed.Alternates[0].StaffId);
        Assert.DoesNotContain(placed.Alternates, a => a.StaffId == excluded.Id);
    }

    [Fact]
    public async Task OnlyExcludedWorkers_LeavesTheShiftUncoveredAsOnlyNoStaff()
    {
        await using var w = new World();
        w.Worker("Abe", 38, level: CompatibilityLevel.Excluded);
        w.Shift(0, 9, 13);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Placements);
        Assert.Equal(UncoveredReason.OnlyNoStaff, Assert.Single(plan.Uncovered).Reason);
    }

    private static LeaveRequest LeaveFor(AutoRosterWorker worker, Shift shift, LeaveStatus status) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantA, UserId = worker.Id, LeaveType = LeaveType.Annual, StartDate = shift.ServiceDate, EndDate = shift.ServiceDate,
        Status = status, RequestedByUserId = worker.Id, RequestedAt = DateTime.UtcNow,
    };

    [Fact]
    public async Task OneFreeNoListedWorker_WithEveryoneElseOnLeave_IsOnlyNoStaff()
    {
        await using var w = new World();
        w.Worker("Abe", 38, level: CompatibilityLevel.Excluded);
        var pat = w.Worker("Pat", 38);
        var shift = w.Shift(1, 9, 13);
        w.Db.LeaveRequests.Add(LeaveFor(pat, shift, LeaveStatus.Approved));

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Placements);
        Assert.Equal(UncoveredReason.OnlyNoStaff, Assert.Single(plan.Uncovered).Reason);
    }

    [Fact]
    public async Task NoListedWorkerOnLeave_IsNobodyFree_NotOnlyNoStaff()
    {
        await using var w = new World();
        var abe = w.Worker("Abe", 38, level: CompatibilityLevel.Excluded);
        var shift = w.Shift(1, 9, 13);
        w.Db.LeaveRequests.Add(LeaveFor(abe, shift, LeaveStatus.Approved));

        var plan = await w.PlanAsync();

        Assert.Equal(UncoveredReason.NobodyFree, Assert.Single(plan.Uncovered).Reason);
    }

    [Fact]
    public async Task Regular_WithPendingLeave_IsNotPlaced_AndAnotherWorkerTakesTheShift()
    {
        await using var w = new World();
        var regular = w.Worker("Rae", 38);
        var other = w.Worker("Zed", 38);
        var shift = w.Shift(1, 9, 13);
        w.Regulars[shift.ShiftPatternId!.Value] = regular.Id;
        w.Db.LeaveRequests.Add(LeaveFor(regular, shift, LeaveStatus.Pending));

        var plan = await w.PlanAsync();

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(other.Id, placed.StaffId);
        Assert.Contains("Rae", placed.RegularAway);
    }

    [Fact]
    public async Task Regular_WithPendingLeaveAndAnOverrideFinding_IsNotPlaced_AndAnotherWorkerTakesTheShift()
    {
        await using var w = new World();
        var regular = w.Worker("Rae", 38);
        var other = w.Worker("Zed", 38);
        var shift = w.Shift(1, 9, 13);
        w.Regulars[shift.ShiftPatternId!.Value] = regular.Id;
        w.Db.LeaveRequests.Add(LeaveFor(regular, shift, LeaveStatus.Pending));

        var plan = await w.PlanAsync(wrap: inner => new NeedsReasonFor(inner, regular.Id));

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(other.Id, placed.StaffId);
        Assert.Contains("Rae", placed.RegularAway);
        Assert.Empty(plan.Uncovered);
    }

    [Fact]
    public async Task Regular_WithPendingRecurringRequest_IsNotPlaced_AndAnotherWorkerTakesTheShift()
    {
        await using var w = new World();
        var regular = w.Worker("Rae", 38);
        var other = w.Worker("Zed", 38);
        var shift = w.Shift(1, 9, 13);
        w.Regulars[shift.ShiftPatternId!.Value] = regular.Id;
        w.Db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantA, UserId = regular.Id, DayOfWeek = shift.ServiceDate.DayOfWeek, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(14, 0),
            EffectiveFrom = Monday, EffectiveTo = null, Status = LeaveStatus.Pending, RequestedByUserId = regular.Id, RequestedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        });

        var plan = await w.PlanAsync();

        var placed = Assert.Single(plan.Placements);
        Assert.Equal(other.Id, placed.StaffId);
        Assert.Contains("Rae", placed.RegularAway);
    }

    [Fact]
    public async Task EmptyPool_LeavesTheShiftUncoveredAsNoStaff()
    {
        await using var w = new World();
        w.Shift(0, 9, 13);

        var plan = await w.PlanAsync();

        Assert.Equal(UncoveredReason.NoStaff, Assert.Single(plan.Uncovered).Reason);
    }

    [Fact]
    public async Task ParticipantNotReady_IsUncoveredWithoutLookingAtStaff()
    {
        await using var w = new World();
        w.Worker("Pat", 38);
        w.Shift(0, 9, 13);
        w.NotReady.Add(w.Mia.Id);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Placements);
        Assert.Equal(UncoveredReason.ParticipantNotReady, Assert.Single(plan.Uncovered).Reason);
    }

    [Fact]
    public async Task PendingLeave_DisqualifiesAndIsOfferedAsARecommendation()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var shift = w.Shift(1, 9, 13);
        w.Db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantA, UserId = pat.Id, LeaveType = LeaveType.Annual, StartDate = shift.ServiceDate, EndDate = shift.ServiceDate,
            Status = LeaveStatus.Pending, RequestedByUserId = pat.Id, RequestedAt = DateTime.UtcNow,
        });

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Placements);
        var uncovered = Assert.Single(plan.Uncovered);
        Assert.Equal(AutoRosterRecommendationKind.Soft, uncovered.Recommendations[0].Kind);
        Assert.Equal(pat.Id, uncovered.Recommendations[0].StaffId);
    }

    [Fact]
    public async Task WorkerAtTheHoursCap_IsNotPlaced_AndTheShiftIsOfferedOverGoal()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38, rostered: 38);
        for (var day = 0; day < 5; day++)
            w.Db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = w.Mia.Id, UserId = pat.Id, ServiceDate = Monday.AddDays(day), StartTime = new TimeOnly(6, 0), EndTime = new TimeOnly(13, 36),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published, ShiftPatternId = Guid.NewGuid(),
            });
        w.Shift(5, 9, 13);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Placements);
        var uncovered = Assert.Single(plan.Uncovered);
        Assert.Equal(UncoveredReason.HoursCapReached, uncovered.Reason);
        Assert.Equal(AutoRosterRecommendationKind.OverGoal, uncovered.Recommendations[0].Kind);
    }

    [Fact]
    public async Task Hours_AreBalancedTowardsEachWorkersGoal()
    {
        await using var w = new World();
        var big = w.Worker("Ann", 38);
        var small = w.Worker("Ben", 19);
        for (var day = 0; day < 6; day++) { w.Shift(day, 7, 11); w.Shift(day, 15, 19); }

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Uncovered);
        Assert.Equal(32m, plan.Placements.Where(p => p.StaffId == big.Id).Sum(p => w.Open.Single(s => s.Id == p.ShiftId).DurationHours));
        Assert.Equal(16m, plan.Placements.Where(p => p.StaffId == small.Id).Sum(p => w.Open.Single(s => s.Id == p.ShiftId).DurationHours));
    }

    [Fact]
    public async Task SameInput_GivesTheSamePlan_WhateverOrderThePoolArrivesIn()
    {
        await using var w = new World();
        w.Worker("Ann", 38); w.Worker("Ben", 38); w.Worker("Cy", 19, level: CompatibilityLevel.Backup, rank: 1);
        for (var day = 0; day < 4; day++) { w.Shift(day, 7, 11); w.Shift(day, 15, 19); }

        var first = await w.PlanAsync();
        var second = await w.PlanAsync(reversePool: true);

        static string Key(AutoRosterPlan p) => string.Join("|", p.Placements.Select(x => $"{x.ShiftId}:{x.StaffId}:{x.Pick}")) + "/" + string.Join("|", p.Uncovered.Select(x => $"{x.ShiftId}:{x.Reason}:" + string.Join(",", x.Recommendations.Select(c => $"{c.Kind}:{c.StaffId}:{c.Text}"))))
            + "/" + string.Join("|", p.Placements.Select(x => $"{x.ShiftId}:" + string.Join(",", x.Alternates.Select(a => $"{a.StaffId}:{a.Pick}"))));
        Assert.Equal(Key(first), Key(second));
    }

    [Fact]
    public async Task AFreeNoListedWorker_AndOneWhoNeedsAReason_IsOnlyNoStaff_WithAnOverrideRecommendation()
    {
        await using var w = new World();
        w.Worker("Abe", 38, level: CompatibilityLevel.Excluded);
        var pat = w.Worker("Pat", 38);
        w.Shift(1, 9, 13);

        var plan = await w.PlanAsync(wrap: inner => new NeedsReasonFor(inner, pat.Id, RosterConflictService.PublicHoliday));

        var uncovered = Assert.Single(plan.Uncovered);
        Assert.Equal(UncoveredReason.OnlyNoStaff, uncovered.Reason);
        var rec = uncovered.Recommendations[0];
        Assert.Equal(AutoRosterRecommendationKind.Override, rec.Kind);
        Assert.Equal(pat.Id, rec.StaffId);
        Assert.Equal("Pat Test can take it with a reason: needs a reason", rec.Text);
    }

    [Fact]
    public async Task Recommendations_AreListedOverGoal_ThenOverride_ThenSoft()
    {
        await using var w = new World();
        var hal = w.Worker("Hal", 38, rostered: 38);
        var pat = w.Worker("Pat", 38);
        var sue = w.Worker("Sue", 38);
        for (var day = 0; day < 5; day++)
            w.Db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = w.Mia.Id, UserId = hal.Id, ServiceDate = Monday.AddDays(day), StartTime = new TimeOnly(6, 0), EndTime = new TimeOnly(13, 36),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Published, ShiftPatternId = Guid.NewGuid(),
            });
        var shift = w.Shift(5, 9, 13);
        w.Db.LeaveRequests.Add(LeaveFor(sue, shift, LeaveStatus.Pending));

        var plan = await w.PlanAsync(wrap: inner => new NeedsReasonFor(inner, pat.Id, RosterConflictService.PublicHoliday));

        var uncovered = Assert.Single(plan.Uncovered);
        Assert.Equal(
            [AutoRosterRecommendationKind.OverGoal, AutoRosterRecommendationKind.Override, AutoRosterRecommendationKind.Soft],
            uncovered.Recommendations.Select(r => r.Kind));
        Assert.Equal([hal.Id, pat.Id, sue.Id], uncovered.Recommendations.Select(r => r.StaffId!.Value));
    }

    // Compat PR 1b: the reach only flags ("Needs a look"); it never changes who is proposed.
    private static async Task<(World World, AutoRosterWorker Pat, AutoRosterWorker Bea, AutoRosterWorker Emmy, AutoRosterWorker Una, AutoRosterWorker Rae)> ReachWorld()
    {
        var w = new World();
        var pat = w.Worker("Pat", 38, level: CompatibilityLevel.Preferred, rank: 1);
        var bea = w.Worker("Bea", 38, level: CompatibilityLevel.Backup, rank: 1);
        var emmy = w.Worker("Emmy", 38, level: CompatibilityLevel.Emergency, rank: 1);
        var una = w.Worker("Una", 38);
        var rae = w.Worker("Rae", 38, level: CompatibilityLevel.Emergency, rank: 2);
        w.Shift(0, 9, 13);
        var regularShift = w.Shift(1, 9, 13);
        w.Regulars[regularShift.ShiftPatternId!.Value] = rae.Id;
        await w.Db.SaveChangesAsync();
        return (w, pat, bea, emmy, una, rae);
    }

    private static string Who(AutoRosterPlan p) => string.Join("|", p.Placements.Select(x => $"{x.ShiftId}:{x.StaffId}:{x.Pick}/" + string.Join(",", x.Alternates.Select(a => a.StaffId))))
        + "#" + string.Join(",", p.Uncovered.Select(u => u.ShiftId)) + "#" + string.Join(",", p.Splits.Select(s => $"{s.ShiftId}:{s.FirstStaffId}:{s.SecondStaffId}"));

    [Fact]
    public async Task Reach_NeverChangesWhoIsProposed_AndAtTheDefaultNothingIsFlagged()
    {
        var (w, _, _, _, _, _) = await ReachWorld();
        await using var world = w;

        var plans = new List<AutoRosterPlan>();
        for (var reach = 0; reach <= 3; reach++) plans.Add(await w.PlanAsync(reach: reach));

        Assert.All(plans, p => Assert.Equal(Who(plans[0]), Who(p)));
        var shipped = plans[3];
        Assert.DoesNotContain(shipped.Placements, p => p.NeedsLook || p.Alternates.Any(a => a.NeedsLook));
        Assert.DoesNotContain(shipped.Splits, s => s.NeedsLook);
    }

    [Fact]
    public async Task Reach0_FlagsTheAlternatesThatAreBackupOrLower_AndFollowsThemToTheDto()
    {
        var (w, pat, bea, emmy, _, rae) = await ReachWorld();
        await using var world = w;

        var plan = await w.PlanAsync(reach: 0);

        var first = plan.Placements[0];
        Assert.Equal(pat.Id, first.StaffId);
        Assert.False(first.NeedsLook);
        Assert.Equal([bea.Id, emmy.Id, rae.Id], first.Alternates.Select(a => a.StaffId));
        Assert.All(first.Alternates, a => Assert.True(a.NeedsLook));
    }

    [Fact]
    public async Task Reach1_FlagsAnEmergencyPick_ButNotARegularAtEmergency()
    {
        await using var w = new World();
        w.Worker("Pat", 38, level: CompatibilityLevel.Excluded);
        w.Worker("Bea", 38, level: CompatibilityLevel.Excluded);
        var emmy = w.Worker("Emmy", 38, level: CompatibilityLevel.Emergency, rank: 1);
        var rae = w.Worker("Rae", 38, level: CompatibilityLevel.Emergency, rank: 2);
        var open = w.Shift(0, 9, 13);
        var regularShift = w.Shift(1, 9, 13);
        w.Regulars[regularShift.ShiftPatternId!.Value] = rae.Id;

        var plan = await w.PlanAsync(reach: 1);

        var emergency = plan.Placements.Single(p => p.ShiftId == open.Id);
        Assert.Equal((emmy.Id, true), (emergency.StaffId, emergency.NeedsLook));
        var regular = plan.Placements.Single(p => p.ShiftId == regularShift.Id);
        Assert.Equal((AutoRosterPick.Regular, false), (regular.Pick, regular.NeedsLook));
    }

    [Fact]
    public async Task Reach1_FlagsAnUnlistedPick_ButNotAtReach3()
    {
        await using var w = new World();
        w.Worker("Pat", 38, level: CompatibilityLevel.Excluded);
        var una = w.Worker("Una", 38);
        w.Shift(0, 9, 13);

        var flagged = (await w.PlanAsync(reach: 1)).Placements[0];
        Assert.Equal((una.Id, true), (flagged.StaffId, flagged.NeedsLook));
        var shipped = (await w.PlanAsync(reach: 3)).Placements[0];
        Assert.Equal((una.Id, false), (shipped.StaffId, shipped.NeedsLook));
    }
}
