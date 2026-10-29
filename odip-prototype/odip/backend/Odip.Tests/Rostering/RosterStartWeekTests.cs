using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering (2026-10-16, L4, L5) on EF InMemory: the week's agreement shifts are made once, with their regulars unless away, and the week is marked started. The locks are no-ops
/// here; the races are in RosterStartWeekPostgresTests. Provider's today: Wed 2026-10-14 in Sydney.
/// </summary>
public class RosterStartWeekTests
{
    internal static readonly DateOnly Monday = new(2026, 10, 19);
    internal static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();
    internal static readonly Guid CoordinatorId = Guid.NewGuid();

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    internal static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 10, 14, 1, 0, 0, TimeSpan.Zero));

    internal static ICurrentTenant TenantOf(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return tenant.Object;
    }

    internal static RosteringController Controller(OdipDbContext db, ICurrentTenant tenant) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock, tenant: tenant)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, CoordinatorId.ToString()), new Claim(ClaimTypes.Role, "Coordinator") }, "test")) },
            },
        };

    internal static async Task<ActionResult<ApiResponse<StartWeekResultDto>>> StartAsync(string dbName, DateOnly week, Guid? tenantId = null)
    {
        using var db = TestDb.ForTenant(dbName, tenantId ?? TenantA);
        return await Controller(db, TenantOf(tenantId ?? TenantA)).StartWeek(week, default);
    }

    internal static StartWeekResultDto Ok(ActionResult<ApiResponse<StartWeekResultDto>> result) =>
        Assert.IsType<ApiResponse<StartWeekResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    internal static Participant Person(OdipDbContext db, string first, Guid? tenantId = null, bool active = true) =>
        db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, FirstName = first, LastName = "Test", IsActive = active, IsDraft = !active }).Entity;

    internal static User Worker(OdipDbContext db, string first) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), TenantId = TenantA, FirstName = first, LastName = "Lee", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    /// <summary>An agreement pattern (an approved revision made it) for one weekday, 09:00-13:00 unless told otherwise.</summary>
    internal static ShiftPattern Pattern(OdipDbContext db, Guid participantId, DayOfWeek day, Guid? regular = null, Guid? tenantId = null, bool fromAgreement = true,
        DateOnly? effectiveTo = null, int from = 9, int to = 13) => db.ShiftPatterns.Add(new ShiftPattern
    {
        Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, ParticipantId = participantId, DayOfWeek = day, StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(to, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = new DateOnly(2026, 10, 1), EffectiveTo = effectiveTo, IsActive = true, DefaultUserId = regular,
        SourceDraftId = fromAgreement ? Guid.NewGuid() : null, SourceBlockKey = fromAgreement ? "b1" : null, WorkerSlot = fromAgreement ? 1 : null,
    }).Entity;

    internal static readonly DayOfWeek[] Weekdays = { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };

    /// <summary>A SuperAdmin-seeded database with NSW provider settings for both organisations.</summary>
    internal static string NewDatabase(Action<OdipDbContext> seed)
    {
        var name = Guid.NewGuid().ToString();
        using var db = TestDb.Create(name);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, State = "NSW" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantB, State = "NSW" });
        seed(db);
        db.SaveChanges();
        return name;
    }

    private static List<Shift> ShiftsIn(string dbName, Guid? participantId = null)
    {
        using var db = TestDb.Create(dbName);
        return db.Shifts.AsNoTracking().Where(s => participantId == null || s.ParticipantId == participantId).OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ToList();
    }

    private static List<RosterWeek> Rows(string dbName)
    {
        using var db = TestDb.Create(dbName);
        return db.RosterWeeks.AsNoTracking().ToList();
    }

    internal static void AssertWeekStarted409(ActionResult<ApiResponse<StartWeekResultDto>> result) =>
        Assert.Equal(RosteringController.RosterWeekStartedCode, Assert.IsType<ApiResponse<StartWeekResultDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value).Code);

    [Fact]
    public async Task Start_MakesTheWeeksAgreementShifts_Once_AndMarksTheWeekStarted()
    {
        var dbName = NewDatabase(db => { var mia = Person(db, "Mia"); foreach (var day in Weekdays) Pattern(db, mia.Id, day); });

        var first = Ok(await StartAsync(dbName, Monday));

        Assert.Equal((5, Monday), (first.Created, first.WeekStart));
        var shifts = ShiftsIn(dbName);
        Assert.Equal(Enumerable.Range(0, 5).Select(i => Monday.AddDays(i)), shifts.Select(s => s.ServiceDate));
        Assert.All(shifts, s => Assert.Equal((ShiftStatus.Draft, true), (s.Status, s.ShiftPatternId != null)));
        var row = Assert.Single(Rows(dbName));
        Assert.Equal((Monday, (Guid?)CoordinatorId, TenantA), (row.WeekStart, row.StartedByUserId, row.TenantId));

        AssertWeekStarted409(await StartAsync(dbName, Monday));
        Assert.Equal(5, ShiftsIn(dbName).Count);
    }

    [Fact]
    public async Task Start_NormalisesAnyDayToItsMonday()
    {
        var dbName = NewDatabase(_ => { });
        Assert.Equal(Monday, Ok(await StartAsync(dbName, Monday.AddDays(3))).WeekStart);
        Assert.Equal(Monday, Assert.Single(Rows(dbName)).WeekStart);
    }

    [Fact]
    public async Task Start_LeavesOutHandMadeAndEndedPatterns_AndOtherOrganisations()
    {
        var dbName = NewDatabase(db =>
        {
            var mia = Person(db, "Mia");
            Pattern(db, mia.Id, DayOfWeek.Monday, fromAgreement: false);
            Pattern(db, mia.Id, DayOfWeek.Tuesday, effectiveTo: new DateOnly(2026, 10, 18));
            Pattern(db, Person(db, "Bo", TenantB).Id, DayOfWeek.Wednesday, tenantId: TenantB);
        });

        Assert.Equal(0, Ok(await StartAsync(dbName, Monday)).Created);
        Assert.Empty(ShiftsIn(dbName));
        Assert.Equal(TenantA, Assert.Single(Rows(dbName)).TenantId);
    }

    [Fact]
    public async Task Start_SkipsAParticipantWhoMayNotBeRostered_AndNamesThem()
    {
        Guid noahId = default;
        var dbName = NewDatabase(db => { var noah = Person(db, "Noah", active: false); noahId = noah.Id; Pattern(db, noah.Id, DayOfWeek.Monday); });

        var result = Ok(await StartAsync(dbName, Monday));

        var skipped = Assert.Single(result.Skipped);
        Assert.Equal((noahId, "Noah Test"), (skipped.ParticipantId, skipped.FullName));
        Assert.Empty(ShiftsIn(dbName, noahId));
    }

    [Fact]
    public async Task Start_AssignsTheRegular_WhenFree()
    {
        Guid kimId = default;
        var dbName = NewDatabase(db => { var kim = Worker(db, "Kim"); kimId = kim.Id; var mia = Person(db, "Mia"); foreach (var day in Weekdays) Pattern(db, mia.Id, day, kim.Id); });

        var result = Ok(await StartAsync(dbName, Monday));

        Assert.All(ShiftsIn(dbName), s => Assert.Equal(kimId, s.UserId));
        Assert.Equal((5, 0), (result.AssignedToRegulars, result.RegularAway));
    }

    internal static void Leave(OdipDbContext db, Guid userId, LeaveStatus status, DateOnly day) => db.LeaveRequests.Add(new LeaveRequest
    {
        Id = Guid.NewGuid(), TenantId = TenantA, UserId = userId, LeaveType = LeaveType.Annual, StartDate = day, EndDate = day, Status = status,
        RequestedByUserId = userId, RequestedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
    });

    [Fact]
    public async Task Start_OpensTheShift_WhenTheRegularIsOnApprovedLeave()
    {
        Guid kimId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kimId = kim.Id;
            var mia = Person(db, "Mia");
            foreach (var day in Weekdays) Pattern(db, mia.Id, day, kim.Id);
            Leave(db, kim.Id, LeaveStatus.Approved, Monday.AddDays(2));
        });

        var result = Ok(await StartAsync(dbName, Monday));

        var wednesday = ShiftsIn(dbName).Single(s => s.ServiceDate == Monday.AddDays(2));
        Assert.Equal(((Guid?)null, (Guid?)kimId, "on approved leave"), (wednesday.UserId, wednesday.RegularUserId, wednesday.RegularAwayReason));
        Assert.Equal((4, 1), (result.AssignedToRegulars, result.RegularAway));
    }

    [Fact]
    public async Task Start_AssignsTheRegular_OnPendingLeave()
    {
        Guid kimId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kimId = kim.Id;
            var mia = Person(db, "Mia");
            foreach (var day in Weekdays) Pattern(db, mia.Id, day, kim.Id);
            Leave(db, kim.Id, LeaveStatus.Pending, Monday.AddDays(2));
        });

        Assert.Equal(5, Ok(await StartAsync(dbName, Monday)).AssignedToRegulars);
        Assert.All(ShiftsIn(dbName), s => Assert.Equal((kimId, (Guid?)null, (string?)null), (s.UserId!.Value, s.RegularUserId, s.RegularAwayReason)));
    }

    [Fact]
    public async Task Start_TwoParticipantsSharingARegular_TheEarlierShiftKeepsThem()
    {
        Guid kimId = default, miaId = default, leoId = default;
        var dbName = NewDatabase(db =>
        {
            var kim = Worker(db, "Kim"); kimId = kim.Id;
            var mia = Person(db, "Mia"); miaId = mia.Id;
            var leo = Person(db, "Leo"); leoId = leo.Id;
            Pattern(db, mia.Id, DayOfWeek.Monday, kim.Id, from: 9, to: 13);
            Pattern(db, leo.Id, DayOfWeek.Monday, kim.Id, from: 11, to: 15);
        });

        Ok(await StartAsync(dbName, Monday));

        Assert.Equal(kimId, Assert.Single(ShiftsIn(dbName, miaId)).UserId);
        var leos = Assert.Single(ShiftsIn(dbName, leoId));
        Assert.Equal(((Guid?)null, "booked on another shift"), (leos.UserId, leos.RegularAwayReason));
    }

    [Fact]
    public async Task Start_RefusesAWeekThatAlreadyHoldsAPatternShift_WithoutARow()
    {
        var dbName = NewDatabase(db =>
        {
            var mia = Person(db, "Mia");
            var monday = Pattern(db, mia.Id, DayOfWeek.Monday);
            Pattern(db, mia.Id, DayOfWeek.Tuesday);
            db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = mia.Id, ShiftPatternId = monday.Id, ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
            });
        });

        AssertWeekStarted409(await StartAsync(dbName, Monday));
        Assert.Single(ShiftsIn(dbName));
        Assert.Empty(Rows(dbName));
    }

    [Fact]
    public async Task Start_StillStartsAWeekThatHoldsOnlyAOneOffOrACancelledPatternShift()
    {
        var dbName = NewDatabase(db =>
        {
            var mia = Person(db, "Mia");
            Pattern(db, mia.Id, DayOfWeek.Monday);
            var tuesday = Pattern(db, mia.Id, DayOfWeek.Tuesday);
            Shift Make(Guid? patternId, ShiftStatus status, DateOnly day, int from) => db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = mia.Id, ShiftPatternId = patternId, ServiceDate = day, StartTime = new TimeOnly(from, 0), EndTime = new TimeOnly(from + 1, 0),
                Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
            }).Entity;
            Make(null, ShiftStatus.Published, Monday.AddDays(3), 15);
            Make(tuesday.Id, ShiftStatus.Cancelled, Monday.AddDays(2), 9);   // an agreement pattern's shift, cancelled
        });

        Assert.Equal(2, Ok(await StartAsync(dbName, Monday)).Created);
    }

    [Fact]
    public async Task Start_AnyWeek_PastIncluded()
    {
        var past = new DateOnly(2026, 9, 28);
        var dbName = NewDatabase(db => { var mia = Person(db, "Mia"); Pattern(db, mia.Id, DayOfWeek.Monday).EffectiveFrom = new DateOnly(2026, 9, 1); });

        Assert.Equal(1, Ok(await StartAsync(dbName, past)).Created);
        Assert.Equal(past, Assert.Single(ShiftsIn(dbName)).ServiceDate);
    }

    [Fact]
    public async Task Start_NeedsAChosenOrganisation()
    {
        var dbName = NewDatabase(db => { var mia = Person(db, "Mia"); Pattern(db, mia.Id, DayOfWeek.Monday); });
        using (var db = TestDb.Create(dbName))
            Assert.IsType<BadRequestObjectResult>((await Controller(db, TenantOf(null, superAdmin: true)).StartWeek(Monday, default)).Result);

        Assert.Empty(Rows(dbName));
        Assert.Empty(ShiftsIn(dbName));
    }

    [Fact]
    public async Task Start_ReturnsBudgetWarnings_NamingTheParticipant()
    {
        using var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 14, 1, 0, 0, TimeSpan.Zero));
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var mia = kit.SeedParticipant(first: "Mia", last: "Test");
        kit.SeedPlan(mia, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 1000m), LedgerKit.Q(3, 5000m)));
        foreach (var day in Weekdays) Pattern(kit.Db, mia.Id, day, tenantId: kit.TenantId, from: 9, to: 17);
        kit.Db.SaveChanges();
        var controller = Controller(kit.Db, kit.Tenant!);

        var result = Ok(await controller.StartWeek(Monday, default));

        var warned = Assert.Single(result.BudgetWarnings!);
        Assert.Equal((mia.Id, "Mia Test"), (warned.ParticipantId, warned.FullName));
        Assert.NotEmpty(warned.Warnings!);
    }
}
