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
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Trips;

/// <summary>
/// How many staff a trip needs is worked out once, on the server (<see cref="TripInstance.StaffRequired"/>), and the trip
/// detail and the schedule screen both send it. The web app used to mirror the rule (a second copy in TypeScript, and a
/// third in each trip tab), and the copies disagreed with the server.
/// </summary>
public class TripStaffRequiredTests
{
    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static TripInstance SeedTrip(OdipDbContext db, int? minStaffRequired = null)
    {
        var trip = new TripInstance
        {
            Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 9, 10), DurationDays = 3,
            Status = TripStatus.Confirmed, MinStaffRequired = minStaffRequired,
        };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static ParticipantBooking Book(OdipDbContext db, TripInstance trip, SupportRatio participantRatio, SupportRatio? bookingOverride = null,
        BookingStatus status = BookingStatus.Confirmed)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "P" + Guid.NewGuid().ToString("N")[..6], LastName = "Test", IsActive = true, SupportRatio = participantRatio };
        var booking = new ParticipantBooking
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id, BookingStatus = status, SupportRatioOverride = bookingOverride,
        };
        db.Participants.Add(participant);
        db.ParticipantBookings.Add(booking);
        db.SaveChanges();
        return booking;
    }

    private static async Task<TripDetailDto> Detail(OdipDbContext db, Guid tripId)
    {
        var result = await new TripsController(db, Mock.Of<ILogger<TripsController>>()).GetById(tripId, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<TripDetailDto>>(ok.Value).Data!;
    }

    private static async Task<ScheduleTripDto> OnTheSchedule(OdipDbContext db, Guid tripId)
    {
        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db), new StaffAvailabilityItemsQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value).Data!.Trips.Single(t => t.Id == tripId);
    }

    [Fact]
    public async Task AfterABookingWrite_TheFigureFollowsOverrideThenParticipantRatio_CountsOtherAsOne_AndRoundsUp()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        Book(db, trip, SupportRatio.TwoToOne, bookingOverride: SupportRatio.OneToTwo);   // the override wins over the participant's 2:1: 0.5
        Book(db, trip, SupportRatio.TwoToOne);                                           // no override: the participant's 2:1: 2
        Book(db, trip, SupportRatio.OneToOne);                                           // no override, the default 1:1: 1
        Book(db, trip, SupportRatio.OneToThree, bookingOverride: SupportRatio.Other);    // Other counts as one: 1
        Book(db, trip, SupportRatio.TwoToOne, status: BookingStatus.Cancelled);          // not travelling: 0
        var removed = Book(db, trip, SupportRatio.TwoToOne);                             // deleted below, which is the write that recalculates

        await new BookingsController(db).Delete(removed.Id, CancellationToken.None);

        var detail = await Detail(db, trip.Id);
        Assert.Equal(4.5m, detail.CalculatedStaffRequired);
        Assert.Equal(5, detail.StaffRequired);
        Assert.Equal(5, (await OnTheSchedule(db, trip.Id)).StaffRequired);
    }

    [Fact]
    public async Task WhileNoBookingHasSetTheFigure_TheTripsOwnMinimumStands_OnTheDetailAndTheSchedule()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db, minStaffRequired: 2);

        Assert.Equal(2, (await Detail(db, trip.Id)).StaffRequired);
        Assert.Equal(2, (await OnTheSchedule(db, trip.Id)).StaffRequired);
    }

    [Fact]
    public async Task WithNeitherBookingsNorAMinimum_TheFigureIsUnknown_NotZero()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);

        Assert.Null((await Detail(db, trip.Id)).StaffRequired);
        Assert.Null((await OnTheSchedule(db, trip.Id)).StaffRequired);
    }
}
