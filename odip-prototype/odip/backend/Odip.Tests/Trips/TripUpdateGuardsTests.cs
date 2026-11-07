using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// The trip edit form's PUT goes through the same status rules as PATCH (the pre-departure gate, the claims task on Completion), a body without a status
/// leaves the status alone.
/// </summary>
public class TripUpdateGuardsTests
{
    private static TripsController Controller(OdipDbContext db) => new(db, Mock.Of<ILogger<TripsController>>());

    private static TripInstance Seed(OdipDbContext db, TripStatus status)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Gold Coast", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, Status = status };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static UpdateTripDto Put(TripInstance t, TripStatus? status, int? min = null, int? max = null) => new()
    {
        TripName = t.TripName, StartDate = t.StartDate, DurationDays = t.DurationDays, Status = status, MinParticipants = min, MaxParticipants = max,
    };

    [Fact]
    public async Task APutWithNoStatus_LeavesTheStatusAlone()
    {
        using var db = TestDb.Create();
        var trip = Seed(db, TripStatus.Confirmed);

        Assert.IsType<OkObjectResult>((await Controller(db).Update(trip.Id, Put(trip, null), CancellationToken.None)).Result);

        Assert.Equal(TripStatus.Confirmed, (await db.TripInstances.FindAsync(trip.Id))!.Status);
    }

    [Fact]
    public async Task APutToInProgress_WithoutStaffAndBookings_GetsThePatchRefusal_AndDoesNotSave()
    {
        using var db = TestDb.Create();
        var trip = Seed(db, TripStatus.Confirmed);

        var result = await Controller(db).Update(trip.Id, Put(trip, TripStatus.InProgress), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Pre-departure gate failed: at least one confirmed staff assignment is required; at least one confirmed participant booking is required",
            Assert.IsType<ApiResponse<TripDetailDto>>(bad.Value).Errors![0]);
        Assert.Equal(TripStatus.Confirmed, (await db.TripInstances.FindAsync(trip.Id))!.Status);
    }

    [Fact]
    public async Task APutToCompleted_AddsTheClaimsTaskOnce_AndASecondPutAddsNone()
    {
        using var db = TestDb.Create();
        var trip = Seed(db, TripStatus.InProgress);
        var controller = Controller(db);

        await controller.Update(trip.Id, Put(trip, TripStatus.Completed), CancellationToken.None);
        await controller.Update(trip.Id, Put(trip, TripStatus.Completed), CancellationToken.None);

        Assert.Equal(TripStatus.Completed, (await db.TripInstances.FindAsync(trip.Id))!.Status);
        Assert.Equal(1, await db.BookingTasks.CountAsync(b => b.TripInstanceId == trip.Id && b.TaskType == TaskType.GenerateNdisClaims));
    }
}
