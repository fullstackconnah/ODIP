using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>The board's staffAvailableDays (the staff picker's "Available that day") on EF InMemory: both modes, the caller's organisation only, active staff only.</summary>
public class RosterBoardAvailableDaysTests
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private static readonly Guid TenantA = Guid.NewGuid(), TenantB = Guid.NewGuid();

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }
    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero));

    private static async Task<RosterBoardDto> BoardAsync(string dbName, Guid caller, string groupBy)
    {
        using var db = TestDb.ForTenant(dbName, caller);
        var result = await new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: Clock).GetBoard(Monday, groupBy, default);
        return Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static User Worker(OdipDbContext db, Guid tenantId, string first, bool active = true) => db.Users.Add(new User
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = "Test", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = active, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
    }).Entity;

    private static void Marked(OdipDbContext db, Guid userId, AvailabilityType type, DateOnly from, DateOnly to) => db.StaffAvailabilities.Add(new StaffAvailability
    {
        Id = Guid.NewGuid(), UserId = userId, AvailabilityType = type, StartDateTime = from.ToDateTime(TimeOnly.MinValue), EndDateTime = to.ToDateTime(new TimeOnly(23, 59, 59)),
    });

    [Theory]
    [InlineData("participant")]
    [InlineData("staff")]
    public async Task BothModes_ReturnThePersonsDays(string groupBy)
    {
        var dbName = Guid.NewGuid().ToString();
        Guid samId;
        using (var db = TestDb.Create(dbName))
        {
            var sam = Worker(db, TenantA, "Sam");
            Marked(db, sam.Id, AvailabilityType.Preferred, Monday, Monday.AddDays(1));
            await db.SaveChangesAsync();
            samId = sam.Id;
        }

        var days = (await BoardAsync(dbName, TenantA, groupBy)).StaffAvailableDays;

        Assert.Equal(new[] { Monday, Monday.AddDays(1) }, days.Select(d => d.Date));
        Assert.All(days, d => { Assert.Equal(samId, d.StaffId); Assert.True(d.Preferred); });
    }

    [Fact]
    public async Task ReadsOnlyTheCallersOrganisation()   // cross-tenant
    {
        var dbName = Guid.NewGuid().ToString();
        Guid otherId;
        using (var db = TestDb.Create(dbName))
        {
            var mine = Worker(db, TenantA, "Sam");
            var other = Worker(db, TenantB, "Ola");
            Marked(db, mine.Id, AvailabilityType.Available, Monday, Monday);
            Marked(db, other.Id, AvailabilityType.Available, Monday, Monday.AddDays(6));
            await db.SaveChangesAsync();
            otherId = other.Id;
        }

        var board = await BoardAsync(dbName, TenantA, "participant");

        Assert.DoesNotContain(board.StaffAvailableDays, d => d.StaffId == otherId);
        Assert.Single(board.StaffAvailableDays);
    }

    [Fact]
    public async Task AnInactiveUsersRow_IsAbsent()
    {
        var dbName = Guid.NewGuid().ToString();
        using (var db = TestDb.Create(dbName))
        {
            Marked(db, Worker(db, TenantA, "Gone", active: false).Id, AvailabilityType.Available, Monday, Monday);
            await db.SaveChangesAsync();
        }

        Assert.Empty((await BoardAsync(dbName, TenantA, "staff")).StaffAvailableDays);
    }
}
