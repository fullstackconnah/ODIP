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

    private static async Task<Guid> Reserve(ReservationsController c, Guid tripId, Guid propertyId, int fromDay, int toDay)
    {
        var made = await c.Create(new CreateReservationDto
        {
            TripInstanceId = tripId, AccommodationPropertyId = propertyId,
            CheckInDate = new DateOnly(2026, 10, fromDay), CheckOutDate = new DateOnly(2026, 10, toDay), ReservationStatus = ReservationStatus.Booked,
        }, CancellationToken.None);
        return Assert.IsType<ApiResponse<ReservationDto>>(Assert.IsType<OkObjectResult>(made.Result).Value).Data!.Id;
    }

    private static Task<UpdateReservationDto> AsUpdate(OdipDbContext db, Guid id, int fromDay, int toDay, ReservationStatus status) =>
        Task.FromResult(new UpdateReservationDto
        {
            TripInstanceId = db.AccommodationReservations.Single(r => r.Id == id).TripInstanceId,
            AccommodationPropertyId = db.AccommodationReservations.Single(r => r.Id == id).AccommodationPropertyId,
            CheckInDate = new DateOnly(2026, 10, fromDay), CheckOutDate = new DateOnly(2026, 10, toDay), ReservationStatus = status,
        });

    private static bool Flag(OdipDbContext db, Guid id) => db.AccommodationReservations.AsNoTracking().Single(r => r.Id == id).HasOverlapConflict;

    [Fact]
    public async Task OverlapFlags_ClearWhenTheOtherReservationIsCancelledMovedOrDeleted_AndAreSetOnBoth()
    {
        using var db = CreateDb();
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Escape", StartDate = new DateOnly(2026, 10, 10), DurationDays = 20, Status = TripStatus.Planning };
        var property = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Sunshine Beach Retreat" };
        db.TripInstances.Add(trip);
        db.AccommodationProperties.Add(property);
        db.SaveChanges();
        var c = new ReservationsController(db);

        var a = await Reserve(c, trip.Id, property.Id, 10, 14);
        var b = await Reserve(c, trip.Id, property.Id, 12, 16);
        var other = await Reserve(c, trip.Id, property.Id, 20, 22);
        Assert.True(Flag(db, a)); Assert.True(Flag(db, b)); Assert.False(Flag(db, other));

        await c.Update(a, await AsUpdate(db, a, 10, 14, ReservationStatus.Cancelled), CancellationToken.None);
        Assert.False(Flag(db, b));

        await c.Update(a, await AsUpdate(db, a, 10, 14, ReservationStatus.Booked), CancellationToken.None);
        Assert.True(Flag(db, a)); Assert.True(Flag(db, b));

        await c.Update(b, await AsUpdate(db, b, 15, 18, ReservationStatus.Booked), CancellationToken.None);
        Assert.False(Flag(db, a)); Assert.False(Flag(db, b));

        await c.Update(b, await AsUpdate(db, b, 12, 16, ReservationStatus.Booked), CancellationToken.None);
        await c.Delete(b, CancellationToken.None);
        Assert.False(Flag(db, a));
        Assert.False(Flag(db, other));
    }

    [Fact]
    public async Task SameDayCheckOutAndCheckIn_IsNotAClash()
    {
        using var db = CreateDb();
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Escape", StartDate = new DateOnly(2026, 10, 10), DurationDays = 20, Status = TripStatus.Planning };
        var property = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Sunshine Beach Retreat" };
        db.TripInstances.Add(trip);
        db.AccommodationProperties.Add(property);
        db.SaveChanges();
        var c = new ReservationsController(db);

        var first = await Reserve(c, trip.Id, property.Id, 10, 14);
        var second = await Reserve(c, trip.Id, property.Id, 14, 16);

        Assert.False(Flag(db, first));
        Assert.False(Flag(db, second));
    }

    [Fact]
    public async Task MovingAReservationToAnotherProperty_ClearsTheFlagOnTheOldPropertysOtherReservation()
    {
        using var db = CreateDb();
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Escape", StartDate = new DateOnly(2026, 10, 10), DurationDays = 20, Status = TripStatus.Planning };
        var old = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Sunshine Beach Retreat" };
        var elsewhere = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Hinterland Lodge" };
        db.TripInstances.Add(trip);
        db.AccommodationProperties.AddRange(old, elsewhere);
        db.SaveChanges();
        var c = new ReservationsController(db);
        var a = await Reserve(c, trip.Id, old.Id, 10, 14);
        var b = await Reserve(c, trip.Id, old.Id, 12, 16);
        Assert.True(Flag(db, a)); Assert.True(Flag(db, b));

        var move = (await AsUpdate(db, a, 10, 14, ReservationStatus.Booked)) with { AccommodationPropertyId = elsewhere.Id };
        await c.Update(a, move, CancellationToken.None);

        Assert.False(Flag(db, a));
        Assert.False(Flag(db, b));
    }
    private static (OdipDbContext Db, ReservationsController C, TripInstance Trip, AccommodationProperty Active, AccommodationProperty Archived) CheckRig()
    {
        var db = CreateDb();
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Escape", StartDate = new DateOnly(2026, 10, 10), DurationDays = 20, Status = TripStatus.Planning };
        var active = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Sunshine Beach Retreat" };
        var archived = new AccommodationProperty { Id = Guid.NewGuid(), PropertyName = "Old Lodge", IsActive = false };
        db.AddRange(trip, active, archived);
        db.SaveChanges();
        return (db, new ReservationsController(db), trip, active, archived);
    }

    private static void AssertRefused<T>(ActionResult<ApiResponse<T>> result, string message) =>
        Assert.Equal(message, Assert.Single(Assert.IsType<ApiResponse<T>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors));

    private static CreateReservationDto NewReservation(TripInstance trip, AccommodationProperty property, int fromDay, int toDay) => new()
    {
        TripInstanceId = trip.Id, AccommodationPropertyId = property.Id,
        CheckInDate = new DateOnly(2026, 10, fromDay), CheckOutDate = new DateOnly(2026, 10, toDay), ReservationStatus = ReservationStatus.Booked,
    };

    [Fact]
    public async Task Create_RefusesAnArchivedPropertyAndACheckOutThatIsNotAfterCheckIn_AndSavesNothing()
    {
        var (db, c, trip, active, archived) = CheckRig();
        using var _ = db;

        AssertRefused(await c.Create(NewReservation(trip, archived, 10, 14), CancellationToken.None), "This property is archived. Choose an active property.");
        AssertRefused(await c.Create(NewReservation(trip, active, 14, 10), CancellationToken.None), "Check-out must be after check-in.");
        AssertRefused(await c.Create(NewReservation(trip, active, 10, 10), CancellationToken.None), "Check-out must be after check-in.");

        Assert.Empty(db.AccommodationReservations);
    }

    [Fact]
    public async Task Update_RefusesAMoveToAnArchivedPropertyAndInvertedDates_ButAnEditOnAPropertyArchivedLaterStillSaves()
    {
        var (db, c, trip, active, archived) = CheckRig();
        using var _ = db;
        var id = await Reserve(c, trip.Id, active.Id, 10, 14);
        UpdateReservationDto Edit(Guid propertyId, int fromDay, int toDay, string? comments = null) => new()
        {
            TripInstanceId = trip.Id, AccommodationPropertyId = propertyId, Comments = comments,
            CheckInDate = new DateOnly(2026, 10, fromDay), CheckOutDate = new DateOnly(2026, 10, toDay), ReservationStatus = ReservationStatus.Booked,
        };

        AssertRefused(await c.Update(id, Edit(archived.Id, 10, 14), CancellationToken.None), "This property is archived. Choose an active property.");
        AssertRefused(await c.Update(id, Edit(active.Id, 14, 10), CancellationToken.None), "Check-out must be after check-in.");
        Assert.Equal(active.Id, db.AccommodationReservations.Single().AccommodationPropertyId);

        active.IsActive = false;
        db.SaveChanges();
        Assert.IsType<OkObjectResult>((await c.Update(id, Edit(active.Id, 10, 14, "late arrival"), CancellationToken.None)).Result);
        Assert.Equal("late arrival", db.AccommodationReservations.Single().Comments);
    }
}
