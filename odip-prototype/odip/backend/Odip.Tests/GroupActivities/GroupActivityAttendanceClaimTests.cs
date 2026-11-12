using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>A didn't-attend shift is an ordinary cancelled shift to the Claims hub: offered as a short-notice cancellation, priced by the existing rules, and locked against undo once it is on a claim.</summary>
public class GroupActivityAttendanceClaimTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static DateOnly Today => DateOnly.FromDateTime(DateTime.UtcNow);

    private sealed class Rig : IDisposable
    {
        public LedgerKit Kit { get; } = LedgerKit.Create();
        public ShiftClaimGenerationService Engine { get; }
        public GroupActivity Activity { get; }

        public Rig()
        {
            Kit.SeedProvider("NSW").TimeZoneId = "Australia/Sydney";
            Kit.EnsureCommunityAccessCatalogue();
            foreach (var item in Kit.Db.SupportCatalogueItems) item.ShortNoticeCancellation = CatalogueClaimFlag.Yes;
            Kit.Db.AppSettings.Add(new AppSettings { Id = Guid.NewGuid(), TenantId = Kit.TenantId, GroupActivitiesEnabled = true });
            Activity = new GroupActivity { Id = Guid.NewGuid(), TenantId = Kit.TenantId, ServiceDate = Today, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.InProgress };
            Kit.Db.GroupActivities.Add(Activity);
            Kit.Db.SaveChanges();
            Engine = new ShiftClaimGenerationService(Kit.Db, Kit.Ledger, Kit.Tenant);
        }

        public (Participant Person, List<Shift> Shifts) Person(SupportRatio ratio)
        {
            var person = Kit.SeedParticipant();
            var shifts = Enumerable.Range(0, ratio == SupportRatio.TwoToOne ? 2 : 1).Select(_ =>
            {
                var s = Kit.SeedShift(person, Today, ShiftStatus.Published, 9, 12);
                s.Ratio = ratio;
                s.GroupActivityId = Activity.Id;
                return s;
            }).ToList();
            Kit.Db.SaveChanges();
            return (person, shifts);
        }

        /// <summary>A group line is claimed only once its activity can no longer change (GCH-D1).</summary>
        public void SetStatus(ShiftStatus status)
        {
            Activity.Status = status;
            Kit.Db.SaveChanges();
        }

        public GroupActivitiesController Controller()
        {
            var controller = new GroupActivitiesController(Kit.Db, Kit.Tenant!, new StaffUnavailabilityQuery(Kit.Db));
            controller.ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin")], "test")) } };
            return controller;
        }

        public Task<ActionResult<ApiResponse<GroupActivityDto>>> Mark(Guid personId, bool attended) =>
            Controller().SetAttendance(Activity.Id, personId, new SetAttendanceDto { Attended = attended }, Ct);

        public void Dispose() => Kit.Dispose();
    }

    [Fact]
    public async Task DidNotAttend_IsOfferedAndClaimedAsAnOrdinaryCancellation()
    {
        using var rig = new Rig();
        var (person, shifts) = rig.Person(SupportRatio.OneToOne);
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);

        rig.SetStatus(ShiftStatus.Completed);
        var offered = await rig.Engine.CancellationCandidatesAsync(rig.Kit.TenantId, Today.AddDays(1), Ct);
        Assert.Equal([shifts[0].Id], offered.Shifts.Select(s => s.ShiftId));
        var made = await rig.Engine.GenerateCancellationAsync(shifts[0].Id, "NSDT", Today.AddDays(1), Ct);
        var line = await rig.Kit.Db.ClaimLineItems.SingleAsync(l => l.TripClaimId == made.Claim.Id, Ct);
        Assert.Equal(shifts[0].Id, line.ShiftId);
        Assert.Equal("NSDT", line.CancellationReason);
    }

    [Fact]
    public async Task DidNotAttend_StoresTheParticipantDidNotAttendReason_AndUndoClearsIt()
    {
        using var rig = new Rig();
        var (person, shifts) = rig.Person(SupportRatio.OneToOne);
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        Assert.Equal(ShiftCancellationReason.ParticipantDidNotAttend, (await rig.Kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shifts[0].Id, Ct)).CancellationReason);

        GroupActivityFixture.Body(await rig.Mark(person.Id, true), 200);
        var reopened = await rig.Kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shifts[0].Id, Ct);
        Assert.Equal(ShiftStatus.Published, reopened.Status);
        Assert.Null(reopened.CancellationReason);
    }

    [Fact]
    public async Task DidNotAttend_TwoToOne_GivesTwoCandidates_EachClaimableOnce()
    {
        using var rig = new Rig();
        var (person, shifts) = rig.Person(SupportRatio.TwoToOne);
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);

        rig.SetStatus(ShiftStatus.Completed);
        var offered = await rig.Engine.CancellationCandidatesAsync(rig.Kit.TenantId, Today.AddDays(1), Ct);
        Assert.Equal(shifts.Select(s => s.Id).Order(), offered.Shifts.Select(s => s.ShiftId).Order());
        foreach (var s in shifts)
        {
            await rig.Engine.GenerateCancellationAsync(s.Id, "NSDT", Today.AddDays(1), Ct);
            await Assert.ThrowsAsync<InvalidOperationException>(() => rig.Engine.GenerateCancellationAsync(s.Id, "NSDT", Today.AddDays(1), Ct));
        }
    }

    [Fact]
    public async Task Undo_WhenTheNoShowIsOnACancellationClaim_Refused()
    {
        using var rig = new Rig();
        var (person, shifts) = rig.Person(SupportRatio.OneToOne);
        GroupActivityFixture.Body(await rig.Mark(person.Id, false), 200);
        rig.SetStatus(ShiftStatus.Completed);
        await rig.Engine.GenerateCancellationAsync(shifts[0].Id, "NSDT", Today.AddDays(1), Ct);
        rig.SetStatus(ShiftStatus.InProgress);

        Assert.Equal("SHIFT_CLAIM_LOCKED", GroupActivityFixture.Error(await rig.Mark(person.Id, true), 409));
        Assert.Equal(ShiftStatus.Cancelled, (await rig.Kit.Db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shifts[0].Id, Ct)).Status);
    }
}
