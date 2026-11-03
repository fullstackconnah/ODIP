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
}
