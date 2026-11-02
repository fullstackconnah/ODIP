using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering (2026-10-16, L6), now Populate roster (S11): populating makes the shifts only in the weeks already started on the roster (a RosterWeek row, or a live agreement-pattern shift: StartedWeeks), held to the
/// agreement's dates, with the regular-away pass (R2). The approval fixture without its started weeks: Saturday 10 October 2026, the agreement 2026-10-12 to 2026-12-20, Monday to Friday.
/// </summary>
public class ApprovalIntoStartedWeeksTests
{
    private static void Start(Fixture f, params DateOnly[] mondays) =>
        f.Db.RosterWeeks.AddRange(mondays.Select(monday => new RosterWeek { Id = Guid.NewGuid(), TenantId = TenantA, WeekStart = monday }));

    /// <summary>Approves (which makes no shifts), then asks what Populate would add and populates every started week: the preview's total and the result.</summary>
    private static async Task<(int ToAdd, PopulateResultDto Result, ApprovalOutcome Outcome)> ApproveThenPopulateAsync(Fixture f, ServiceAgreementDraft draft)
    {
        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, default);
        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var toAdd = (await f.Service.PopulatePreviewAsync(TenantA, f.ParticipantId, draft.Id, default))!.Weeks.Sum(w => w.ToAdd);
        return (toAdd, await PopulateAllAsync(f.Service, f.ParticipantId, draft.Id), outcome);
    }

    private static Task<List<DateOnly>> ShiftDaysAsync(Fixture f) =>
        f.Db.Shifts.AsNoTracking().Where(s => s.ParticipantId == f.ParticipantId).Select(s => s.ServiceDate).OrderBy(d => d).ToListAsync();

    private static IEnumerable<DateOnly> Weekdays(DateOnly monday, int count = 5) => Enumerable.Range(0, count).Select(i => monday.AddDays(i));

    [Fact]
    public async Task NoStartedWeek_PopulateMakesNoShifts_AndApprovalMadePatterns()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (toAdd, result, outcome) = await ApproveThenPopulateAsync(f, draft);

        Assert.Equal((0, 0, 0), (toAdd, result.Created, result.Weeks.Count));
        Assert.Equal((5, 0, (DateOnly?)null, (DateOnly?)null), (outcome.Approval!.PatternsCreated, outcome.Approval.ShiftsCreated, outcome.Approval.FirstShiftDate, outcome.Approval.HorizonEnd));
        Assert.Empty(await ShiftDaysAsync(f));
    }

    [Fact]
    public async Task OnlyStartedWeeks_GetShifts_AndAGapWeekStaysEmpty()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        Start(f, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 26));
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (toAdd, result, _) = await ApproveThenPopulateAsync(f, draft);

        Assert.Equal(Weekdays(new DateOnly(2026, 10, 12)).Concat(Weekdays(new DateOnly(2026, 10, 26))), await ShiftDaysAsync(f));
        Assert.Equal((10, 10), (result.Created, toAdd));
        Assert.Equal(new[] { new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 26) }, result.Weeks.Select(w => w.WeekStart));
    }

    [Fact]
    public async Task AStartedWeekBeforeTheAgreement_IsHeldToItsStart()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        Start(f, new DateOnly(2026, 10, 5));
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (_, result, _) = await ApproveThenPopulateAsync(f, draft);

        Assert.Equal(0, result.Created);
        Assert.Empty(await ShiftDaysAsync(f));
    }

    [Fact]
    public async Task AStartedWeekPastTheAgreementEnd_IsHeldToItsEnd()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        Start(f, new DateOnly(2026, 10, 12));
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: new DateOnly(2026, 10, 14));

        var (_, result, _) = await ApproveThenPopulateAsync(f, draft);

        Assert.Equal(Weekdays(new DateOnly(2026, 10, 12), 3), await ShiftDaysAsync(f));
        Assert.Equal(3, result.Created);
    }

    [Fact]
    public async Task ARegularCarriedIntoARenewal_WhoIsAway_GetsAnOpenFlaggedShift()
    {
        var nov22 = new DateOnly(2026, 11, 22);
        var nov23 = new DateOnly(2026, 11, 23);
        await using var f = await SetUpAsync(weeksStarted: false);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, end: nov22);
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, default)).Status);
        var ben = f.Db.Users.Add(new User
        {
            Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Ben", LastName = "Turner", Username = "ben", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        }).Entity;
        foreach (var pattern in await f.Db.ShiftPatterns.Where(p => p.SourceDraftId == v1.Id).ToListAsync()) pattern.DefaultUserId = ben.Id;
        f.Db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), TenantId = TenantA, UserId = ben.Id, LeaveType = LeaveType.Annual, StartDate = nov23, EndDate = nov23, Status = LeaveStatus.Approved,
            RequestedByUserId = ben.Id, RequestedAt = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc),
        });
        Start(f, nov23);
        await f.Db.SaveChangesAsync();
        var renewal = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, start: nov23, end: new DateOnly(2027, 1, 3));

        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, renewal.Id, false, Admin, default)).Status);
        await PopulateAllAsync(f.Service, f.ParticipantId, renewal.Id);

        var made = await f.Db.Shifts.AsNoTracking().Where(s => s.ServiceDate >= nov23).OrderBy(s => s.ServiceDate).ToListAsync();
        Assert.Equal(Weekdays(nov23), made.Select(s => s.ServiceDate));
        Assert.Equal(((Guid?)null, (Guid?)ben.Id, "on approved leave"), (made[0].UserId, made[0].RegularUserId, made[0].RegularAwayReason));
        Assert.All(made.Skip(1), s => Assert.Equal(ben.Id, s.UserId));
    }

    private static async Task AddPatternShiftAsync(Fixture f, bool fromAgreement)
    {
        var pattern = RosterStartWeekTests.Pattern(f.Db, Guid.NewGuid(), DayOfWeek.Tuesday, fromAgreement: fromAgreement);
        f.Db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = Guid.NewGuid(), ShiftPatternId = pattern.Id, ServiceDate = new DateOnly(2026, 10, 20),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        });
        await f.Db.SaveChangesAsync();
    }

    [Fact]
    public async Task AWeekStartedOnlyByAnAgreementPatternShift_IsFilledToo()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        await AddPatternShiftAsync(f, fromAgreement: true);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (toAdd, result, _) = await ApproveThenPopulateAsync(f, draft);

        Assert.Equal(Weekdays(new DateOnly(2026, 10, 19)), await ShiftDaysAsync(f));
        Assert.Equal((5, 5), (result.Created, toAdd));
    }

    [Fact]
    public async Task AWeekHoldingOnlyAHandMadePatternShift_IsNotFilled()
    {
        await using var f = await SetUpAsync(weeksStarted: false);
        await AddPatternShiftAsync(f, fromAgreement: false);
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var (toAdd, result, _) = await ApproveThenPopulateAsync(f, draft);

        Assert.Empty(await ShiftDaysAsync(f));
        Assert.Equal((0, 0), (result.Created, toAdd));
    }

    [Fact]
    public async Task ThePreview_SaysNothingAboutADailyTopUp()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var preview = (await f.Service.PreviewAsync(TenantA, f.ParticipantId, draft.Id, Admin, default)).Preview!;

        Assert.DoesNotContain("topUpEnabled", JsonSerializer.Serialize(preview, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
    }

    [Fact]
    public async Task TheNotReadyNote_TellsHowShiftsAreMadeNow()
    {
        await using var f = await SetUpAsync(active: false, firstName: "Jordan");
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, draft);

        var preview = (await f.Service.PopulatePreviewAsync(TenantA, f.ParticipantId, draft.Id, default))!;

        Assert.Equal("No shifts are made now, because Jordan is not active yet. Once they are, each week started on the roster includes them; use Generate on their shift patterns for weeks already started.", preview.Note);
        Assert.Empty(preview.Weeks);
    }
}
