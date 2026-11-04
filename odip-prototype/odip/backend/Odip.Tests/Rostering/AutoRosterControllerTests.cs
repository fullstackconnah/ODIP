using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>POST weeks/{weekStart}/auto-roster (R7 PR1): a read-only draft for the caller's own organisation.</summary>
public class AutoRosterControllerTests
{
    private static readonly DateOnly Monday = new(2026, 11, 2);

    private static User Staff(OdipDbContext db, string name, Guid tenantId) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    private static (Participant Person, Shift Shift) OpenShift(OdipDbContext db, string name, Guid tenantId)
    {
        var person = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = name, LastName = "Test", IsActive = true }).Entity;
        var shift = db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = person.Id, ServiceDate = Monday.AddDays(1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft, ShiftPatternId = Guid.NewGuid(),
        }).Entity;
        return (person, shift);
    }

    private static RosteringController Controller(OdipDbContext db, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Odip.Tests.Medications.FakeClock.AtUtc(2026, 11, 1, 2, 0), tenant: tenant.Object);
    }

    [Fact]
    public async Task AutoRoster_ReturnsADraft_AndSavesNothing()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, shift) = OpenShift(db, "Mia", TenantA);
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>((await Controller(db, TenantA).AutoRoster(Monday.AddDays(2), default)).Result);
        var draft = Assert.IsType<ApiResponse<AutoRosterDraftDto>>(ok.Value).Data!;

        Assert.Equal(Monday, draft.WeekStart);
        Assert.Equal(pat.Id, Assert.Single(draft.Changes).StaffId);
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id)).UserId);
        Assert.False(db.ChangeTracker.HasChanges());
    }

    [Fact]
    public async Task AutoRoster_NeverReadsAnotherOrganisationsStaffOrShifts()
    {
        using var db = TestDb.Create(); // no tenant filter: only the controller's explicit TenantId predicates keep the organisations apart
        var a = Staff(db, "Ava", TenantA);
        var b = Staff(db, "Ben", TenantB);
        var (mia, _) = OpenShift(db, "Mia", TenantA);
        OpenShift(db, "Zoe", TenantB);
        // Ben is listed Preferred for Mia, an organisation A participant: the listing must not pull him into A's pool.
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = TenantB, UserId = b.Id, ParticipantId = mia.Id, Level = CompatibilityLevel.Preferred, Rank = 1 });
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>((await Controller(db, TenantA).AutoRoster(Monday, default)).Result);
        var draft = Assert.IsType<ApiResponse<AutoRosterDraftDto>>(ok.Value).Data!;

        Assert.Equal(a.Id, Assert.Single(draft.Changes).StaffId);
        Assert.Equal([a.Id], draft.Hours.Select(h => h.StaffId));
        Assert.Empty(draft.Uncovered);
    }

    [Fact]
    public async Task AutoRoster_WithNoOrganisationOnTheRequest_Is400()
    {
        using var db = TestDb.Create();

        Assert.IsType<BadRequestObjectResult>((await Controller(db, null).AutoRoster(Monday, default)).Result);
    }

    [Fact]
    public void AutoRoster_IsAPost_UnderTheCoordinatorAndAboveClassPolicy()
    {
        var action = typeof(RosteringController).GetMethod(nameof(RosteringController.AutoRoster))!;

        Assert.Equal("weeks/{weekStart}/auto-roster", action.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Null(action.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(action.GetCustomAttribute<AuthorizeAttribute>());
        var roles = typeof(RosteringController).GetCustomAttribute<AuthorizeAttribute>()!.Roles!;
        Assert.Contains("Coordinator", roles);
        Assert.DoesNotContain("SupportWorker", roles);
    }

    private static RosteringController AsRole(RosteringController c, string role)
    {
        c.ControllerContext = new ControllerContext { HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity([new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, role)], "test")) } };
        return c;
    }

    // Golden body captured on origin/main ffd9307c BEFORE the reach change: the default reach (3) must leave the draft byte-identical (compat PR 1b, check 14).
    private const string DefaultReachGolden = "{\"WeekStart\":\"2026-11-02\",\"GeneratedAt\":\"2026-11-01T02:00:00Z\",\"Changes\":[{\"ShiftId\":\"00000000-0000-0000-0000-0000000000c1\",\"ParticipantId\":\"00000000-0000-0000-0000-0000000000b1\",\"ParticipantName\":\"Mia Test\",\"ServiceDate\":\"2026-11-03\",\"StartTime\":\"09:00:00\",\"EndTime\":\"13:00:00\",\"StaffId\":\"00000000-0000-0000-0000-0000000000a1\",\"StaffName\":\"Pat Test\",\"Pick\":\"Preferred\",\"Rank\":1,\"UnderGoal\":true,\"Warnings\":[],\"Alternates\":[{\"StaffId\":\"00000000-0000-0000-0000-0000000000a2\",\"StaffName\":\"Quinn Test\",\"Pick\":\"Allowed\"}]}],\"Hours\":[{\"StaffId\":\"00000000-0000-0000-0000-0000000000a1\",\"StaffName\":\"Pat Test\",\"GoalHours\":19,\"GoalIsDefault\":true,\"RosteredHours\":0,\"DraftHours\":4},{\"StaffId\":\"00000000-0000-0000-0000-0000000000a2\",\"StaffName\":\"Quinn Test\",\"GoalHours\":19,\"GoalIsDefault\":true,\"RosteredHours\":0,\"DraftHours\":0}],\"Uncovered\":[],\"Splits\":[]}";

    private static User Fixed(Guid id, string name) => new()
    {
        Id = id, TenantId = TenantA, FirstName = name, LastName = "Test", Username = name, Email = $"{name}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    };

    [Fact]
    public async Task AutoRoster_AtTheDefaultReach_GivesTheBodyItAlwaysDid()
    {
        using var db = TestDb.Create();
        db.Users.Add(Fixed(Guid.Parse("00000000-0000-0000-0000-0000000000a1"), "Pat"));
        db.Users.Add(Fixed(Guid.Parse("00000000-0000-0000-0000-0000000000a2"), "Quinn"));
        var mia = db.Participants.Add(new Participant { Id = Guid.Parse("00000000-0000-0000-0000-0000000000b1"), TenantId = TenantA, FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
        db.Shifts.Add(new Shift
        {
            Id = Guid.Parse("00000000-0000-0000-0000-0000000000c1"), TenantId = TenantA, ParticipantId = mia.Id, ServiceDate = Monday.AddDays(1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft, ShiftPatternId = Guid.Parse("00000000-0000-0000-0000-0000000000d1"),
        });
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = TenantA, UserId = Guid.Parse("00000000-0000-0000-0000-0000000000a1"), ParticipantId = mia.Id, Level = CompatibilityLevel.Preferred, Rank = 1 });
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>((await Controller(db, TenantA).AutoRoster(Monday.AddDays(2), default)).Result);
        var options = new System.Text.Json.JsonSerializerOptions();
        Odip.Api.Serialization.ApiJsonOptions.Configure(options);
        var body = System.Text.Json.JsonSerializer.Serialize(Assert.IsType<ApiResponse<AutoRosterDraftDto>>(ok.Value).Data, options);

        Assert.Equal(DefaultReachGolden, body);
    }

    [Fact]
    public async Task AutoRoster_ReadsTheOrganisationsReach_AndFlagsTheAlternateBeyondIt()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var (mia, _) = OpenShift(db, "Mia", TenantA);
        db.StaffParticipantCompatibilities.Add(new StaffParticipantCompatibility { Id = Guid.NewGuid(), TenantId = TenantA, UserId = pat.Id, ParticipantId = mia.Id, Level = CompatibilityLevel.Preferred, Rank = 1 });
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantA, AutoRosterReach = 0 });
        db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = TenantB, AutoRosterReach = 3 });
        await db.SaveChangesAsync();

        var ok = Assert.IsType<OkObjectResult>((await Controller(db, TenantA).AutoRoster(Monday.AddDays(2), default)).Result);
        var change = Assert.Single(Assert.IsType<ApiResponse<AutoRosterDraftDto>>(ok.Value).Data!.Changes);

        Assert.Equal((pat.Id, false), (change.StaffId, change.NeedsLook));
        var alternate = Assert.Single(change.Alternates);
        Assert.Equal((quinn.Id, true), (alternate.StaffId, alternate.NeedsLook));
    }

    private static AutoRosterApplyDto Rows(params (Guid Shift, Guid Staff)[] rows) => new() { Rows = rows.Select(r => new AutoRosterApplyRowDto { ShiftId = r.Shift, StaffId = r.Staff }).ToList() };

    private static AutoRosterApplyResultDto Result(ActionResult<ApiResponse<AutoRosterApplyResultDto>> r) =>
        Assert.IsType<ApiResponse<AutoRosterApplyResultDto>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    [Theory]
    [InlineData("Coordinator")]
    [InlineData("Admin")]
    public async Task AutoRosterApply_AFreshDraftAppliedAtOnce_SkipsNothing(string role)   // draft and apply agree: any gap between the draft checks and the apply gate fails here
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, shift) = OpenShift(db, "Mia", TenantA);
        await db.SaveChangesAsync();
        var c = AsRole(Controller(db, TenantA), role);
        var draft = Assert.IsType<ApiResponse<AutoRosterDraftDto>>(Assert.IsType<OkObjectResult>((await c.AutoRoster(Monday, default)).Result).Value).Data!;

        var result = Result(await c.AutoRosterApply(Monday, Rows(draft.Changes.Select(x => (x.ShiftId, x.StaffId)).ToArray()), default));

        Assert.Empty(result.Skipped);
        Assert.Equal([shift.Id], result.Applied);
        Assert.Equal(pat.Id, (await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id)).UserId);
    }

    [Fact]
    public async Task AutoRosterApply_AShiftFilledSinceTheDraft_IsSkippedWithTheBoardChangedMessage_AndTheOthersApply()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var lee = Staff(db, "Lee", TenantA);
        var (_, taken) = OpenShift(db, "Mia", TenantA);
        var (_, open) = OpenShift(db, "Zoe", TenantA);
        taken.UserId = lee.Id;
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((taken.Id, pat.Id), (open.Id, pat.Id)), default));

        Assert.Equal([open.Id], result.Applied);
        var skipped = Assert.Single(result.Skipped);
        Assert.Equal(taken.Id, skipped.ShiftId);
        Assert.Equal("This shift changed after the board was loaded. Refresh the board and try again.", skipped.Message);
        Assert.Equal(lee.Id, (await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == taken.Id)).UserId);
    }

    [Fact]
    public async Task AutoRosterApply_ARowTheGateNowBlocks_IsSkipped_AndNothingOfItIsSaved()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, first) = OpenShift(db, "Mia", TenantA);
        var (_, second) = OpenShift(db, "Zoe", TenantA);   // the same hours: Pat cannot take both
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((first.Id, pat.Id), (second.Id, pat.Id)), default));

        Assert.Equal([first.Id], result.Applied);
        Assert.Equal(second.Id, Assert.Single(result.Skipped).ShiftId);
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == second.Id)).UserId);
    }

    [Fact]
    public async Task AutoRosterApply_NeverTouchesAnotherOrganisation()   // TestDb has no tenant filter: only the controller keeps the organisations apart
    {
        using var db = TestDb.Create();
        var a = Staff(db, "Ava", TenantA);
        var b = Staff(db, "Ben", TenantB);
        var (_, mine) = OpenShift(db, "Mia", TenantA);
        var (_, theirs) = OpenShift(db, "Zoe", TenantB);
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((theirs.Id, a.Id), (mine.Id, b.Id)), default));

        Assert.Empty(result.Applied);
        Assert.Equal(2, result.Skipped.Count);
        Assert.All(await db.Shifts.AsNoTracking().ToListAsync(), s => Assert.Null(s.UserId));
    }

    [Fact]
    public async Task AutoRosterApply_AShiftOutsideTheWeek_IsSkipped()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, shift) = OpenShift(db, "Mia", TenantA);
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday.AddDays(7), Rows((shift.Id, pat.Id)), default));

        Assert.Empty(result.Applied);
        Assert.Single(result.Skipped);
    }

    [Fact]
    public async Task AutoRosterApply_OverFiveHundredRows_Is400()
    {
        using var db = TestDb.Create();
        var rows = Enumerable.Range(0, 501).Select(_ => (Guid.NewGuid(), Guid.NewGuid())).ToArray();

        Assert.IsType<BadRequestObjectResult>((await Controller(db, TenantA).AutoRosterApply(Monday, Rows(rows), default)).Result);
    }

    [Fact]
    public async Task AutoRosterApply_WithNullRows_Is400()
    {
        using var db = TestDb.Create();

        var bad = Assert.IsType<BadRequestObjectResult>((await Controller(db, TenantA).AutoRosterApply(Monday, new AutoRosterApplyDto { Rows = null! }, default)).Result);
        Assert.False(Assert.IsType<ApiResponse<AutoRosterApplyResultDto>>(bad.Value).Success);
    }

    [Fact]
    public async Task AutoRosterApply_AShiftListedTwice_AppliesOnce_AndSkipsTheSecondAsListedTwice()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, shift) = OpenShift(db, "Mia", TenantA);
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((shift.Id, pat.Id), (shift.Id, pat.Id)), default));

        Assert.Equal([shift.Id], result.Applied);
        Assert.Equal("Listed twice.", Assert.Single(result.Skipped).Message);
    }

    [Fact]
    public async Task AutoRosterApply_OneWorkerOnTwoOverlappingShifts_AppliesTheFirst_AndLeavesTheSecondOpen()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, first) = OpenShift(db, "Mia", TenantA);
        var (_, second) = OpenShift(db, "Zoe", TenantA);   // same day and hours as the first
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((first.Id, pat.Id), (second.Id, pat.Id)), default));

        Assert.Equal([first.Id], result.Applied);
        Assert.Equal(second.Id, Assert.Single(result.Skipped).ShiftId);
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == second.Id)).UserId);
    }

    [Fact]
    public async Task AutoRosterApply_WithNoOrganisationOnTheRequest_Is400()
    {
        using var db = TestDb.Create();

        Assert.IsType<BadRequestObjectResult>((await Controller(db, null).AutoRosterApply(Monday, Rows(), default)).Result);
    }

    [Fact]
    public async Task AutoRosterApply_ToAPublishedShiftNotifiesTheWorker_AndToADraftShiftDoesNot()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var (_, published) = OpenShift(db, "Mia", TenantA);
        var (_, draft) = OpenShift(db, "Zoe", TenantA);
        published.Status = ShiftStatus.Published;
        published.StartTime = new TimeOnly(14, 0); published.EndTime = new TimeOnly(16, 0);   // clear of the draft shift, so Pat can take both
        await db.SaveChangesAsync();

        Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((draft.Id, pat.Id)), default));
        Assert.Empty(await db.NotificationOutbox.ToListAsync());
        Result(await Controller(db, TenantA).AutoRosterApply(Monday, Rows((published.Id, pat.Id)), default));
        Assert.Contains(await db.NotificationOutbox.ToListAsync(), o => o.EntityId == published.Id);
    }

    private static AutoRosterApplyDto OneSplit(Shift shift, double cutHour, Guid first, Guid second) => new()
    {
        Splits = [new() { ShiftId = shift.Id, StartTime = shift.StartTime, EndTime = shift.EndTime, CutAt = TimeOnly.FromTimeSpan(TimeSpan.FromHours(cutHour)), FirstStaffId = first, SecondStaffId = second }],
    };

    [Fact] // [D]
    public async Task AutoRosterApply_ASplit_CutsTheShift_MakesTheOtherHalf_AndKeepsHoursAndThePatternLink_AndAFreshDraftFindsNothingOpen()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var (person, shift) = OpenShift(db, "Mia", TenantA);
        shift.EndTime = new TimeOnly(17, 0);
        var pattern = shift.ShiftPatternId;
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, OneSplit(shift, 13, pat.Id, quinn.Id), default));

        Assert.Equal(new[] { shift.Id }, result.Applied);
        Assert.Empty(result.Skipped);
        var halves = await db.Shifts.AsNoTracking().Where(s => s.ParticipantId == person.Id).OrderBy(s => s.StartTime).ToListAsync();
        Assert.Equal(2, halves.Count);
        Assert.Equal((new TimeOnly(9, 0), new TimeOnly(13, 0), pat.Id), (halves[0].StartTime, halves[0].EndTime, halves[0].UserId));
        Assert.Equal((new TimeOnly(13, 0), new TimeOnly(17, 0), quinn.Id), (halves[1].StartTime, halves[1].EndTime, halves[1].UserId));
        Assert.Equal(8m, halves.Sum(h => h.DurationHours));
        Assert.All(halves, h => Assert.Equal((pattern, ShiftStatus.Draft, SupportRatio.OneToOne), (h.ShiftPatternId, h.Status, h.Ratio)));

        var draft = Assert.IsType<ApiResponse<AutoRosterDraftDto>>(Assert.IsType<OkObjectResult>((await Controller(db, TenantA).AutoRoster(Monday, default)).Result).Value).Data!;
        Assert.Empty(draft.Changes);
        Assert.Empty(draft.Splits);
        Assert.Empty(draft.Uncovered);
    }

    [Fact] // [D]
    public async Task AutoRosterApply_ASplitOfAPublishedShift_GivesAPublishedHalf_AndTellsBothWorkers()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var (person, shift) = OpenShift(db, "Mia", TenantA);
        shift.EndTime = new TimeOnly(17, 0);
        shift.Status = ShiftStatus.Published;
        await db.SaveChangesAsync();

        Result(await Controller(db, TenantA).AutoRosterApply(Monday, OneSplit(shift, 13, pat.Id, quinn.Id), default));

        var halves = await db.Shifts.AsNoTracking().Where(s => s.ParticipantId == person.Id).ToListAsync();
        Assert.All(halves, h => Assert.Equal(ShiftStatus.Published, h.Status));
        var told = await db.NotificationOutbox.ToListAsync();
        Assert.Equal(halves.Select(h => h.Id).Order(), told.Select(o => o.EntityId).Order());   // one notice per worker, one per half
    }

    [Fact] // [D]
    public async Task AutoRosterApply_ASplitThenARegenerate_LeavesTwoShiftsForThePatternAndDay()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var (person, shift) = OpenShift(db, "Mia", TenantA);
        shift.EndTime = new TimeOnly(17, 0);
        db.ShiftPatterns.Add(new ShiftPattern
        {
            Id = shift.ShiftPatternId!.Value, TenantId = TenantA, ParticipantId = person.Id, DayOfWeek = shift.ServiceDate.DayOfWeek, StartTime = shift.StartTime, EndTime = shift.EndTime,
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, EffectiveFrom = Monday, EffectiveTo = Monday.AddDays(60), IsActive = true,
        });
        await db.SaveChangesAsync();
        Result(await Controller(db, TenantA).AutoRosterApply(Monday, OneSplit(shift, 13, pat.Id, quinn.Id), default));

        await new RosterShiftGenerator().GenerateAsync(db, person.Id, new[] { shift.ShiftPatternId!.Value }, Monday, Monday.AddDays(6), default);

        Assert.Equal(2, await db.Shifts.CountAsync(s => s.ShiftPatternId == shift.ShiftPatternId && s.ServiceDate == shift.ServiceDate));
    }

    [Fact] // [D]
    public async Task AutoRosterApply_ASplitOfAnotherOrganisationsShift_IsSkipped_AndNothingIsWritten()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var theirStaff = Staff(db, "Zed", TenantB);
        var (_, theirs) = OpenShift(db, "Zoe", TenantB);
        theirs.EndTime = new TimeOnly(17, 0);
        await db.SaveChangesAsync();
        var c = Controller(db, TenantA);

        var shiftNotFound = Result(await c.AutoRosterApply(Monday, OneSplit(theirs, 13, pat.Id, quinn.Id), default));
        var staffNotFound = Result(await c.AutoRosterApply(Monday, OneSplit(theirs, 13, pat.Id, theirStaff.Id), default));

        Assert.Empty(shiftNotFound.Applied);
        Assert.Equal(theirs.Id, Assert.Single(shiftNotFound.Skipped).ShiftId);
        Assert.Empty(staffNotFound.Applied);
        Assert.Single(staffNotFound.Skipped);
        var rows = await db.Shifts.AsNoTracking().ToListAsync();
        Assert.Equal((theirs.Id, new TimeOnly(17, 0), (Guid?)null), (Assert.Single(rows).Id, rows[0].EndTime, rows[0].UserId));
    }

    [Fact]
    public async Task AutoRosterApply_ASplitOfAShiftEditedSinceTheDraft_IsSkippedAndLeftAsItIs()
    {
        using var db = TestDb.Create();
        var pat = Staff(db, "Pat", TenantA);
        var quinn = Staff(db, "Quinn", TenantA);
        var (_, shift) = OpenShift(db, "Mia", TenantA);
        shift.EndTime = new TimeOnly(17, 0);
        await db.SaveChangesAsync();
        var asDrafted = OneSplit(shift, 13, pat.Id, quinn.Id);
        shift.EndTime = new TimeOnly(15, 0);   // edited after the draft was made
        await db.SaveChangesAsync();

        var result = Result(await Controller(db, TenantA).AutoRosterApply(Monday, asDrafted, default));

        Assert.Empty(result.Applied);
        Assert.Equal(shift.Id, Assert.Single(result.Skipped).ShiftId);
        Assert.Equal(new TimeOnly(15, 0), Assert.Single(await db.Shifts.AsNoTracking().ToListAsync()).EndTime);
    }

    [Fact]
    public void AutoRosterApply_IsAPost_UnderTheCoordinatorAndAboveClassPolicy()
    {
        var action = typeof(RosteringController).GetMethod(nameof(RosteringController.AutoRosterApply))!;

        Assert.Equal("weeks/{weekStart}/auto-roster/apply", action.GetCustomAttribute<HttpPostAttribute>()!.Template);
        Assert.Null(action.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(action.GetCustomAttribute<AuthorizeAttribute>());
        var roles = typeof(RosteringController).GetCustomAttribute<AuthorizeAttribute>()!.Roles!;
        Assert.Contains("Coordinator", roles);
        Assert.DoesNotContain("SupportWorker", roles);
    }
}
