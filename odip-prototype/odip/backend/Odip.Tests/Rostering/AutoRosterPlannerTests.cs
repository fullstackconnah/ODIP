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
    private static readonly DateOnly Monday = new(2026, 11, 2);

    private sealed class World : IAsyncDisposable
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

        public async Task<AutoRosterPlan> PlanAsync(bool reversePool = false)
        {
            await Db.SaveChangesAsync();
            var availability = new RosterAvailability(Db, new StaffUnavailabilityQuery(Db));
            var snapshot = await availability.LoadAsync(Pool.Select(w => w.Id).ToList(), [Mia.Id], Monday, Monday.AddDays(6), default);
            var pool = reversePool ? Enumerable.Reverse(Pool).ToList() : Pool;
            return AutoRosterPlanner.Plan(new AutoRosterInput(Open, pool, Regulars, Compat, NotReady), new SnapshotAutoRosterOracle(snapshot));
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

        static string Key(AutoRosterPlan p) => string.Join("|", p.Placements.Select(x => $"{x.ShiftId}:{x.StaffId}:{x.Pick}")) + "/" + string.Join("|", p.Uncovered.Select(x => $"{x.ShiftId}:{x.Reason}"));
        Assert.Equal(Key(first), Key(second));
    }
}
