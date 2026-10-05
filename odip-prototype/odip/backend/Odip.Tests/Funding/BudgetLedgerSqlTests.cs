using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The ledger's queries as the NPGSQL provider translates them, not as EF InMemory evaluates them (InMemory runs any LINQ in memory and would stay green if one of these stopped translating, or
/// translated into something that reads another tenant's rows). <c>ToQueryString</c> only builds SQL; nothing connects, so this needs no database. What the same queries return on a real
/// server is in <see cref="BudgetLedgerPostgresTests"/>.
/// </summary>
public class BudgetLedgerSqlTests
{
    private static readonly DateOnly From = new(2026, 7, 1);
    private static readonly DateOnly To = new(2029, 9, 8);
    private static readonly List<Guid> Ids = new() { Guid.NewGuid(), Guid.NewGuid() };

    private static BudgetLedgerService Service(out OdipDbContext db)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres")
            .Options;
        db = new OdipDbContext(options, tenant.Object);
        return new BudgetLedgerService(db, TimeProvider.System);
    }

    [Fact]
    public void TheClaimLinesQuery_ReachesLinesThroughShiftsAndBookingsOnly_AndLeavesOutRejectedAndCancelledClaims()
    {
        var service = Service(out var db);
        using var _ = db;

        var sql = service.ClaimLinesQuery(Ids, From, To).ToQueryString();

        Assert.Contains("\"ClaimLineItems\"", sql);
        Assert.Contains("\"TripClaims\"", sql);
        Assert.Contains("\"Shifts\"", sql);                 // joined: a line has no participant of its own
        Assert.Contains("\"ParticipantBookings\"", sql);
        Assert.Matches(@"= ANY \(", sql);                   // the participants' ids, as one parameter: not a query per participant
        Assert.Contains("\"SupportsDeliveredFrom\" >=", sql);
        Assert.Contains("\"SupportsDeliveredFrom\" <=", sql);
        Assert.Contains("\"Status\" <> 5", sql);            // the line is not Rejected
        Assert.Contains("<> 6", sql);                       // the claim is not Rejected...
        Assert.Contains("<> 7", sql);                       // ...or Cancelled
        Assert.Contains("\"PaidAmount\"", sql);
    }

    [Fact]
    public void TheShiftsQuery_AsksForUnclaimedCompletedShiftsWithANotExists_AndStaysInTheTenant()
    {
        var service = Service(out var db);
        using var _ = db;

        var sql = service.ShiftsQuery(Guid.NewGuid(), Ids, From, To).ToQueryString();

        Assert.Contains("\"Shifts\"", sql);
        Assert.Contains("NOT EXISTS", sql);                 // a completed shift is pending only while no claim line has taken it
        Assert.Contains("\"ClaimLineItems\"", sql);
        Assert.Contains("\"TenantId\" =", sql);
        Assert.Contains("\"ServiceDate\" >=", sql);
        Assert.Contains("\"ServiceDate\" <=", sql);
        Assert.Contains("\"StartTime\"", sql);              // the hours are worked out from the times, in memory
        Assert.Contains("\"EndsNextDay\"", sql);
    }

    [Fact]
    public void TheBookingsQuery_JoinsTheTripAndFiltersItsStartCancelledStatusAndTenant()
    {
        var service = Service(out var db);
        using var _ = db;

        var sql = service.BookingsQuery(Guid.NewGuid(), Ids, new DateOnly(2026, 10, 4), To).ToQueryString();

        Assert.Contains("\"ParticipantBookings\"", sql);
        Assert.Contains("\"TripInstances\"", sql);
        Assert.Contains("\"StartDate\" >=", sql);           // from today
        Assert.Contains("\"StartDate\" <=", sql);
        Assert.Contains("\"TenantId\" =", sql);             // the trip is the organisation's
        Assert.Contains("\"BookingStatus\" = 2", sql);      // Confirmed
        Assert.Contains("<> 7", sql);                       // the trip is not Cancelled
        Assert.Contains("\"ActiveHoursPerDay\"", sql);
    }

    [Fact]
    public void TheCatalogueQuery_ReadsTheCommunityAccessGroupTheTripsGroupsAndTheCodesOfTheLines_InOneQuery()
    {
        var service = Service(out var db);
        using var _ = db;

        var sql = service.CatalogueQuery(Ids, new[] { "04_104_0125_6_1", "15_035_0128_1_3" }).ToQueryString();

        Assert.Contains("\"SupportCatalogueItems\"", sql);
        Assert.Contains("\"SupportActivityGroups\"", sql);
        Assert.Contains("GRP_COMMUNITY_ACCESS", sql);
        Assert.Contains("\"ItemNumber\"", sql);
        Assert.Matches(@"= ANY \(", sql);
    }
}
