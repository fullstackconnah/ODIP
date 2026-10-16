using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Start rostering's schema (2026-10-16) on a real PostgreSQL: the RosterWeeks unique key, and the SetNull key from a shift's remembered regular. Skipped without POSTGRES_CONNECTION_STRING.
/// </summary>
public class RosterWeekSchemaPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RosterWeekSchemaPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private OdipDbContext Open(Guid tenantId) => PostgresFixture.NewContext(_pg.ConnectionString, TenantOf(tenantId));

    private async Task<Guid> NewOrganisationAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return tenantId;
    }

    private static RosterWeek Week(Guid tenantId, DateOnly monday) => new() { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday };

    [SkippableFact]
    public async Task RosterWeeks_AreUniquePerOrganisationAndMonday()
    {
        RequirePostgres();
        var a = await NewOrganisationAsync();
        var b = await NewOrganisationAsync();
        var monday = new DateOnly(2026, 10, 19);
        await using (var db = Open(a))
        {
            db.RosterWeeks.Add(Week(a, monday));
            await db.SaveChangesAsync();
        }

        await using (var db = Open(a))
        {
            db.RosterWeeks.Add(Week(a, monday));
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
            Assert.Equal(PostgresErrorCodes.UniqueViolation, Assert.IsType<PostgresException>(ex.InnerException).SqlState);
        }

        await using (var db = Open(b))
        {
            db.RosterWeeks.Add(Week(b, monday));
            await db.SaveChangesAsync();
        }
    }

    [SkippableFact]
    public async Task DeletingTheRegularsUser_KeepsTheShift_AndClearsRegularUserId()
    {
        RequirePostgres();
        var tenantId = await NewOrganisationAsync();
        Guid kimId, shiftId;
        await using (var db = Open(tenantId))
        {
            var kim = db.Users.Add(new User
            {
                Id = Guid.NewGuid(), FirstName = "Kim", LastName = "Lee", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
                Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            }).Entity;
            var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Test", IsActive = true }).Entity;
            shiftId = db.Shifts.Add(new Shift
            {
                Id = Guid.NewGuid(), ParticipantId = mia.Id, UserId = null, RegularUserId = kim.Id, RegularAwayReason = "on approved leave", ServiceDate = new DateOnly(2026, 10, 20),
                StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
            }).Entity.Id;
            kimId = kim.Id;
            await db.SaveChangesAsync();
        }

        await using (var db = Open(tenantId))
            await db.Database.ExecuteSqlRawAsync("DELETE FROM \"Users\" WHERE \"Id\" = {0}", kimId);

        await using var check = Open(tenantId);
        var shift = await check.Shifts.AsNoTracking().SingleAsync(s => s.Id == shiftId);
        Assert.Null(shift.RegularUserId);
        Assert.Equal("on approved leave", shift.RegularAwayReason);
    }

    [Theory]
    [InlineData("2026-10-19", "2026-10-19")]
    [InlineData("2026-10-21", "2026-10-19")]
    [InlineData("2026-10-25", "2026-10-19")]
    public void MondayOf_IsTheMondayOfTheWeek(string day, string monday) =>
        Assert.Equal(DateOnly.Parse(monday), RosterWeek.MondayOf(DateOnly.Parse(day)));
}
