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

/// <summary>A trip cannot be saved with a maximum under its minimum; equal, or a blank maximum, is fine.</summary>
public class TripSizeBoundsTests
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
    public async Task APutWithAMaximumUnderTheMinimum_Gets400_AndAnEqualPairSaves()
    {
        using var db = TestDb.Create();
        var trip = Seed(db, TripStatus.Draft);
        var controller = Controller(db);

        var result = await controller.Update(trip.Id, Put(trip, null, min: 5, max: 4), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("Maximum participants can't be less than the minimum.", Assert.IsType<ApiResponse<TripDetailDto>>(bad.Value).Errors![0]);
        Assert.IsType<OkObjectResult>((await controller.Update(trip.Id, Put(trip, null, min: 5, max: 5), CancellationToken.None)).Result);
        Assert.IsType<OkObjectResult>((await controller.Update(trip.Id, Put(trip, null, min: 5, max: null), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task ACreateWithAMaximumUnderTheMinimum_Gets400()
    {
        using var db = TestDb.Create();

        var result = await Controller(db).Create(new CreateTripDto { TripName = "x", StartDate = new DateOnly(2026, 9, 1), DurationDays = 1, MinParticipants = 5, MaxParticipants = 4 }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Empty(db.TripInstances);
    }
}
