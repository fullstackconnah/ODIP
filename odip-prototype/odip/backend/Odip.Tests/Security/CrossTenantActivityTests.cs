using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// The activity library is per organisation: an organisation lists, creates and edits only its own activities. The two ids a request can carry into the library (an activity's event template, and a
/// scheduled activity's activity) are checked against the caller's own organisation, the same as an id in the route. Neither has to be active: editing an old trip re-sends the id of an
/// activity that has since been deactivated.
/// </summary>
public class CrossTenantActivityTests
{
    private static ActivitiesController Activities(OdipDbContext db) => new(db);
    private static TripDayScheduleController Days(OdipDbContext db) => new(db);

    private static CreateActivityDto NewActivity(Guid? eventTemplateId = null) =>
        new() { ActivityName = "Picnic", Category = ActivityCategory.Leisure, EventTemplateId = eventTemplateId };

    private static ScheduledActivity ScheduledActivityOn(OdipDbContext db, Guid tenantId, Guid? activityId = null)
    {
        var trip = Trip(db, tenantId);
        var day = new TripDay { Id = Guid.NewGuid(), TripInstanceId = trip.Id, DayNumber = 1, Date = trip.StartDate };
        var scheduled = new ScheduledActivity { Id = Guid.NewGuid(), TripDayId = day.Id, ActivityId = activityId, Title = "Picnic" };
        db.AddRange(day, scheduled);
        db.SaveChanges();
        return scheduled;
    }

    // ── the library itself ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetAll_ListsOnlyTheCallersActivities()
    {
        using var db = Db();
        var own = Activity(db, A, "Own picnic");
        Activity(db, B, "Foreign picnic");

        var result = await Activities(db).GetAll(CancellationToken.None);

        var listed = Assert.IsType<ApiResponse<List<ActivityDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(own.Id, Assert.Single(listed).Id);
    }

    [Fact]
    public async Task Update_ActivityOfAnotherTenant_Returns404_AndChangesNothing()
    {
        using var db = Db();
        var foreign = Activity(db, B, "Original");

        var result = await Activities(db).Update(foreign.Id, new UpdateActivityDto { ActivityName = "Hijacked", Category = ActivityCategory.Dining }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal("Original", (await db.Activities.IgnoreQueryFilters().AsNoTracking().SingleAsync(a => a.Id == foreign.Id)).ActivityName);
    }

    [Fact]
    public async Task Create_StampsTheCallersTenant()
    {
        using var db = Db();

        var result = await Activities(db).Create(NewActivity(), CancellationToken.None);

        var id = Assert.IsType<ApiResponse<ActivityDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Id;
        Assert.Equal(A, (await db.Activities.IgnoreQueryFilters().AsNoTracking().SingleAsync(a => a.Id == id)).TenantId);
    }

    [Fact]
    public async Task OwnActivity_CanBeEdited_AndStaysInItsOrganisation()
    {
        using var db = Db();
        var own = Activity(db, A, "Original");

        var result = await Activities(db).Update(own.Id, new UpdateActivityDto { ActivityName = "Renamed", Category = ActivityCategory.Dining }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        var saved = await db.Activities.IgnoreQueryFilters().AsNoTracking().SingleAsync(a => a.Id == own.Id);
        Assert.Equal(("Renamed", A), (saved.ActivityName, saved.TenantId));
    }

    // ── who may write ──────────────────────────────────────────────────────────────────────────

    public static TheoryData<string> WriteActions => new() { nameof(ActivitiesController.Create), nameof(ActivitiesController.Update) };

    private static bool Allows(string action, string role)
    {
        var attr = typeof(ActivitiesController).GetMethod(action)!
            .GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>().Single();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        return attr.Roles!.Split(',').Any(r => principal.IsInRole(r.Trim()));
    }

    [Theory, MemberData(nameof(WriteActions))]
    public void Writes_AreOpenToAdminCoordinatorAndSuperAdmin_AndToNoOneElse(string action)
    {
        foreach (var role in new[] { "Admin", "Coordinator", "SuperAdmin" })
            Assert.True(Allows(action, role), role);
        foreach (var role in new[] { "SupportWorker", "ReadOnly" })
            Assert.False(Allows(action, role), role);
    }

    [Fact]
    public void Reads_StayOpenToEverySignedInUser()
    {
        Assert.Empty(typeof(ActivitiesController).GetMethod(nameof(ActivitiesController.GetAll))!.GetCustomAttributes(typeof(AuthorizeAttribute), false));
        Assert.Single(typeof(ActivitiesController).GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>(), a => a.Roles is null);
    }

    // ── an activity's event template ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_EventTemplateOfAnotherTenant_Returns400_AndWritesNothing()
    {
        using var db = Db();
        var foreignTemplate = EventTemplate(db, B);

        var result = await Activities(db).Create(NewActivity(foreignTemplate.Id), CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ActivityDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal("Event template not found.", Assert.Single(body.Errors!));
        Assert.Empty(await db.Activities.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Update_EventTemplateOfAnotherTenant_Returns400_AndKeepsTheTemplate()
    {
        using var db = Db();
        var ownTemplate = EventTemplate(db, A);
        var activity = Activity(db, A);
        activity.EventTemplateId = ownTemplate.Id;
        db.SaveChanges();
        var foreignTemplate = EventTemplate(db, B);

        var result = await Activities(db).Update(activity.Id, new UpdateActivityDto { ActivityName = activity.ActivityName, EventTemplateId = foreignTemplate.Id }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(ownTemplate.Id, (await db.Activities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).EventTemplateId);
    }

    [Fact]
    public async Task Activity_OwnEventTemplate_StillCreatesAndUpdates_EvenOnceDeactivated()
    {
        using var db = Db();
        var template = EventTemplate(db, A);
        var controller = Activities(db);

        var created = await controller.Create(NewActivity(template.Id), CancellationToken.None);
        var id = Assert.IsType<ApiResponse<ActivityDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.Id;

        template.IsActive = false;
        db.SaveChanges();
        var updated = await controller.Update(id, new UpdateActivityDto { ActivityName = "Picnic", EventTemplateId = template.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
        Assert.Equal(template.Id, (await db.Activities.AsNoTracking().SingleAsync(a => a.Id == id)).EventTemplateId);
    }

    // ── a scheduled activity's activity ────────────────────────────────────────────────────────

    [Fact]
    public async Task ScheduledActivityAdd_ActivityOfAnotherTenant_Returns400_AndWritesNothing()
    {
        using var db = Db();
        var scheduled = ScheduledActivityOn(db, A);
        var foreign = Activity(db, B);

        var result = await Days(db).AddActivity(scheduled.TripDayId, new CreateScheduledActivityDto { Title = "Picnic", ActivityId = foreign.Id }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<ScheduledActivityDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal("Activity not found.", Assert.Single(body.Errors!));
        Assert.Single(await db.ScheduledActivities.ToListAsync());
    }

    [Fact]
    public async Task ScheduledActivityUpdate_ActivityOfAnotherTenant_Returns400_AndKeepsTheActivity()
    {
        using var db = Db();
        var own = Activity(db, A);
        var scheduled = ScheduledActivityOn(db, A, own.Id);
        var foreign = Activity(db, B);

        var result = await Days(db).UpdateActivity(scheduled.Id, new UpdateScheduledActivityDto { Title = "Picnic", ActivityId = foreign.Id }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(own.Id, (await db.ScheduledActivities.AsNoTracking().SingleAsync(s => s.Id == scheduled.Id)).ActivityId);
    }

    [Fact]
    public async Task ScheduledActivity_OwnActivity_StillAddsAndUpdates_EvenOnceDeactivated()
    {
        using var db = Db();
        var activity = Activity(db, A);
        var scheduled = ScheduledActivityOn(db, A);
        var controller = Days(db);

        var added = await controller.AddActivity(scheduled.TripDayId, new CreateScheduledActivityDto { Title = "Picnic", ActivityId = activity.Id }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<ScheduledActivityDto>>(Assert.IsType<OkObjectResult>(added.Result).Value).Data!.Id;

        activity.IsActive = false;
        db.SaveChanges();
        var updated = await controller.UpdateActivity(id, new UpdateScheduledActivityDto { Title = "Picnic", ActivityId = activity.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
        Assert.Equal(activity.Id, (await db.ScheduledActivities.AsNoTracking().SingleAsync(s => s.Id == id)).ActivityId);
    }

    [Fact]
    public async Task ScheduledActivity_WithNoActivity_StillAddsAndUpdates()
    {
        using var db = Db();
        var scheduled = ScheduledActivityOn(db, A);
        var controller = Days(db);

        var added = await controller.AddActivity(scheduled.TripDayId, new CreateScheduledActivityDto { Title = "Free time" }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<ScheduledActivityDto>>(Assert.IsType<OkObjectResult>(added.Result).Value).Data!.Id;
        var updated = await controller.UpdateActivity(id, new UpdateScheduledActivityDto { Title = "Free time, later" }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
    }
}
