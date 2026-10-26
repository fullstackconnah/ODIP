using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Rostering.RosterStartWeekTests;

namespace Odip.Tests.Rostering;

/// <summary>The one body behind Start rostering and the Upcoming shifts import, called directly (EF InMemory; the locks are no-ops here).</summary>
public class RosterWeekStarterTests
{
    private static readonly DateTime Now = new(2026, 10, 14, 1, 0, 0, DateTimeKind.Utc);

    private static RosterWeekStarter Starter(OdipDbContext db) => new(new RosterShiftGenerator(), new RosterAvailability(db, new StaffUnavailabilityQuery(db)));

    [Fact]
    public async Task StartAsync_AlreadyStarted_ReturnsNullAndAddsNothing()
    {
        var name = NewDatabase(db =>
        {
            var alex = Person(db, "Alex");
            Pattern(db, alex.Id, DayOfWeek.Monday);
            db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = TenantA, WeekStart = Monday, StartedAt = Now });
        });
        using var db = TestDb.ForTenant(name, TenantA);

        var started = await Starter(db).StartAsync(db, TenantA, Monday, null, Now, default);
        await db.SaveChangesAsync();

        Assert.Null(started);
        Assert.Empty(await db.Shifts.ToListAsync());
        Assert.Equal(1, await db.RosterWeeks.CountAsync());
    }

    [Fact]
    public async Task StartAsync_WithAgreementPattern_MakesItsShifts()
    {
        var name = NewDatabase(db => Pattern(db, Person(db, "Alex").Id, DayOfWeek.Monday));
        using var db = TestDb.ForTenant(name, TenantA);

        var started = await Starter(db).StartAsync(db, TenantA, Monday, CoordinatorId, Now, default);
        await db.SaveChangesAsync();

        Assert.NotNull(started);
        Assert.Single(started!.Made);
        Assert.Equal(Monday, started.Made[0].ServiceDate);
        var week = Assert.Single(await db.RosterWeeks.ToListAsync());
        Assert.Equal((Monday, CoordinatorId, Now), (week.WeekStart, week.StartedByUserId, week.StartedAt));
    }
}
