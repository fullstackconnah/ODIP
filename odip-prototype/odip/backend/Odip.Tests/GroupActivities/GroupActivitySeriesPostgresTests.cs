using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.GroupActivities;

/// <summary>The series table on a real PostgreSQL: the interval and dates round-trip, SeriesId links the rows, and the Restrict foreign key stops a series with rows being deleted. Skipped, never failed, without POSTGRES_CONNECTION_STRING.</summary>
public class GroupActivitySeriesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public GroupActivitySeriesPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact(DisplayName = "Postgres: a series round-trips, its rows link by SeriesId, and the series cannot be deleted while rows use it")]
    public async Task Series_RoundTrips_AndRestrictsDelete()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var series = new GroupActivitySeries { Id = Guid.NewGuid(), TenantId = tenantId, Interval = GroupActivityInterval.Fortnightly, StartDate = new DateOnly(2026, 11, 16), EndDate = new DateOnly(2027, 1, 11) };
        db.GroupActivitySeries.Add(series);
        var activity = new GroupActivity
        {
            Id = Guid.NewGuid(), TenantId = tenantId, SeriesId = series.Id, ServiceDate = series.StartDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Title = "Bowling", Status = ShiftStatus.Draft,
        };
        db.GroupActivities.Add(activity);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var saved = await db.GroupActivitySeries.AsNoTracking().SingleAsync(s => s.Id == series.Id);
        Assert.Equal((GroupActivityInterval.Fortnightly, series.StartDate, series.EndDate), (saved.Interval, saved.StartDate, saved.EndDate));
        Assert.Equal(series.Id, (await db.GroupActivities.AsNoTracking().SingleAsync(a => a.Id == activity.Id)).SeriesId);

        db.GroupActivitySeries.Remove(saved);
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }

    [SkippableFact(DisplayName = "Postgres: a series membership round-trips, the series and participant pair is unique, and another organisation cannot see it")]
    public async Task GroupActivitySeriesParticipant_StoresAndReads_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        var (other, _) = await _pg.NewTenantContextAsync();
        await using var _a = db;
        await using var _b = other;
        var series = new GroupActivitySeries { Id = Guid.NewGuid(), TenantId = tenantId, Interval = GroupActivityInterval.Weekly, StartDate = new DateOnly(2026, 11, 16), EndDate = new DateOnly(2026, 12, 7) };
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.AddRange(series, participant);
        await db.SaveChangesAsync();
        db.GroupActivitySeriesParticipants.Add(new GroupActivitySeriesParticipant { Id = Guid.NewGuid(), TenantId = tenantId, SeriesId = series.Id, ParticipantId = participant.Id, Ratio = SupportRatio.OneToTwo });
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var saved = await db.GroupActivitySeriesParticipants.AsNoTracking().SingleAsync(m => m.SeriesId == series.Id);
        Assert.Equal((participant.Id, SupportRatio.OneToTwo), (saved.ParticipantId, saved.Ratio));
        Assert.Equal(0, await other.GroupActivitySeriesParticipants.CountAsync());

        db.GroupActivitySeriesParticipants.Add(new GroupActivitySeriesParticipant { Id = Guid.NewGuid(), TenantId = tenantId, SeriesId = series.Id, ParticipantId = participant.Id, Ratio = SupportRatio.OneToOne });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
