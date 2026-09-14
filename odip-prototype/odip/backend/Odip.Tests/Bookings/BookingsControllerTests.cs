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

    // ── GetAll ordering: BookingDate tiebreaker ────────────────────────────

    /// <summary>
    /// Correctness fix: BookingDate is a plain date (not a timestamp), so many bookings created
    /// the same day tie on GetAll's sole OrderByDescending key. Without a unique tiebreaker,
    /// Skip/Take over ties is non-deterministic. Asserts GetAll's
    /// `.OrderByDescending(BookingDate).ThenBy(Id)` resolves ties to the same, repeatable order
    /// (ascending Id) across two independent calls. Mirrors
    /// IncidentsControllerTests.GetAll_TiedIncidentDateTime_OrdersStablyByIdAcrossRepeatedCalls.
    /// </summary>
    [Fact]
    public async Task GetAll_TiedBookingDate_OrdersStablyByIdAcrossRepeatedCalls()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var participantA = SeedParticipant(db, firstName: "Sophie", lastName: "Brown");
        var participantB = SeedParticipant(db, firstName: "Harrison", lastName: "Lee");
        var controller = new BookingsController(db);

        var tiedDate = new DateOnly(2026, 9, 1);
        await controller.Create(BookingDto(trip.Id, participantA.Id) with { BookingDate = tiedDate }, CancellationToken.None);
        await controller.Create(BookingDto(trip.Id, participantB.Id) with { BookingDate = tiedDate }, CancellationToken.None);

        var tiedBookings = await db.ParticipantBookings.Where(b => b.BookingDate == tiedDate).ToListAsync();
        Assert.Equal(2, tiedBookings.Count);
        var expectedTiedOrder = tiedBookings.OrderBy(b => b.Id).Select(b => b.Id).ToList();

        var firstCall = await controller.GetAll(tripId: null, status: null, ct: CancellationToken.None);
        var firstItems = Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>(firstCall.Result).Value).Data!.Items;

        var secondCall = await controller.GetAll(tripId: null, status: null, ct: CancellationToken.None);
        var secondItems = Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>(secondCall.Result).Value).Data!.Items;

        var firstTiedOrder = firstItems.Where(b => b.BookingDate == tiedDate).Select(b => b.Id).ToList();
        var secondTiedOrder = secondItems.Where(b => b.BookingDate == tiedDate).Select(b => b.Id).ToList();

        Assert.Equal(expectedTiedOrder, firstTiedOrder);
        Assert.Equal(expectedTiedOrder, secondTiedOrder);
    }

    /// <summary>
    /// The correctness guarantee the Id tiebreaker exists for: paging over rows that tie on
    /// BookingDate must partition the result set into disjoint, exhaustive pages — no row
    /// duplicated across pages, none silently dropped. Mirrors
    /// IncidentsControllerTests.GetAll_PagingOverTiedIncidentDateTime_PartitionsDisjointAndExhaustive.
    /// </summary>
    [Fact]
    public async Task GetAll_PagingOverTiedBookingDate_PartitionsDisjointAndExhaustive()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var trip = SeedTrip(db);
        var controller = new BookingsController(db);

        var tiedDate = new DateOnly(2026, 9, 1);
        for (var i = 0; i < 3; i++)
        {
            var participant = SeedParticipant(db, firstName: $"Participant{i}", lastName: "Brown");
            await controller.Create(BookingDto(trip.Id, participant.Id) with { BookingDate = tiedDate }, CancellationToken.None);
        }

        var page1Call = await controller.GetAll(tripId: null, status: null, page: 1, pageSize: 2, ct: CancellationToken.None);
        var page1 = Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>(page1Call.Result).Value).Data!;

        var page2Call = await controller.GetAll(tripId: null, status: null, page: 2, pageSize: 2, ct: CancellationToken.None);
        var page2 = Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>(page2Call.Result).Value).Data!;

        Assert.Equal(3, page1.TotalCount);
        Assert.Equal(2, page1.Items.Count);
        Assert.Single(page2.Items);

        var page1Ids = page1.Items.Select(b => b.Id).ToList();
        var page2Ids = page2.Items.Select(b => b.Id).ToList();
        Assert.Empty(page1Ids.Intersect(page2Ids)); // disjoint — no row duplicated across pages
        Assert.Equal(3, page1Ids.Concat(page2Ids).Distinct().Count()); // exhaustive — every row appears exactly once
    }
}
