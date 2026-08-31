using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Bookings;

/// <summary>
/// Controller-level coverage for <see cref="BookingsController"/> (the trip/booking API,
/// registered under <c>api/v1/bookings</c>) — same EF InMemory + Moq&lt;ICurrentTenant&gt;
/// pattern as RosteringControllerTests/MedicationsControllerTests. Focused on
/// <see cref="BookingsController.Create"/>'s participant-ref validation (INTAKE-08 fix round 1,
/// Finding 2): the endpoint previously did not validate <c>ParticipantId</c> existed at all —
/// closed as a byproduct of adding the draft exclusion, and this file is the coverage that gap
/// never had.
/// </summary>
public class BookingsControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static TripInstance SeedTrip(OdipDbContext db)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 9, 1),
            DurationDays = 3, Status = TripStatus.Planning,
        };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static Participant SeedParticipant(OdipDbContext db, bool isDraft = false, string firstName = "Sophie", string lastName = "Brown")
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = firstName, LastName = lastName, IsActive = true, IsDraft = isDraft };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static CreateBookingDto BookingDto(Guid tripId, Guid participantId) => new()
    {
        TripInstanceId = tripId, ParticipantId = participantId,
    };

    [Fact]
    public async Task Create_NonexistentParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var controller = new BookingsController(db);

        var result = await controller.Create(BookingDto(trip.Id, Guid.NewGuid()), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<BookingDetailDto>>(badRequest.Value);
        Assert.False(body.Success);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.ParticipantBookings.ToListAsync());
    }

    [Fact]
    public async Task Create_DraftParticipant_ReturnsBadRequest()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var draft = SeedParticipant(db, isDraft: true);
        var controller = new BookingsController(db);

        var result = await controller.Create(BookingDto(trip.Id, draft.Id), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<BookingDetailDto>>(badRequest.Value);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await db.ParticipantBookings.ToListAsync());
    }

    [Fact]
    public async Task Create_ValidParticipant_Succeeds()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var participant = SeedParticipant(db);
        var controller = new BookingsController(db);

        var result = await controller.Create(BookingDto(trip.Id, participant.Id), CancellationToken.None);

        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        var body = Assert.IsType<ApiResponse<BookingDetailDto>>(created.Value);
        Assert.True(body.Success);
        Assert.Equal(participant.Id, body.Data!.ParticipantId);
        Assert.Single(await db.ParticipantBookings.ToListAsync());
    }
}
