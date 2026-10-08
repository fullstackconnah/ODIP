using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The NDIA rejection code against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these run in CI and not on a machine with
/// no server). EF InMemory cannot show that the migration applies over live claims, that the new columns are empty for them, or that the ten-character limit is the database's too.
/// </summary>
public class NdiaRejectionPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddTripClaimRejectionCode";

    private readonly PostgresFixture _pg;
    public NdiaRejectionPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static async Task InsertLiveClaimAsync(string connectionString, Guid id, string reference, TripClaimStatus status, decimal amount)
    {
        // Raw SQL, because the model now carries the two new columns and the schema these rows go into does not have them yet.
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var command = new NpgsqlCommand(
            "INSERT INTO \"TripClaims\" (\"Id\",\"Kind\",\"Status\",\"ClaimReference\",\"TotalAmount\",\"TotalApprovedAmount\",\"CreatedAt\") VALUES (@id,1,@status,@reference,@amount,0,@created)", conn);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("status", (int)status);
        command.Parameters.AddWithValue("reference", reference);
        command.Parameters.AddWithValue("amount", amount);
        command.Parameters.AddWithValue("created", new DateTime(2026, 9, 1, 2, 0, 0, DateTimeKind.Unspecified));
        await command.ExecuteNonQueryAsync();
    }

    [SkippableFact]
    public async Task TheMigration_AppliesOverLiveClaims_LeavesThemAsTheyWere_AndTheNewColumnsAreEmpty()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();

        // 1. The schema as it was before this migration, holding claims of every shape the money screens know: submitted, paid and already rejected.
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var submitted = Guid.NewGuid();
        var paid = Guid.NewGuid();
        var rejected = Guid.NewGuid();
        await InsertLiveClaimAsync(connectionString, submitted, "TC-LIVE-1", TripClaimStatus.Submitted, 1250.5m);
        await InsertLiveClaimAsync(connectionString, paid, "TC-LIVE-2", TripClaimStatus.Paid, 400m);
        await InsertLiveClaimAsync(connectionString, rejected, "TC-LIVE-3", TripClaimStatus.Rejected, 99.99m);

        // 2. The migration applies without error and keeps every claim as it was, with the two new columns empty: nothing is inferred for a claim rejected before this existed.
        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var claims = await after.TripClaims.AsNoTracking().OrderBy(c => c.ClaimReference).ToListAsync();
        Assert.Equal(new[] { "TC-LIVE-1", "TC-LIVE-2", "TC-LIVE-3" }, claims.Select(c => c.ClaimReference));
        Assert.Equal(new[] { TripClaimStatus.Submitted, TripClaimStatus.Paid, TripClaimStatus.Rejected }, claims.Select(c => c.Status));
        Assert.Equal(new[] { 1250.5m, 400m, 99.99m }, claims.Select(c => c.TotalAmount));
        Assert.All(claims, c => { Assert.Null(c.RejectionCode); Assert.Null(c.RejectedDate); });
    }

    [SkippableFact]
    public async Task ACode_RoundTrips_AtTenCharacters_AndTheDatabaseRefusesEleven()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();

        var claimId = Guid.NewGuid();
        var rejectedAt = new DateTime(2026, 10, 4, 3, 0, 0, DateTimeKind.Unspecified);
        await using (var write = PostgresFixture.NewContext(connectionString))
        {
            write.TripClaims.Add(new TripClaim
            {
                Id = claimId, Kind = ClaimKind.Shift, Status = TripClaimStatus.Rejected, ClaimReference = "TC-CODE-1", TotalAmount = 400m, RejectionCode = "C16 dates1", RejectedDate = rejectedAt,
            });
            await write.SaveChangesAsync();
        }

        await using (var read = PostgresFixture.NewContext(connectionString))
        {
            var stored = await read.TripClaims.AsNoTracking().SingleAsync(c => c.Id == claimId);
            Assert.Equal(("C16 dates1", rejectedAt), (stored.RejectionCode, stored.RejectedDate));
        }

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var tooLong = new NpgsqlCommand("UPDATE \"TripClaims\" SET \"RejectionCode\" = @code WHERE \"Id\" = @id", conn);
        tooLong.Parameters.AddWithValue("code", "ELEVEN CHAR");
        tooLong.Parameters.AddWithValue("id", claimId);
        var error = await Assert.ThrowsAsync<PostgresException>(() => tooLong.ExecuteNonQueryAsync());
        Assert.Equal("22001", error.SqlState);
    }
}
