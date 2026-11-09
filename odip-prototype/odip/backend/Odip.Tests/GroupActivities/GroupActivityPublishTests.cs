using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications.Templates;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>Publish week and an activity's own Publish cover group activities and tell the people on them (gav PR B).</summary>
public class GroupActivityPublishTests
{
    private static readonly DateOnly Monday = GroupActivityFixture.Day;
    private sealed class Clock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    // Monday is 2026-11-16: Before is a week ahead of it, After is two days past it.
    private static readonly Clock Before = new(new DateTimeOffset(2026, 11, 10, 0, 0, 0, TimeSpan.Zero));
    private static readonly Clock After = new(new DateTimeOffset(2026, 11, 18, 0, 0, 0, TimeSpan.Zero));

    private static Mock<ICurrentTenant> TenantOf(GroupActivityFixture fx)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(fx.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant;
    }

    private static RosteringController Rostering(GroupActivityFixture fx, Clock clock)
    {
        var db = fx.Fresh();
        return new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), tenant: TenantOf(fx).Object, clock: clock);
    }

    private static async Task<PublishWeekResultDto> Publish(GroupActivityFixture fx, Clock clock, PublishShiftsRequest? body = null)
    {
        var result = Assert.IsType<OkObjectResult>((await Rostering(fx, clock).PublishWeek(Monday, default, body)).Result);
        return Assert.IsType<ApiResponse<PublishWeekResultDto>>(result.Value).Data!;
    }

    /// <summary>A Draft activity titled Bowling with one Draft participant shift and the given workers on it.</summary>
    private static GroupActivity Activity(GroupActivityFixture fx, params User[] workers)
    {
        var activity = fx.AddActivity();
        var shift = fx.AddShift(fx.AddParticipant());
        shift.GroupActivityId = activity.Id;
        foreach (var w in workers)
            fx.Seed.GroupActivityStaff.Add(new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = fx.TenantId, GroupActivityId = activity.Id, UserId = w.Id, StartTime = new TimeOnly(9, 30), EndTime = new TimeOnly(12, 30) });
        fx.Seed.SaveChanges();
        return activity;
    }

    private static Task<List<NotificationOutbox>> Outbox(GroupActivityFixture fx) => fx.Seed.NotificationOutbox.AsNoTracking().ToListAsync();

    [Fact]
    public async Task PublishWeek_TellsEachActivityWorkerOnce_WithTheActivityTitle()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var activity = Activity(fx, worker);
        var data = await Publish(fx, Before);
        Assert.Equal((1, 1), (data.Activities, data.Notified));
        var row = Assert.Single(await Outbox(fx));
        Assert.Equal(("GroupActivity", activity.Id, worker.Id, NotificationEventType.ShiftAssigned), (row.EntityType, row.EntityId, row.RecipientUserId, row.EventType));
        var payload = JsonSerializer.Deserialize<ShiftAssignedPayload>(row.PayloadJson)!;
        Assert.Equal(("Bowling", Monday, new TimeOnly(9, 30), new TimeOnly(12, 30)), (payload.ParticipantName, payload.ServiceDate, payload.StartTime, payload.EndTime));
    }

    [Fact]
    public async Task PublishWeek_GivesAWorkerWithAShiftAndAnActivity_OneNotice_EarliestFirst()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var shift = fx.AddShift(fx.AddParticipant("Sam"), userId: worker.Id, day: Monday.AddDays(1));
        Activity(fx, worker);
        var data = await Publish(fx, Before);
        Assert.Equal(1, data.Notified);
        var row = Assert.Single(await Outbox(fx));
        Assert.Equal(("Shift", shift.Id), (row.EntityType, row.EntityId));
        var payload = JsonSerializer.Deserialize<ShiftAssignedPayload>(row.PayloadJson)!;
        Assert.Equal("Bowling", payload.ParticipantName);
        Assert.Equal("Sam Test", Assert.Single(payload.MoreShifts!).ParticipantName);
    }

    [Fact]
    public async Task PublishWeek_KeepsARegularShiftNoticeExactlyAsItWas()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var first = fx.AddShift(fx.AddParticipant("Sam"), userId: worker.Id);
        fx.AddShift(fx.AddParticipant("Ann"), userId: worker.Id, day: Monday.AddDays(1));
        await Publish(fx, Before);
        var row = Assert.Single(await Outbox(fx));
        Assert.Equal(("Shift", first.Id), (row.EntityType, row.EntityId));
        var expected = new ShiftAssignedPayload(worker.Email, "Sam Test", Monday, new TimeOnly(10, 0), new TimeOnly(12, 0),
            new[] { new ShiftAssignedLine("Ann Test", Monday.AddDays(1), new TimeOnly(10, 0), new TimeOnly(12, 0)) });
        Assert.Equal(JsonSerializer.Serialize(expected), row.PayloadJson);
    }

    [Fact]
    public async Task PublishWeek_SwitchOff_LeavesActivitiesAndTheirShiftsDraft()
    {
        var fx = new GroupActivityFixture(enabled: false);
        var activity = Activity(fx, fx.AddUser());
        var data = await Publish(fx, Before);
        Assert.Equal((0, 0, 0), (data.Activities, data.Published, data.Notified));
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).Status);
        Assert.All(await fx.Seed.Shifts.AsNoTracking().ToListAsync(), s => Assert.Equal(ShiftStatus.Draft, s.Status));
        Assert.Empty(await Outbox(fx));
    }

    [Fact]
    public async Task PublishWeek_PastDayActivity_IsPublishedButNobodyIsTold()
    {
        var fx = new GroupActivityFixture();
        var activity = Activity(fx, fx.AddUser());
        var data = await Publish(fx, After);
        Assert.Equal((1, 0), (data.Activities, data.Notified));
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).Status);
        Assert.Empty(await Outbox(fx));
    }

    [Fact]
    public async Task PublishWeek_ArchivedBlockedAndOtherTenantWorkers_AreNotTold_ButTheActivityStillGoesOut()
    {
        var fx = new GroupActivityFixture();
        var archived = fx.AddUser("Arch", active: false);
        var lapsed = fx.AddUser("Lapsed");
        lapsed.WorkerScreeningExpiryDate = Monday.AddDays(-1);
        var foreign = fx.AddUser("Foreign", tenantId: Guid.NewGuid());
        var okay = fx.AddUser("Okay");
        fx.Seed.SaveChanges();
        var activity = Activity(fx, archived, lapsed, foreign, okay);
        var data = await Publish(fx, Before);
        Assert.Equal((1, 1), (data.Activities, data.Notified));
        Assert.Equal(okay.Id, Assert.Single(await Outbox(fx)).RecipientUserId);
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).Status);
    }

    [Fact]
    public async Task PublishWeek_CancelledActivity_IsUntouched_AndWorkerlessOneTellsNobodyAndIsNotUnfilled()
    {
        var fx = new GroupActivityFixture();
        var cancelled = Activity(fx, fx.AddUser());
        (await fx.Seed.GroupActivities.SingleAsync()).Status = ShiftStatus.Cancelled;
        await fx.Seed.SaveChangesAsync();
        var workerless = Activity(fx);
        var data = await Publish(fx, Before);
        Assert.Equal((1, 0, 0), (data.Activities, data.Notified, data.Unfilled));
        Assert.Equal(ShiftStatus.Cancelled, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == cancelled.Id)).Status);
        Assert.Equal(ShiftStatus.Published, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == workerless.Id)).Status);
        Assert.Empty(await Outbox(fx));
    }

    [Fact]
    public async Task PublishWeek_SelectModeIgnoresActivities_AndARepeatTellsNobodyNew()
    {
        var fx = new GroupActivityFixture();
        var shift = fx.AddShift(fx.AddParticipant(), userId: fx.AddUser().Id, day: Monday.AddDays(2));
        Activity(fx, fx.AddUser());
        var selected = await Publish(fx, Before, new PublishShiftsRequest { ShiftIds = [shift.Id] });
        Assert.Equal(0, selected.Activities);
        Assert.Equal(ShiftStatus.Draft, (await fx.Seed.GroupActivities.AsNoTracking().SingleAsync()).Status);
        Assert.Equal(1, (await Publish(fx, Before)).Activities);
        var count = (await Outbox(fx)).Count;
        var again = await Publish(fx, Before);
        Assert.Equal((0, 0), (again.Activities, again.Notified));
        Assert.Equal(count, (await Outbox(fx)).Count);
    }

    [Fact]
    public async Task ActivityModalPublish_TellsTheWorkersThroughTheSameHelper_OnlyOnce()
    {
        var fx = new GroupActivityFixture();
        var worker = fx.AddUser();
        var activity = Activity(fx, worker);
        var db = fx.Fresh();
        var controller = new GroupActivitiesController(db, TenantOf(fx).Object, new StaffUnavailabilityQuery(db), clock: Before)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Admin")], "test")) } },
        };
        var dto = new UpdateGroupActivityDto { ServiceDate = Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.Published };
        GroupActivityFixture.Body(await controller.Update(activity.Id, dto, default), 200);
        var row = Assert.Single(await Outbox(fx));
        Assert.Equal(("GroupActivity", worker.Id), (row.EntityType, row.RecipientUserId));
        GroupActivityFixture.Body(await controller.Update(activity.Id, dto, default), 200);
        Assert.Single(await Outbox(fx));
    }
}
