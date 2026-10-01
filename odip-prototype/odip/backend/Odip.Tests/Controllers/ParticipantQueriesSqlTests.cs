using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The participant search and the archive-warning counts, checked against the NPGSQL provider's translation (not just EF InMemory,
/// which would stay green if the search silently became a case-sensitive LIKE again, or a count stopped translating).
/// <c>ToQueryString</c> only builds SQL; nothing connects.
/// </summary>
public class ParticipantQueriesSqlTests
{
    private static OdipDbContext NpgsqlDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres")
            .Options;
        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public void Search_LowerCasesTheColumnsAndTheTerm_SoItIsCaseInsensitiveOnPostgres()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantQueries.SearchByName(db.Participants, "  JaMie ").ToQueryString();

        // Both sides lower-cased: the parameter is the lower-cased, trimmed term, and each column is wrapped in lower().
        Assert.Contains("lower(", sql);
        Assert.Contains("jamie", sql);
        Assert.DoesNotContain("JaMie", sql);
        Assert.Contains("\"FirstName\"", sql);
        Assert.Contains("\"LastName\"", sql);
        Assert.Contains("\"PreferredName\"", sql);
    }

    [Fact]
    public void ArchiveWarningCounts_TranslateToPostgresSql()
    {
        using var db = NpgsqlDb();
        var id = Guid.NewGuid();
        var today = new DateOnly(2026, 10, 1);

        var shifts = ParticipantQueries.UpcomingShifts(db, id, today).ToQueryString();
        var patterns = ParticipantQueries.LivePatterns(db, id, today).ToQueryString();
        var bookings = ParticipantQueries.UpcomingBookings(db, id, today).ToQueryString();

        Assert.Contains("\"Shifts\"", shifts);
        Assert.Contains("\"ServiceDate\"", shifts);
        Assert.Contains("\"Status\"", shifts);
        Assert.Contains("\"ShiftPatterns\"", patterns);
        Assert.Contains("\"EffectiveTo\"", patterns);
        // The bookings count reaches the trip's start date through a join, never a client-side filter.
        Assert.Contains("\"ParticipantBookings\"", bookings);
        Assert.Contains("\"TripInstances\"", bookings);
        Assert.Contains("\"StartDate\"", bookings);
    }
}
