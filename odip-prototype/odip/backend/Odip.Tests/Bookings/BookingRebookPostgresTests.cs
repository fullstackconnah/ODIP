using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Funding;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Bookings;

/// <summary>The unique (trip, participant) index on a real PostgreSQL: a second booking of the same person is a 409, and the message says whether the existing booking is cancelled. Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class BookingRebookPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public BookingRebookPostgresTests(PostgresFixture pg) => _pg = pg;

    private async Task<string> SecondBookingMessageAsync(BookingStatus existing)
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        using var kit = LedgerKit.Wrap(db, tenantId);
        var person = kit.SeedParticipant();
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Gold Coast Beach Break", StartDate = new DateOnly(2026, 9, 1), DurationDays = 3, Status = TripStatus.Planning };
        db.TripInstances.Add(trip);
        db.ParticipantBookings.Add(new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = trip.Id, ParticipantId = person.Id, BookingStatus = existing, BookingDate = new DateOnly(2026, 8, 1) });
        await db.SaveChangesAsync();

        var result = await new BookingsController(db).Create(new CreateBookingDto { TripInstanceId = trip.Id, ParticipantId = person.Id }, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<BookingDetailDto>>(conflict.Value).Errors![0];
    }

    [SkippableTheory(DisplayName = "Postgres: a cancelled or no-longer-attending booking is named in the 409 and the message says how to rebook")]
    [InlineData(BookingStatus.Cancelled)]
    [InlineData(BookingStatus.NoLongerAttending)]
    public async Task A_cancelled_booking_in_the_way_says_to_open_it_and_change_its_status(BookingStatus existing) =>
        Assert.Equal("This participant has a cancelled booking on this trip. Open it and change its status to rebook them.", await SecondBookingMessageAsync(existing));

    [SkippableFact(DisplayName = "Postgres: a live booking in the way keeps the already-booked message")]
    public async Task A_live_booking_in_the_way_keeps_the_already_booked_message() =>
        Assert.Equal("This participant is already booked on this trip.", await SecondBookingMessageAsync(BookingStatus.Confirmed));
}
