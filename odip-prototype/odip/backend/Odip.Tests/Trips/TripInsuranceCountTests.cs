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
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Trips;

/// <summary>
/// L3-01. The trip header's "Insurance x / y" must count the same people the "Participants" figure counts: the
/// Confirmed bookings. Enquiry, Held, Waitlist and Completed bookings are not travelling (or no longer are), so they must
/// not be "outstanding", and the denominator must never be larger than the participant count printed beside it.
/// </summary>
public class TripInsuranceCountTests
{
    private static OdipDbContext CreateDb() => TestDb.Create();

    private static TripInstance SeedTrip(OdipDbContext db)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, Status = TripStatus.Planning };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static void Book(OdipDbContext db, TripInstance trip, BookingStatus booking, InsuranceStatus insurance, int count = 1)
    {
        for (var i = 0; i < count; i++)
        {
            var participant = new Participant { Id = Guid.NewGuid(), FirstName = "P" + Guid.NewGuid().ToString("N")[..6], LastName = "Test", IsActive = true };
            db.Participants.Add(participant);
            db.ParticipantBookings.Add(new ParticipantBooking
            {
                Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = participant.Id,
                BookingStatus = booking, InsuranceStatus = insurance,
            });
        }
        db.SaveChanges();
    }

    private static TripsController Controller(OdipDbContext db) => new(db, Mock.Of<ILogger<TripsController>>());

    private static async Task<TripDetailDto> Detail(TripsController controller, Guid id)
    {
        var result = await controller.GetById(id, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<TripDetailDto>>(ok.Value).Data!;
    }

    [Fact]
    public async Task GetById_CountsInsuranceOverTheConfirmedBookingsOnly()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.Confirmed, 3);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.None);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.Pending);
        // Not on the trip: none of these is insurance work.
        Book(db, trip, BookingStatus.Waitlist, InsuranceStatus.None, 2);
        Book(db, trip, BookingStatus.Held, InsuranceStatus.Pending);
        Book(db, trip, BookingStatus.Enquiry, InsuranceStatus.None);
        Book(db, trip, BookingStatus.Completed, InsuranceStatus.Confirmed, 2);
        Book(db, trip, BookingStatus.Completed, InsuranceStatus.None);
        Book(db, trip, BookingStatus.Cancelled, InsuranceStatus.None);
        Book(db, trip, BookingStatus.NoLongerAttending, InsuranceStatus.None);

        var detail = await Detail(Controller(db), trip.Id);

        Assert.Equal(5, detail.CurrentParticipantCount);
        Assert.Equal(3, detail.InsuranceConfirmedCount);
        Assert.Equal(2, detail.InsuranceOutstandingCount);
        Assert.Equal(detail.CurrentParticipantCount, detail.InsuranceConfirmedCount + detail.InsuranceOutstandingCount);
    }

    [Fact]
    public async Task GetById_WaitlistedAndHeldPeopleDoNotMakeInsuranceOutstanding()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.Confirmed, 6);
        Book(db, trip, BookingStatus.Waitlist, InsuranceStatus.None, 2);
        Book(db, trip, BookingStatus.Held, InsuranceStatus.None);

        var detail = await Detail(Controller(db), trip.Id);

        Assert.Equal(6, detail.InsuranceConfirmedCount);
        Assert.Equal(0, detail.InsuranceOutstandingCount);
    }

    [Fact]
    public async Task GetById_ATripWhoseBookingsAreAllCompleted_HasNoInsuranceFigureAtAll()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        Book(db, trip, BookingStatus.Completed, InsuranceStatus.Confirmed, 6);

        var detail = await Detail(Controller(db), trip.Id);

        Assert.Equal(0, detail.CurrentParticipantCount);
        Assert.Equal(0, detail.InsuranceConfirmedCount);
        Assert.Equal(0, detail.InsuranceOutstandingCount);
    }

    [Fact]
    public async Task Update_ReturnsTheSameInsuranceCountsAsGetById()
    {
        using var db = CreateDb();
        var trip = SeedTrip(db);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.Confirmed, 2);
        Book(db, trip, BookingStatus.Confirmed, InsuranceStatus.None);
        Book(db, trip, BookingStatus.Waitlist, InsuranceStatus.None, 3);
        var controller = Controller(db);

        var result = await controller.Update(trip.Id, new UpdateTripDto
        {
            TripName = trip.TripName, StartDate = trip.StartDate, DurationDays = trip.DurationDays, Status = TripStatus.Planning,
        }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var updated = Assert.IsType<ApiResponse<TripDetailDto>>(ok.Value).Data!;
        var fetched = await Detail(controller, trip.Id);
        Assert.Equal(2, updated.InsuranceConfirmedCount);
        Assert.Equal(1, updated.InsuranceOutstandingCount);
        Assert.Equal(fetched.InsuranceConfirmedCount, updated.InsuranceConfirmedCount);
        Assert.Equal(fetched.InsuranceOutstandingCount, updated.InsuranceOutstandingCount);
    }
}
