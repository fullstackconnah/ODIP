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
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// The booking list on a real PostgreSQL (skipped, never failed, when POSTGRES_CONNECTION_STRING is unset). ParticipantBookings has no tenant filter of its own, so TotalCount is only
/// right when the joins to the filtered trips and participants scope the count as they scope the items. Organisation A lists; organisation B has three confirmed bookings, A has one.
/// </summary>
public class BookingsTenantCountPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public BookingsTenantCountPostgresTests(PostgresFixture pg) => _pg = pg;

    private static OdipDbContext TenantDb(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    // One participant, a booking on each of its own trips: the database allows one booking per participant and trip.
    private static List<ParticipantBooking> PlantBookings(OdipDbContext admin, Guid tenantId, string ndis, int count)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = ndis, PlanType = PlanType.SelfManaged };
        var trips = Enumerable.Range(0, count)
            .Select(i => new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = $"Trip {i}", StartDate = new DateOnly(2026, 2, 1), DurationDays = 3 })
            .ToList();
        admin.Add(participant);
        admin.AddRange(trips);
        admin.SaveChanges();

        var bookings = trips
            .Select(t => new ParticipantBooking { Id = Guid.NewGuid(), TripInstanceId = t.Id, ParticipantId = participant.Id, BookingStatus = BookingStatus.Confirmed, BookingDate = new DateOnly(2026, 1, 1) })
            .ToList();
        admin.AddRange(bookings);
        admin.SaveChanges();
        return bookings;
    }

    private static PagedResult<BookingListDto> Listed(ActionResult<ApiResponse<PagedResult<BookingListDto>>> result) =>
        Assert.IsType<ApiResponse<PagedResult<BookingListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [SkippableFact]
    public async Task BookingList_CountsOnlyTheCallersOrganisation_OnRealPostgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var setup = PostgresFixture.NewContext(cs))
            await setup.Database.MigrateAsync();

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        List<ParticipantBooking> foreign, own;
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "A", EmailDomain = "a.example.com" }, new Tenant { Id = b, Name = "B", EmailDomain = "b.example.com" });
            admin.SaveChanges();
            foreign = PlantBookings(admin, b, "43100000001", 3);
            own = PlantBookings(admin, a, "43100000002", 1);
        }

        await using var db = TenantDb(cs, a);
        var ct = CancellationToken.None;
        var bookings = new BookingsController(db);

        // The list counts and returns only A's booking.
        var all = Listed(await bookings.GetAll(null, null, ct: ct));
        Assert.Equal((1, 1), (all.TotalCount, all.Items.Count));
        Assert.Equal(own[0].Id, Assert.Single(all.Items).Id);

        // A filter on B's trip finds nothing.
        var byTrip = Listed(await bookings.GetAll(foreign[0].TripInstanceId, null, ct: ct));
        Assert.Equal((0, 0), (byTrip.TotalCount, byTrip.Items.Count));

        // A status filter counts A's bookings only: B's are confirmed as well.
        var byStatus = Listed(await bookings.GetAll(null, BookingStatus.Confirmed, ct: ct));
        Assert.Equal((1, 1), (byStatus.TotalCount, byStatus.Items.Count));

        // A reaches its own booking by id and cannot reach B's.
        Assert.IsType<OkObjectResult>((await bookings.GetById(own[0].Id, ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await bookings.GetById(foreign[0].Id, ct)).Result);
    }
}
