using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The NDIA signal's query as the NPGSQL provider translates it, not as EF InMemory evaluates it (InMemory runs any LINQ in memory and would stay green if the query stopped translating, or
/// translated into one that reads another tenant's claims). <c>ToQueryString</c> only builds SQL; nothing connects, so this needs no database.
/// </summary>
public class NdiaRejectionSqlTests
{
    private static NdiaRejectionReader Reader(out OdipDbContext db)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres")
            .Options;
        db = new OdipDbContext(options, tenant.Object);
        return new NdiaRejectionReader(db);
    }

    [Fact]
    public void TheRejectedLinesQuery_ReachesClaimsThroughShiftsAndBookingsOfTheNamedParticipants_InsideTheTenant()
    {
        var reader = Reader(out var db);
        using var _ = db;

        var sql = reader.RejectedLinesQuery(Guid.NewGuid(), new List<Guid> { Guid.NewGuid(), Guid.NewGuid() }).ToQueryString();

        Assert.Contains("\"ClaimLineItems\"", sql);
        Assert.Contains("\"TripClaims\"", sql);
        Assert.Contains("\"Shifts\"", sql);                 // a line has no participant of its own: it is reached through its shift...
        Assert.Contains("\"ParticipantBookings\"", sql);    // ...or its booking...
        Assert.Contains("\"TripInstances\"", sql);          // ...whose trip names the tenant
        Assert.Contains("\"TenantId\" =", sql);
        Assert.Matches(@"= ANY \(", sql);                   // the participants' ids, as one parameter: not a query per participant
    }

    [Fact]
    public void TheRejectedLinesQuery_AsksOnlyForRejectedClaimsWithOneOfTheFourFundsCodes()
    {
        var reader = Reader(out var db);
        using var _ = db;

        var sql = reader.RejectedLinesQuery(Guid.NewGuid(), new List<Guid> { Guid.NewGuid() }).ToQueryString();

        Assert.Contains("\"Status\" = 6", sql);             // TripClaimStatus.Rejected
        Assert.Contains("\"RejectionCode\"", sql);
        Assert.Contains("'V17'", sql);
        Assert.Contains("'V18'", sql);
        Assert.Contains("'V27'", sql);
        Assert.Contains("'V28'", sql);
        Assert.Contains("\"RejectedDate\" IS NOT NULL", sql);
    }
}
