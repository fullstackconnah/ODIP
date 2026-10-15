using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// The trip's accommodation list is what the reservation form is filled from, and UpdateReservation replaces the whole
/// record: a field the list leaves out is sent back empty by the next save. The list left out the cancellation reason,
/// so editing any cancelled reservation erased its reason.
/// </summary>
public class TripAccommodationListTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task GetAccommodation_CarriesTheCancellationReasonAndEveryDateTheFormSendsBack()
    {
        using var db = CreateDb();
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Escape", StartDate = new DateOnly(2026, 10, 10), DurationDays = 4, Status = TripStatus.Planning };
        var property = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Sunshine Beach Retreat" };
        db.TripInstances.Add(trip);
        db.AccommodationProperties.Add(property);
        db.AccommodationReservations.Add(new AccommodationReservation
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = property.Id,
            RequestSentDate = new DateOnly(2026, 8, 20), DateBooked = new DateOnly(2026, 9, 1), DateConfirmed = new DateOnly(2026, 9, 5),
            CheckInDate = new DateOnly(2026, 10, 10), CheckOutDate = new DateOnly(2026, 10, 14),
            ReservationStatus = ReservationStatus.Cancelled, CancellationReason = "Weather",
        });
        db.SaveChanges();
        var controller = new TripsController(db, Mock.Of<ILogger<TripsController>>());

        var result = await controller.GetAccommodation(trip.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var reservation = Assert.Single(Assert.IsType<ApiResponse<List<ReservationDto>>>(ok.Value).Data!);
        Assert.Equal("Weather", reservation.CancellationReason);
        Assert.Equal(new DateOnly(2026, 8, 20), reservation.RequestSentDate);
        Assert.Equal(new DateOnly(2026, 9, 1), reservation.DateBooked);
        Assert.Equal(new DateOnly(2026, 9, 5), reservation.DateConfirmed);
    }
}
