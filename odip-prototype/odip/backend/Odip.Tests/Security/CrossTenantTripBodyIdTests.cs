using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
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
/// A trip's event template comes from the request body and is checked against the caller's own organisation (EventTemplates is tenant-filtered), the same as an id in the route. It is not
/// required to be active: editing an old trip re-sends the id of a template that has since been deactivated.
/// </summary>
public class CrossTenantTripBodyIdTests
{
    private static TripsController Trips(OdipDbContext db) => new(db, NullLogger<TripsController>.Instance);

    // ── trips: EventTemplateId ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task TripCreate_EventTemplateOfAnotherTenant_Returns400_AndWritesNothing()
    {
        using var db = Db();
        var foreignTemplate = EventTemplate(db, B);

        var result = await Trips(db).Create(new CreateTripDto { TripName = "Beach", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, EventTemplateId = foreignTemplate.Id }, CancellationToken.None);

        var body = Assert.IsType<ApiResponse<TripDetailDto>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Equal("Event template not found.", Assert.Single(body.Errors!));
        Assert.Empty(await db.TripInstances.ToListAsync());
    }

    [Fact]
    public async Task TripUpdate_EventTemplateOfAnotherTenant_Returns400_AndKeepsTheTemplate()
    {
        using var db = Db();
        var ownTemplate = EventTemplate(db, A);
        var trip = Trip(db, A);
        trip.EventTemplateId = ownTemplate.Id;
        db.SaveChanges();
        var foreignTemplate = EventTemplate(db, B);

        var result = await Trips(db).Update(trip.Id, new UpdateTripDto { TripName = trip.TripName, StartDate = trip.StartDate, DurationDays = trip.DurationDays, EventTemplateId = foreignTemplate.Id }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(ownTemplate.Id, (await db.TripInstances.AsNoTracking().SingleAsync(t => t.Id == trip.Id)).EventTemplateId);
    }

    [Fact]
    public async Task Trip_OwnEventTemplate_StillCreatesAndUpdates_EvenOnceDeactivated()
    {
        using var db = Db();
        var template = EventTemplate(db, A);
        var controller = Trips(db);

        var created = await controller.Create(new CreateTripDto { TripName = "Beach", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, EventTemplateId = template.Id }, CancellationToken.None);
        var id = Assert.IsType<ApiResponse<TripDetailDto>>(Assert.IsType<CreatedAtActionResult>(created.Result).Value).Data!.Id;

        // Editing an old trip re-sends the id of a template that has since been deactivated; that must keep working.
        template.IsActive = false;
        db.SaveChanges();
        var updated = await controller.Update(id, new UpdateTripDto { TripName = "Beach", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, EventTemplateId = template.Id }, CancellationToken.None);

        Assert.IsType<OkObjectResult>(updated.Result);
        Assert.Equal(template.Id, (await db.TripInstances.AsNoTracking().SingleAsync(t => t.Id == id)).EventTemplateId);
    }
}
