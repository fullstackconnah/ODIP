using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// The shared availability service (Start rostering, 2026-10-16, L5): the single-shift check over the week and the day either side, the short "regular away" reasons (L-b), and the
/// away pass over a batch of just-generated shifts, earliest first.
/// </summary>
public class RosterAvailabilityTests
{
    private static readonly DateOnly Monday = new(2026, 10, 19);
    private static readonly DateOnly Tuesday = Monday.AddDays(1);

    private sealed class Set : IAsyncDisposable
    {
        public required OdipDbContext Db { get; init; }
        public required User Kim { get; init; }
        public required Participant Mia { get; init; }
        public RosterAvailability Sut => new(Db, new StaffUnavailabilityQuery(Db));
        public ValueTask DisposeAsync() => Db.DisposeAsync();

        public Task<RosterAvailability.Snapshot> LoadAsync() => Sut.LoadAsync(new[] { Kim.Id }, new[] { Mia.Id }, Monday, Monday.AddDays(6), default);
    }

    private static async Task<Set> SetUpAsync(Action<User>? kim = null)
    {
        var db = NewDb(Guid.NewGuid().ToString());
        var worker = new User
        {
            Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Kim", LastName = "Lee", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        kim?.Invoke(worker);
        db.Users.Add(worker);
        var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
        await db.SaveChangesAsync();
        return new Set { Db = db, Kim = worker, Mia = mia };
    }

    private static Shift ShiftOf(Guid participantId, Guid? userId, DateOnly day, int from, int to, ShiftStatus status = ShiftStatus.Draft, bool endsNextDay = false) => new()
    {
        Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participantId, UserId = userId, ServiceDate = day, StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(to, 0),
        EndsNextDay = endsNextDay, Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status, ShiftPatternId = Guid.NewGuid(),
    };

    private static void Leave(Set s, LeaveStatus status) => s.Db.LeaveRequests.Add(new LeaveRequest
    {
        Id = Guid.NewGuid(), TenantId = TenantA, UserId = s.Kim.Id, LeaveType = LeaveType.Annual, StartDate = Tuesday, EndDate = Tuesday,
        Status = status, RequestedByUserId = s.Kim.Id, RequestedAt = DateTime.UtcNow,
    });

    private static async Task<string?> AwayOnTuesdayAsync(Set s, int from = 9, int to = 13) =>
        (await s.LoadAsync()).AwayReason(ShiftOf(s.Mia.Id, s.Kim.Id, Tuesday, from, to));

    [Fact]
    public async Task Check_SeesAnOvernightShiftFromTheWeekBefore()
    {
        await using var s = await SetUpAsync();
        s.Db.Shifts.Add(ShiftOf(s.Mia.Id, s.Kim.Id, Monday.AddDays(-1), 22, 6, ShiftStatus.Published, endsNextDay: true));
        await s.Db.SaveChangesAsync();

        var findings = (await s.LoadAsync()).Check(ShiftOf(s.Mia.Id, s.Kim.Id, Monday, 5, 9));

        Assert.Contains(findings, f => f.Code == RosterConflictService.DoubleBookedShift);
    }

    [Fact]
    public async Task AwayReason_ForApprovedLeave()
    {
        await using var s = await SetUpAsync();
        Leave(s, LeaveStatus.Approved);
        await s.Db.SaveChangesAsync();
        Assert.Equal("on approved leave", await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_IsNull_ForPendingLeave()
    {
        await using var s = await SetUpAsync();
        Leave(s, LeaveStatus.Pending);
        await s.Db.SaveChangesAsync();
        Assert.Null(await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_ForApprovedRecurringUnavailability()
    {
        await using var s = await SetUpAsync();
        s.Db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), TenantId = TenantA, UserId = s.Kim.Id, DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(8, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Approved, RequestedByUserId = s.Kim.Id, RequestedAt = DateTime.UtcNow,
        });
        await s.Db.SaveChangesAsync();
        Assert.Equal("unavailable", await AwayOnTuesdayAsync(s, 9, 13));
    }

    [Fact]
    public async Task AwayReason_ForLegacyUnavailability()
    {
        await using var s = await SetUpAsync();
        s.Db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = s.Kim.Id, AvailabilityType = AvailabilityType.Unavailable,
            StartDateTime = Tuesday.ToDateTime(new TimeOnly(0, 0)), EndDateTime = Tuesday.ToDateTime(new TimeOnly(23, 0)),
        });
        await s.Db.SaveChangesAsync();
        Assert.Equal("unavailable", await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_ForATripThatDay()
    {
        await using var s = await SetUpAsync();
        s.Db.StaffAssignments.Add(new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = Guid.NewGuid(), UserId = s.Kim.Id, AssignmentStart = Tuesday, AssignmentEnd = Tuesday, Status = AssignmentStatus.Confirmed });
        await s.Db.SaveChangesAsync();
        Assert.Equal("on a trip", await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_ForAnInactiveUser()
    {
        await using var s = await SetUpAsync(kim => kim.IsActive = false);
        Assert.Equal("inactive", await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_ForAnExpiredScreening()
    {
        await using var s = await SetUpAsync(kim => kim.WorkerScreeningExpiryDate = new DateOnly(2026, 1, 1));
        Assert.Equal("screening expired", await AwayOnTuesdayAsync(s));
    }

    [Fact]
    public async Task AwayReason_IgnoresACancelledShift()
    {
        await using var s = await SetUpAsync();
        s.Db.Shifts.Add(ShiftOf(s.Mia.Id, s.Kim.Id, Tuesday, 9, 13, ShiftStatus.Cancelled));
        await s.Db.SaveChangesAsync();
        var snapshot = await s.LoadAsync();
        var candidate = ShiftOf(s.Mia.Id, s.Kim.Id, Tuesday, 9, 13);

        Assert.Null(snapshot.AwayReason(candidate));
        Assert.Contains(snapshot.Check(candidate), f => f.Code == RosterConflictService.DoubleBookedShift);   // the board's own warning on it is unchanged
    }

    [Fact]
    public void EveryBlockingFinding_IsAway_WithAGenericReasonWhenItHasNoShortOne()   // B-S1: any Blocking finding, not only the mapped codes
    {
        Assert.Equal("can't work this shift", RosterAvailability.Snapshot.ReasonOf(new RosterFinding("SOME_NEW_BLOCK", RosterFindingSeverity.Blocking, "Blocked.")));
        Assert.Equal("screening expired", RosterAvailability.Snapshot.ReasonOf(new RosterFinding(RosterConflictService.WscExpired, RosterFindingSeverity.Blocking, "Expired.")));
        Assert.Null(RosterAvailability.Snapshot.ReasonOf(new RosterFinding(RosterConflictService.StaffLeavePending, RosterFindingSeverity.Warning, "Pending.")));
    }

    [Fact]
    public async Task MarkRegularsAway_KeepsTheEarliest_AndOpensTheLater()
    {
        await using var s = await SetUpAsync();
        var leo = s.Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Leo", LastName = "Test", IsActive = true }).Entity;
        await s.Db.SaveChangesAsync();
        var later = s.Db.Shifts.Add(ShiftOf(leo.Id, s.Kim.Id, Tuesday, 11, 15)).Entity;
        var earlier = s.Db.Shifts.Add(ShiftOf(s.Mia.Id, s.Kim.Id, Tuesday, 9, 13)).Entity;

        Assert.Equal(1, await s.Sut.MarkRegularsAwayAsync(new[] { later, earlier }, default));

        Assert.Equal(s.Kim.Id, earlier.UserId);
        Assert.Null(earlier.RegularUserId);
        Assert.Null(later.UserId);
        Assert.Equal(s.Kim.Id, later.RegularUserId);
        Assert.Equal("booked on another shift", later.RegularAwayReason);
    }

    [Fact]
    public async Task MarkRegularsAway_BreaksATieByParticipantId()
    {
        await using var s = await SetUpAsync();
        var first = s.Db.Participants.Add(new Participant { Id = new Guid("00000000-0000-0000-0000-000000000001"), TenantId = TenantA, FirstName = "One", LastName = "Test", IsActive = true }).Entity;
        var second = s.Db.Participants.Add(new Participant { Id = new Guid("00000000-0000-0000-0000-000000000002"), TenantId = TenantA, FirstName = "Two", LastName = "Test", IsActive = true }).Entity;
        await s.Db.SaveChangesAsync();
        var two = s.Db.Shifts.Add(ShiftOf(second.Id, s.Kim.Id, Tuesday, 9, 13)).Entity;
        var one = s.Db.Shifts.Add(ShiftOf(first.Id, s.Kim.Id, Tuesday, 9, 13)).Entity;

        await s.Sut.MarkRegularsAwayAsync(new[] { two, one }, default);

        Assert.Equal(s.Kim.Id, one.UserId);
        Assert.Null(two.UserId);
    }

    [Fact]
    public async Task MarkRegularsAway_LeavesOpenShiftsAlone()
    {
        await using var s = await SetUpAsync();
        var open = s.Db.Shifts.Add(ShiftOf(s.Mia.Id, null, Tuesday, 9, 13)).Entity;

        Assert.Equal(0, await s.Sut.MarkRegularsAwayAsync(new[] { open }, default));
        Assert.Null(open.RegularUserId);
        Assert.Null(open.RegularAwayReason);
    }

    // QW7: the weekly-hours threshold is the worker's organisation's setting, 38 when it has none.
    private static async Task<IReadOnlyList<RosterFinding>> TuesdayFindingsAsync(Set s) =>
        (await s.LoadAsync()).Check(ShiftOf(s.Mia.Id, s.Kim.Id, Tuesday, 9, 17));   // 8h on top of Monday's 8h = 16h

    [Fact]
    public async Task OverHours_UsesTheOrganisationsSetting()
    {
        await using var s = await SetUpAsync();
        s.Db.Shifts.Add(ShiftOf(s.Mia.Id, s.Kim.Id, Monday, 9, 17, ShiftStatus.Published));
        s.Db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantA, WeeklyHoursWarning = 15 });
        await s.Db.SaveChangesAsync();

        var over = Assert.Single(await TuesdayFindingsAsync(s), f => f.Code == RosterConflictService.OverHours);
        Assert.Contains("exceed the 15h threshold", over.Message);
    }

    [Fact]
    public async Task OverHours_WithNoSetting_StaysAt38()
    {
        await using var s = await SetUpAsync();
        s.Db.Shifts.Add(ShiftOf(s.Mia.Id, s.Kim.Id, Monday, 9, 17, ShiftStatus.Published));
        // Another organisation's low setting must not reach this worker.
        s.Db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantB, WeeklyHoursWarning = 5 });
        await s.Db.SaveChangesAsync();

        Assert.DoesNotContain(await TuesdayFindingsAsync(s), f => f.Code == RosterConflictService.OverHours);
    }

    [Fact]
    public async Task OverHours_ReadsTheWorkersOrganisation_EvenWhenTheCallerIsAnotherTenant()
    {
        // The caller is organisation B (the ambient filter would hide A's row); the worker is A's and A's setting is 15.
        var tenant = new Moq.Mock<Odip.Domain.Interfaces.ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantB);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        await using var db = new OdipDbContext(new Microsoft.EntityFrameworkCore.DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantA, WeeklyHoursWarning = 15 });
        await db.SaveChangesAsync();

        var byTenant = await RosterAvailability.WeeklyHoursAsync(db, new[] { TenantA }, default);

        Assert.Equal(15, RosterAvailability.WeeklyHoursFor(byTenant, TenantA));
    }
}
