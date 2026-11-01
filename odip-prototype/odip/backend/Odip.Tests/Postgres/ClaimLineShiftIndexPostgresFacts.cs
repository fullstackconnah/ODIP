using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// Shift billing PR2 on a real PostgreSQL: the unique partial index IX_ClaimLineItems_ShiftId_Counting (one line per shift unless that line is Rejected), and the two new support type columns.
/// Skipped, never failed, without POSTGRES_CONNECTION_STRING; the runner's dotnet target provides one.
/// </summary>
public class ClaimLineShiftIndexPostgresFacts : IClassFixture<PostgresFixture>
{
    private const string IndexName = "IX_ClaimLineItems_ShiftId_Counting";
    private readonly PostgresFixture _pg;
    public ClaimLineShiftIndexPostgresFacts(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ClaimLineItem Line(Guid tenantId, Guid claimId, Guid shiftId, ClaimLineItemStatus status = ClaimLineItemStatus.Draft) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, TripClaimId = claimId, ShiftId = shiftId, SupportItemCode = "04_104_0125_6_1", DayType = ClaimDayType.Weekday,
        SupportsDeliveredFrom = new DateOnly(2026, 10, 2), SupportsDeliveredTo = new DateOnly(2026, 10, 2), Hours = 1m, UnitPrice = 100m, TotalAmount = 100m, GSTCode = GSTCode.P2, Status = status,
    };

    private static TripClaim Claim(Guid tenantId, Guid participantId, TripClaimStatus status = TripClaimStatus.Draft) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, Kind = ClaimKind.Shift, ParticipantId = participantId, PeriodFrom = new DateOnly(2026, 10, 1), PeriodTo = new DateOnly(2026, 10, 14),
        Status = status, ClaimReference = "CLM-" + Guid.NewGuid().ToString("N")[..8],
    };

    private async Task<(OdipDbContext Db, Guid TenantId, Participant Person, Shift Shift)> SeedAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync(_pg.ConnectionString);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", db.Database.ProviderName);   // so an InMemory run can never satisfy this class
        var person = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = person.Id, ServiceDate = new DateOnly(2026, 10, 2), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(10, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.AddRange(person, shift);
        await db.SaveChangesAsync();
        return (db, tenantId, person, shift);
    }

    private static bool IsTheIndex(DbUpdateException e) =>
        e.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: IndexName };

    [SkippableFact(DisplayName = "Postgres: a second counting line for one shift is refused by the unique index")]
    public async Task SecondCountingLine_ForOneShift_IsRefused()
    {
        RequirePostgres();
        var (db, tenantId, person, shift) = await SeedAsync();
        await using var _ = db;
        var first = Claim(tenantId, person.Id);
        db.AddRange(first, Line(tenantId, first.Id, shift.Id));
        await db.SaveChangesAsync();

        var second = Claim(tenantId, person.Id);
        db.AddRange(second, Line(tenantId, second.Id, shift.Id));
        var e = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.True(IsTheIndex(e), e.InnerException?.Message);
    }

    [SkippableFact(DisplayName = "Postgres: a line can take the shift again once the first line is Rejected")]
    public async Task AnotherLine_IsAllowed_AfterTheFirstIsRejected()
    {
        RequirePostgres();
        var (db, tenantId, person, shift) = await SeedAsync();
        await using var _ = db;
        var first = Claim(tenantId, person.Id);
        var firstLine = Line(tenantId, first.Id, shift.Id);
        db.AddRange(first, firstLine);
        await db.SaveChangesAsync();
        firstLine.Status = ClaimLineItemStatus.Rejected;
        await db.SaveChangesAsync();

        var second = Claim(tenantId, person.Id);
        db.AddRange(second, Line(tenantId, second.Id, shift.Id));
        await db.SaveChangesAsync();   // does not throw

        Assert.Equal(2, await db.ClaimLineItems.CountAsync(l => l.ShiftId == shift.Id));
    }

    [SkippableFact(DisplayName = "Postgres: a line still Submitted on a claim marked Rejected keeps blocking (option A, pinned by name)")]
    public async Task LineOnAHandRejectedClaim_StillBlocks()
    {
        RequirePostgres();
        var (db, tenantId, person, shift) = await SeedAsync();
        await using var _ = db;
        var first = Claim(tenantId, person.Id, TripClaimStatus.Rejected);
        db.AddRange(first, Line(tenantId, first.Id, shift.Id, ClaimLineItemStatus.Submitted));
        await db.SaveChangesAsync();

        var second = Claim(tenantId, person.Id);
        db.AddRange(second, Line(tenantId, second.Id, shift.Id));
        var e = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.True(IsTheIndex(e), e.InnerException?.Message);
    }

    [SkippableFact(DisplayName = "Postgres: the support type columns are nullable varchar(50) and existing rows read null")]
    public async Task SupportGroupCode_ExistingRowsNull()
    {
        RequirePostgres();
        var (db, _, _, shift) = await SeedAsync();
        await using var _ = db;

        await using var connection = new NpgsqlConnection(_pg.ConnectionString);
        await connection.OpenAsync();
        await using var columns = new NpgsqlCommand(
            "SELECT table_name, character_maximum_length, is_nullable FROM information_schema.columns WHERE column_name = 'SupportGroupCode' AND table_name IN ('Shifts', 'ShiftPatterns') ORDER BY table_name", connection);
        var found = new List<string>();
        await using (var reader = await columns.ExecuteReaderAsync())
            while (await reader.ReadAsync()) found.Add($"{reader.GetString(0)}|{reader.GetInt32(1)}|{reader.GetString(2)}");
        Assert.Equal(new[] { "ShiftPatterns|50|YES", "Shifts|50|YES" }, found);

        // A row saved without a type (every row from before this change) reads null, and a type round-trips.
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id)).SupportGroupCode);
        (await db.Shifts.SingleAsync(s => s.Id == shift.Id)).SupportGroupCode = "GRP_COMMUNITY_PARTICIPATION";
        await db.SaveChangesAsync();
        Assert.Equal("GRP_COMMUNITY_PARTICIPATION", (await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id)).SupportGroupCode);
    }
}
