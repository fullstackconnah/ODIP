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
