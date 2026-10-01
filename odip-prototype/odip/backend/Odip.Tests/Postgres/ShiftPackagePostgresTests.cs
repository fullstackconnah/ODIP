using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// A scratch PostgreSQL database for tests that EF InMemory cannot answer: the provider hides unique/partial indexes,
/// real concurrency, ordering/null semantics and LINQ translation. Created from the server named by the
/// <c>POSTGRES_CONNECTION_STRING</c> environment variable (the same one the PR workflow's Postgres service provides) and dropped
/// afterwards. With the variable unset - a developer machine, or the Docker image build, which runs <c>dotnet test</c> with no
/// database - every test that uses it is SKIPPED, never failed.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private string? _baseConnectionString;
    private readonly List<string> _databases = new();

    public bool Available => _baseConnectionString is not null;

    /// <summary>The fully migrated scratch database every shared-state test uses (each test works on its own rows).</summary>
    public string ConnectionString { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        var env = Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(env)) return;
        _baseConnectionString = env;

        ConnectionString = await CreateDatabaseAsync();
        await using var db = NewContext(ConnectionString);
        await db.Database.MigrateAsync();
    }

    /// <summary>Creates an empty scratch database and returns its connection string. Dropped when the fixture is disposed.</summary>
    public async Task<string> CreateDatabaseAsync()
    {
        var name = "odip_shiftpkg_" + Guid.NewGuid().ToString("N");
        var admin = new NpgsqlConnectionStringBuilder(_baseConnectionString) { Database = "postgres" };
        await using (var conn = new NpgsqlConnection(admin.ConnectionString))
        {
            await conn.OpenAsync();
            await using var cmd = new NpgsqlCommand($"CREATE DATABASE \"{name}\"", conn);
            await cmd.ExecuteNonQueryAsync();
        }
        _databases.Add(name);
        return new NpgsqlConnectionStringBuilder(_baseConnectionString) { Database = name }.ConnectionString;
    }

    public static OdipDbContext NewContext(string connectionString, ICurrentTenant? tenant = null)
    {
        if (tenant is null)
        {
            var mock = new Mock<ICurrentTenant>();
            mock.Setup(t => t.TenantId).Returns((Guid?)null);
            mock.Setup(t => t.IsSuperAdmin).Returns(true);
            tenant = mock.Object;
        }
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(connectionString).Options, tenant);
    }

    /// <summary>Creates a tenant row and returns a context scoped to it - so query filters and TenantId assignment behave as in production.</summary>
    public async Task<(OdipDbContext Db, Guid TenantId)> NewTenantContextAsync(string? connectionString = null)
    {
        var cs = connectionString ?? ConnectionString;
        var tenantId = Guid.NewGuid();
        await using (var admin = NewContext(cs))
        {
            admin.Tenants.Add(new Tenant { Id = tenantId, Name = "Test Provider", EmailDomain = $"{tenantId:N}.example.com" });
            await admin.SaveChangesAsync();
        }
        var mock = new Mock<ICurrentTenant>();
        mock.Setup(t => t.TenantId).Returns(tenantId);
        mock.Setup(t => t.IsSuperAdmin).Returns(false);
        return (NewContext(cs, mock.Object), tenantId);
    }

    public async Task DisposeAsync()
    {
        if (_baseConnectionString is null) return;
        NpgsqlConnection.ClearAllPools();
        var admin = new NpgsqlConnectionStringBuilder(_baseConnectionString) { Database = "postgres" };
        await using var conn = new NpgsqlConnection(admin.ConnectionString);
        await conn.OpenAsync();
        foreach (var name in _databases)
        {
            await using var cmd = new NpgsqlCommand($"DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)", conn);
            await cmd.ExecuteNonQueryAsync();
        }
    }
}

/// <summary>
/// The shift package against a real PostgreSQL: the migrations apply (including over existing duplicate dose slots - the deploy-safety
/// claim), the new indexes behave, concurrent idempotent submits create exactly one record, and every new read path translates to SQL.
/// </summary>
public class ShiftPackagePostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ShiftPackagePostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    // ══════════════════════ deploy safety ══════════════════════

    private static async Task InsertMinimalRowAsync(NpgsqlConnection conn, string table, Dictionary<string, object?> values)
    {
        // Fills every NOT NULL column without a default with a type-appropriate filler, so a row can be inserted into a schema as it
        // was at an OLD migration without knowing every column (the current EF model no longer matches that schema).
        var columns = new List<(string Name, string DataType, bool Nullable, bool HasDefault)>();
        await using (var cmd = new NpgsqlCommand(
                   "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
                   "WHERE table_schema = 'public' AND table_name = @t ORDER BY ordinal_position", conn))
        {
            cmd.Parameters.AddWithValue("t", table);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                columns.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2) == "YES", !reader.IsDBNull(3)));
        }

        var names = new List<string>();
        var placeholders = new List<string>();
        await using var insert = new NpgsqlCommand { Connection = conn };
        var i = 0;
        foreach (var c in columns)
        {
            if (values.TryGetValue(c.Name, out var provided))
            {
                names.Add($"\"{c.Name}\"");
                placeholders.Add($"@p{i}");
                insert.Parameters.AddWithValue($"p{i++}", provided ?? DBNull.Value);
            }
            else if (!c.Nullable && !c.HasDefault)
            {
                names.Add($"\"{c.Name}\"");
                placeholders.Add(c.DataType switch
                {
                    "uuid" => "gen_random_uuid()",
                    "boolean" => "false",
                    "integer" or "smallint" or "bigint" or "numeric" or "double precision" or "real" => "0",
                    "timestamp without time zone" or "timestamp with time zone" => "now()",
                    "date" => "current_date",
                    "time without time zone" => "'00:00'",
                    "jsonb" or "json" => "'{}'",
                    "ARRAY" => "'{}'",
                    _ => "''",
                });
            }
        }
        insert.CommandText = $"INSERT INTO \"{table}\" ({string.Join(", ", names)}) VALUES ({string.Join(", ", placeholders)})";
        await insert.ExecuteNonQueryAsync();
    }

    [SkippableFact]
    public async Task TheMigrations_ApplyOverExistingDuplicateDoseSlots_WhichAPlainUniqueSlotIndexWouldNotSurvive()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();

        // 1. The schema as it was BEFORE the shift-package migrations (the last migration on main).
        await migrator.MigrateAsync("20260926003000_AddElectronicSigningEvidence");

        // 2. Existing production-shaped data: the same (medication, ScheduledAt) slot recorded twice - nothing ever prevented it.
        var tenantId = Guid.NewGuid();
        var participantId = Guid.NewGuid();
        var medicationId = Guid.NewGuid();
        var slot = new DateTime(2026, 7, 14, 8, 0, 0, DateTimeKind.Unspecified);
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await InsertMinimalRowAsync(conn, "Tenants", new() { ["Id"] = tenantId, ["Name"] = "Test Provider", ["EmailDomain"] = $"{tenantId:N}.example.com" });
            await InsertMinimalRowAsync(conn, "ProviderSettings", new() { ["Id"] = Guid.NewGuid(), ["TenantId"] = tenantId });   // an existing provider, before the mode column
            await InsertMinimalRowAsync(conn, "Participants", new() { ["Id"] = participantId, ["TenantId"] = tenantId, ["FirstName"] = "Sophie", ["LastName"] = "Brown" });
            await InsertMinimalRowAsync(conn, "ParticipantMedications", new() { ["Id"] = medicationId, ["TenantId"] = tenantId, ["ParticipantId"] = participantId, ["Name"] = "Levetiracetam" });
            for (var n = 0; n < 2; n++)
                await InsertMinimalRowAsync(conn, "MedicationAdministrations", new()
                {
                    ["Id"] = Guid.NewGuid(), ["TenantId"] = tenantId, ["ParticipantMedicationId"] = medicationId, ["ParticipantId"] = participantId,
                    ["ScheduledAt"] = slot, ["RecordedByName"] = "Jamie Lee",
                });

            // The rejected approach, demonstrated: a plain unique index on the slot FAILS on this data - so it would have failed the deploy.
            await using var plain = new NpgsqlCommand(
                "CREATE UNIQUE INDEX \"IX_plain_slot\" ON \"MedicationAdministrations\" (\"ParticipantMedicationId\", \"ScheduledAt\")", conn);
            var failure = await Assert.ThrowsAsync<PostgresException>(() => plain.ExecuteNonQueryAsync());
            Assert.Equal("23505", failure.SqlState);
        }

        // 3. The shift-package migrations apply over it without error...
        await migrator.MigrateAsync();

        // ...and leave the duplicates untouched, with only a filtered unique index on the (all-NULL) idempotency key.
        await using var after = new NpgsqlConnection(connectionString);
        await after.OpenAsync();

        // Every existing provider is on Warn (0) and every existing record is unflagged: the constant defaults make the new columns
        // metadata-only and keep today's recording behaviour until an Admin chooses Enforce.
        await using (var mode = new NpgsqlCommand("SELECT \"MedicationCompetencyMode\" FROM \"ProviderSettings\" WHERE \"TenantId\" = @t", after))
        {
            mode.Parameters.AddWithValue("t", tenantId);
            Assert.Equal(0, await mode.ExecuteScalarAsync());
        }
        await using (var flagged = new NpgsqlCommand("SELECT count(*) FROM \"MedicationAdministrations\" WHERE \"RecordedWithoutCompetency\"", after))
            Assert.Equal(0L, await flagged.ExecuteScalarAsync());
        await using (var count = new NpgsqlCommand("SELECT count(*) FROM \"MedicationAdministrations\" WHERE \"ParticipantMedicationId\" = @m", after))
        {
            count.Parameters.AddWithValue("m", medicationId);
            Assert.Equal(2L, await count.ExecuteScalarAsync());
        }
        await using var indexes = new NpgsqlCommand(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'MedicationAdministrations' AND indexname = @n", after);
        indexes.Parameters.AddWithValue("n", MedicationAdministration.IdempotencyIndexName);
        var definition = (string?)await indexes.ExecuteScalarAsync();
        Assert.NotNull(definition);
        Assert.Contains("UNIQUE", definition);
        Assert.Contains("\"IdempotencyKey\" IS NOT NULL", definition);
        await using var slotIndexes = new NpgsqlCommand(
            "SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'MedicationAdministrations' " +
            "AND indexdef LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%ScheduledAt%'", after);
        Assert.Equal(0L, await slotIndexes.ExecuteScalarAsync());
    }

    [SkippableFact]
    public async Task EveryMigration_IsApplied_AndNothingIsPending()
    {
        RequirePostgres();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);

        Assert.Empty(await db.Database.GetPendingMigrationsAsync());
        Assert.Contains("20260930173148_AddShiftHandover", await db.Database.GetAppliedMigrationsAsync());
    }

    // ══════════════════════ the new indexes, for real ══════════════════════

    /// <summary>Seeds a participant, a competent worker, an InProgress shift and its active completion (TenantId is assigned by the scoped context).</summary>
    private static async Task<(Guid ParticipantId, Guid UserId, Guid ShiftId, Guid CompletionId)> SeedCompletionAsync(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        var user = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(),
            FirstName = "Ben", LastName = "Turner", Role = UserRole.SupportWorker, IsActive = true, IsMedicationCompetent = true,
            MedicationCompetencyExpiryDate = new DateOnly(2099, 1, 1),
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = user.Id, ServiceDate = new DateOnly(2026, 7, 14),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.InProgress,
        };
        var completion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = shift.Id, ActualStart = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = user.Id, StartedAt = new DateTime(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc), IsActive = true,
        };
        db.AddRange(participant, user, shift, completion);
        await db.SaveChangesAsync();
        return (participant.Id, user.Id, shift.Id, completion.Id);
    }

    [SkippableFact]
    public async Task OneRunningBreakPerCompletion_IsEnforcedByThePartialUniqueIndex_ButEndedBreaksAreUnlimited()
    {
        RequirePostgres();
        var (db, _) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (_, userId, _, completionId) = await SeedCompletionAsync(db);
        ShiftBreak Break(DateTime start, DateTime? end) => new() { Id = Guid.NewGuid(), ShiftCompletionId = completionId, StartedAt = start, EndedAt = end, CreatedByUserId = userId };
        var t0 = new DateTime(2026, 7, 14, 0, 0, 0, DateTimeKind.Utc);

        db.ShiftBreaks.AddRange(Break(t0, t0.AddMinutes(10)), Break(t0.AddMinutes(20), t0.AddMinutes(30)), Break(t0.AddMinutes(40), null));
        await db.SaveChangesAsync();   // two ended + one running: fine

        db.ShiftBreaks.Add(Break(t0.AddMinutes(50), null));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal("23505", pg.SqlState);
        Assert.Equal(ShiftBreak.OneRunningIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task TheIdempotencyIndex_IsUniquePerTenantOverNonNullKeysOnly_AndTheSlotIsNotConstrained()
    {
        RequirePostgres();
        var (dbA, tenantA) = await _pg.NewTenantContextAsync();
        var (dbB, tenantB) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        var med = new ParticipantMedication { Id = Guid.NewGuid(), ParticipantId = participant.Id, Name = "Levetiracetam", DoseDescription = "1", StartDate = new DateTime(2026, 1, 1) };
        dbA.AddRange(participant, med);
        await dbA.SaveChangesAsync();
        var slot = new DateTime(2026, 7, 14, 8, 0, 0);
        MedicationAdministration Admin(Guid tenant, string? key) => new()
        {
            Id = Guid.NewGuid(), TenantId = tenant, ParticipantMedicationId = med.Id, ParticipantId = participant.Id, ScheduledAt = slot,
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "x", IdempotencyKey = key,
        };

        // Same slot, NULL keys (every legacy row and every keyless submit): allowed, any number of times.
        dbA.MedicationAdministrations.AddRange(Admin(tenantA, null), Admin(tenantA, null), Admin(tenantA, null));
        // Same key in DIFFERENT tenants: allowed.
        dbA.MedicationAdministrations.Add(Admin(tenantA, "key-1"));
        dbB.MedicationAdministrations.Add(Admin(tenantB, "key-1"));
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        // Same key, same tenant: rejected by the filtered unique index.
        dbA.MedicationAdministrations.Add(Admin(tenantA, "key-1"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => dbA.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal(MedicationAdministration.IdempotencyIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task OneHandoverAcknowledgementPerReader_IsEnforcedByTheUniqueIndex()
    {
        RequirePostgres();
        var (db, _) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var (_, userId, shiftId, completionId) = await SeedCompletionAsync(db);
        HandoverAcknowledgement Ack() => new() { Id = Guid.NewGuid(), SourceCompletionId = completionId, ShiftId = shiftId, UserId = userId, AcknowledgedAt = DateTime.UtcNow };

        db.HandoverAcknowledgements.Add(Ack());
        await db.SaveChangesAsync();
        db.HandoverAcknowledgements.Add(Ack());

        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(HandoverAcknowledgement.UniqueReaderIndexName, Assert.IsType<PostgresException>(failure.InnerException).ConstraintName);
    }

    // ══════════════════════ concurrency ══════════════════════

    [SkippableFact]
    public async Task ConcurrentSubmitsWithTheSameKey_OnRealPostgres_CreateExactlyOneRecord_AndAllSucceed()
    {
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var (participantId, userId, _, _) = await SeedCompletionAsync(setup);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "08:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        setup.ParticipantMedications.Add(med);
        await setup.SaveChangesAsync();
        var key = Guid.NewGuid().ToString();
        var request = new RecordAdministrationRequest(
            med.Id,
            new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, ScheduledAt = new DateTime(2026, 7, 14, 8, 0, 0), IdempotencyKey = key },
            userId, "Ben Turner");
        var tenantMock = new Mock<ICurrentTenant>();
        tenantMock.Setup(t => t.TenantId).Returns(tenantId);
        tenantMock.Setup(t => t.IsSuperAdmin).Returns(false);

        using var gate = new ManualResetEventSlim(false);
        var attempts = Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            await using var db = PostgresFixture.NewContext(_pg.ConnectionString, tenantMock.Object);
            gate.Wait();
            return await new MedicationAdministrationRecorder(db).RecordAsync(request, default);
        })).ToList();
        gate.Set();
        var results = await Task.WhenAll(attempts);

        Assert.All(results, r => Assert.True(
            r.Outcome is RecordAdministrationOutcome.Created or RecordAdministrationOutcome.Replayed, $"unexpected outcome {r.Outcome}: {r.Message}"));
        Assert.Single(results.Select(r => r.Administration!.Id).Distinct());
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, tenantMock.Object);
        Assert.Equal(1, await verify.MedicationAdministrations.CountAsync(a => a.IdempotencyKey == key));
    }

    private static Mock<ICurrentTenant> TenantMock(Guid tenantId)
    {
        var mock = new Mock<ICurrentTenant>();
        mock.Setup(t => t.TenantId).Returns(tenantId);
        mock.Setup(t => t.IsSuperAdmin).Returns(false);
        return mock;
    }

    /// <summary>Runs <paramref name="attempt"/> <paramref name="count"/> times at once, each on its OWN context (as separate requests would), released together.</summary>
    private async Task<T[]> RaceAsync<T>(Guid tenantId, int count, Func<OdipDbContext, int, Task<T>> attempt)
    {
        var tenant = TenantMock(tenantId);
        using var gate = new ManualResetEventSlim(false);
        var tasks = Enumerable.Range(0, count).Select(n => Task.Run(async () =>
        {
            await using var db = PostgresFixture.NewContext(_pg.ConnectionString, tenant.Object);
            gate.Wait();
            return await attempt(db, n);
        })).ToList();
        gate.Set();
        return await Task.WhenAll(tasks);
    }

    [SkippableTheory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ConcurrentSubmitsForOneSlot_WithDifferentKeysOrNone_CreateExactlyOneRecord_AndTheRestAreTold409(bool withDistinctKeys)
    {
        // There is deliberately no unique index on (medication, slot), so one record per slot under concurrency rests on the advisory
        // lock the recorder takes on the slot: two workers on overlapping shifts, or a keyless double tap, cannot both pass the check.
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var (participantId, userId, _, _) = await SeedCompletionAsync(setup);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "08:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        setup.ParticipantMedications.Add(med);
        await setup.SaveChangesAsync();
        var slot = new DateTime(2026, 7, 14, 8, 0, 0);

        var results = await RaceAsync(tenantId, 8, (db, n) => new MedicationAdministrationRecorder(db).RecordAsync(
            new RecordAdministrationRequest(
                med.Id,
                new CreateAdministrationDto
                {
                    Status = MedicationAdministrationStatus.Administered, ScheduledAt = slot, IdempotencyKey = withDistinctKeys ? $"key-{n}-{Guid.NewGuid()}" : null,
                },
                userId, "Ben Turner"),
            default));

        Assert.Equal(1, results.Count(r => r.Outcome == RecordAdministrationOutcome.Created));
        Assert.Equal(7, results.Count(r => r.Outcome == RecordAdministrationOutcome.AlreadyRecorded));
        var winner = results.Single(r => r.Outcome == RecordAdministrationOutcome.Created).Administration!;
        Assert.All(results.Where(r => r.Outcome == RecordAdministrationOutcome.AlreadyRecorded), r => Assert.Equal(winner.Id, r.Administration!.Id));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(1, await verify.MedicationAdministrations.CountAsync(a => a.ParticipantMedicationId == med.Id && a.ScheduledAt == slot));
    }

    [SkippableFact]
    public async Task DifferentSlotsOfOneMedication_AreNotSerialisedIntoConflicts_EachGetsItsOwnRecord()
    {
        // The lock is per (medication, slot): recording the 08:00 and the 12:30 dose at the same moment must both succeed.
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var (participantId, userId, _, _) = await SeedCompletionAsync(setup);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "08:00,12:30", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        setup.ParticipantMedications.Add(med);
        await setup.SaveChangesAsync();

        var results = await RaceAsync(tenantId, 6, (db, n) => new MedicationAdministrationRecorder(db).RecordAsync(
            new RecordAdministrationRequest(
                med.Id,
                new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, ScheduledAt = new DateTime(2026, 7, 14, 8, 0, 0).AddMinutes(n * 30) },
                userId, "Ben Turner"),
            default));

        Assert.All(results, r => Assert.Equal(RecordAdministrationOutcome.Created, r.Outcome));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(6, await verify.MedicationAdministrations.CountAsync(a => a.ParticipantMedicationId == med.Id));
    }

    [SkippableFact]
    public async Task ConcurrentBreakStarts_OnRealPostgres_LeaveExactlyOneRunningBreak_AndTheRestAreToldAlreadyRunning()
    {
        // Exercises the unique-violation branch of ShiftBreakService.StartAsync (the partial unique index: one running break per completion).
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var (_, userId, _, completionId) = await SeedCompletionAsync(setup);

        var results = await RaceAsync(tenantId, 8, async (db, _) =>
        {
            var completion = await db.ShiftCompletions.SingleAsync(c => c.Id == completionId);
            return await new ShiftBreakService(db).StartAsync(completion, userId, default);
        });

        Assert.Equal(1, results.Count(r => r.Outcome == ShiftBreakOutcome.Ok));
        Assert.Equal(7, results.Count(r => r.Outcome == ShiftBreakOutcome.AlreadyRunning));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(1, await verify.ShiftBreaks.CountAsync(b => b.ShiftCompletionId == completionId && b.EndedAt == null));
    }

    [SkippableFact]
    public async Task ConcurrentHandoverAcknowledgements_OnRealPostgres_AreAllOk_AndLeaveOneRow()
    {
        // Exercises the unique-violation branch of ShiftHandoverService.AcknowledgeAsync (one acknowledgement per reader per handover).
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using var _setup = setup;
        var (participantId, userId, shiftId, _) = await SeedCompletionAsync(setup);
        var previous = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = "Tom", LastName = "Beattie",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        var previousShift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = previous.Id, ServiceDate = new DateOnly(2026, 7, 13),
            StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.PendingReview,
        };
        var previousCompletion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = previousShift.Id, ActualStart = new DateTime(2026, 7, 12, 21, 0, 0, DateTimeKind.Utc),
            ActualEnd = new DateTime(2026, 7, 13, 5, 0, 0, DateTimeKind.Utc), TimeZoneId = "Australia/Sydney", SubmittedByUserId = previous.Id,
            StartedAt = new DateTime(2026, 7, 12, 21, 0, 0, DateTimeKind.Utc), SubmittedAt = new DateTime(2026, 7, 13, 5, 0, 0, DateTimeKind.Utc),
            IsActive = true, HandoverText = "Check the left heel.",
        };
        setup.AddRange(previous, previousShift, previousCompletion);
        await setup.SaveChangesAsync();

        var outcomes = await RaceAsync(tenantId, 8, async (db, _) =>
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == shiftId);
            return await new ShiftHandoverService(db).AcknowledgeAsync(shift, userId, null, default);
        });

        Assert.All(outcomes, o => Assert.Equal(HandoverAckOutcome.Ok, o));
        await using var verify = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        Assert.Equal(1, await verify.HandoverAcknowledgements.CountAsync(a => a.SourceCompletionId == previousCompletion.Id && a.UserId == userId));
    }

    [SkippableFact]
    public async Task ARetryAndA409_OnRealPostgres_ReturnTheRecordsInstantsAsUtc()
    {
        // A record read back from PostgreSQL has Kind=Unspecified (legacy timestamp behaviour): without the portal's normalisation the
        // replay and the 409 body would serialise their instants without a Z while a fresh record carries one.
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), State = "NSW" });
        var (participantId, userId, shiftId, _) = await SeedCompletionAsync(db);
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "09:00", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.ParticipantMedications.Add(med);
        await db.SaveChangesAsync();
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test");
        PortalController PortalFor(OdipDbContext context) => new(context, TenantMock(tenantId).Object, clock: FakeClock.AtUtc(2026, 7, 14, 7, 0))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
        var slot = new DateTime(2026, 7, 14, 9, 0, 0);
        var created = await PortalFor(db).RecordShiftDose(shiftId, med.Id, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, ScheduledAt = slot, IdempotencyKey = "k-utc" }, default);
        Assert.Equal(DateTimeKind.Utc, Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(created.Result).Value).Data!.AdministeredAt!.Value.Kind);

        // A fresh context, so the record is READ from PostgreSQL rather than handed back from the change tracker.
        await using var fresh = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        var replay = await PortalFor(fresh).RecordShiftDose(shiftId, med.Id, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, ScheduledAt = slot, IdempotencyKey = "k-utc" }, default);
        await using var fresh2 = PostgresFixture.NewContext(_pg.ConnectionString, TenantMock(tenantId).Object);
        var conflict = await PortalFor(fresh2).RecordShiftDose(shiftId, med.Id, new CreateAdministrationDto { Status = MedicationAdministrationStatus.Administered, ScheduledAt = slot, IdempotencyKey = "k-other" }, default);

        var replayed = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<OkObjectResult>(replay.Result).Value).Data!;
        var conflicting = Assert.IsType<ApiResponse<AdministrationDto>>(Assert.IsType<ConflictObjectResult>(conflict.Result).Value).Data!;
        foreach (var record in new[] { replayed, conflicting })
        {
            Assert.Equal(DateTimeKind.Utc, record.AdministeredAt!.Value.Kind);
            Assert.Equal(DateTimeKind.Utc, record.CreatedAt.Kind);
        }
    }

    // ══════════════════════ every new read path translates to SQL ══════════════════════

    [SkippableFact]
    public async Task ThePortalShiftPackage_AndTheCoordinatorReview_AndTheMar_TranslateAndRunOnNpgsql()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _db = db;
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), State = "NSW" });
        var (participantId, userId, shiftId, completionId) = await SeedCompletionAsync(db);

        var p = await db.Participants.SingleAsync(x => x.Id == participantId);
        p.AllergiesDetail = "Peanuts"; p.IsAnaphylaxisRisk = true; p.NdisNumber = "431234567"; p.PrimaryDiagnosis = "Cerebral palsy";
        var person = new Person { Id = Guid.NewGuid(), FirstName = "Priya", LastName = "Whitfield", Mobile = "0400 555 142" };
        db.People.Add(person);
        db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, PersonId = person.Id, RoleType = ContactRoleType.EmergencyContact, PriorityOrder = 1, IsPrimary = true,
            Status = ContactRoleStatus.Active, RelationshipToParticipant = "Mother",
        });
        var med = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Levetiracetam", Strength = "500mg", DoseDescription = "1 tablet", Type = MedicationType.Regular,
            TimesOfDay = "09:00,12:30", StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        };
        var prn = new ParticipantMedication
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Name = "Paracetamol", DoseDescription = "2 tablets", Type = MedicationType.Prn, PrnIndication = "Pain",
            PrnMaxDosesPer24h = 4, StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active,
        };
        db.ParticipantMedications.AddRange(med, prn);
        db.MedicationAdministrations.Add(new MedicationAdministration
        {
            Id = Guid.NewGuid(), ParticipantMedicationId = med.Id, ParticipantId = participantId, ScheduledAt = new DateTime(2026, 7, 14, 9, 0, 0),
            Status = MedicationAdministrationStatus.Administered, RecordedByName = "Ben Turner", AdministeredAt = DateTime.UtcNow,
        });
        db.ParticipantRoutines.Add(new ParticipantRoutine
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, Title = "Lunch", StartTime = new TimeOnly(12, 0), EndTime = new TimeOnly(13, 0),
            Days = ParticipantRoutineDays.All, IsActive = true, IsCritical = true,
        });
        // A previous worker's submitted completion with a handover, and a break on ours.
        var previous = new User
        {
            Id = Guid.NewGuid(), Email = $"{Guid.NewGuid()}@example.com", Username = Guid.NewGuid().ToString(), FirstName = "Tom", LastName = "Beattie",
            Role = UserRole.SupportWorker, IsActive = true,
        };
        var previousShift = new Shift { Id = Guid.NewGuid(), ParticipantId = participantId, UserId = previous.Id, ServiceDate = new DateOnly(2026, 7, 13), StartTime = new TimeOnly(7, 0), EndTime = new TimeOnly(15, 0), Status = ShiftStatus.PendingReview };
        var previousCompletion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = previousShift.Id, ActualStart = new DateTime(2026, 7, 12, 21, 0, 0, DateTimeKind.Utc), ActualEnd = new DateTime(2026, 7, 13, 5, 0, 0, DateTimeKind.Utc),
            TimeZoneId = "Australia/Sydney", SubmittedByUserId = previous.Id, StartedAt = new DateTime(2026, 7, 12, 21, 0, 0, DateTimeKind.Utc),
            SubmittedAt = new DateTime(2026, 7, 13, 5, 0, 0, DateTimeKind.Utc), IsActive = true, HandoverText = "Check the left heel.",
        };
        db.AddRange(previous, previousShift, previousCompletion);
        db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), ShiftCompletionId = completionId, CreatedByUserId = userId, StartedAt = new DateTime(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc),
            EndedAt = new DateTime(2026, 7, 14, 1, 30, 0, DateTimeKind.Utc),
        });
        db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), ShiftId = shiftId, AuthorUserId = userId, AuthorName = "Ben Turner", Body = "All good." });
        await db.SaveChangesAsync();

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "Test");
        // 17:00 local (AEST) on the shift's day: every slot of the 09:00-17:00 shift has come due, whatever the machine's clock says.
        var portal = new PortalController(db, tenant.Object, clock: FakeClock.AtUtc(2026, 7, 14, 7, 0))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };

        // The shift package: every new query runs on Npgsql.
        var detailResult = await portal.GetShiftDetail(shiftId, default);
        var detail = Assert.IsType<ApiResponse<PortalShiftDetailDto>>(Assert.IsType<OkObjectResult>(detailResult.Result).Value).Data!;
        Assert.True(detail.AtAGlance.Allergies.IsAnaphylaxisRisk);
        Assert.Equal("Priya Whitfield", Assert.Single(detail.EmergencyContacts).Name);
        Assert.Equal(["09:00", "12:30"], detail.MedicationsDue.Select(d => d.ScheduledTime));
        Assert.Equal(PortalDoseState.Recorded, detail.MedicationsDue[0].State);
        Assert.Equal("Paracetamol", Assert.Single(detail.Prn).MedicationName);
        Assert.Equal("Lunch", Assert.Single(detail.ShiftRoutines).Title);
        Assert.Equal("Check the left heel.", detail.Handover!.Text);
        Assert.Equal("Tom Beattie", Assert.Single(detail.HandoverTrail).WorkerName);
        Assert.Equal(30, Assert.Single(detail.Breaks).Minutes);
        var blocker = Assert.Single(detail.FinishBlockers);   // 12:30 has no outcome
        Assert.Equal(ShiftFinishBlockerCodes.DoseOutcomeMissing, blocker.Code);

        // The handover acknowledgement and the dose recording write to Postgres.
        Assert.True(Assert.IsType<ApiResponse<PortalShiftDetailDto>>(Assert.IsType<OkObjectResult>(
            (await portal.AcknowledgeHandover(shiftId, null, default)).Result).Value).Data!.Handover!.IsRead);
        var record = await portal.RecordShiftDose(shiftId, med.Id,
            new CreateAdministrationDto { Status = MedicationAdministrationStatus.Missed, Reason = "Finished early", ScheduledAt = new DateTime(2026, 7, 14, 12, 30, 0), IdempotencyKey = "k-pg" }, default);
        Assert.IsType<OkObjectResult>(record.Result);

        // Finish now passes (nothing blocking, a note exists) and stores the handover.
        var finished = await portal.FinishShift(shiftId, new FinishShiftDto { HandoverText = "All settled." }, default);
        Assert.Equal(ShiftStatus.PendingReview, Assert.IsType<ApiResponse<PortalShiftDetailDto>>(Assert.IsType<OkObjectResult>(finished.Result).Value).Data!.Status);

        // The coordinator's review and the MAR.
        var rostering = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var review = Assert.IsType<ApiResponse<ShiftCompletionReviewDto>>(Assert.IsType<OkObjectResult>((await rostering.GetShiftCompletionReview(shiftId, default)).Result).Value).Data!;
        Assert.Equal("All settled.", review.Completion.HandoverText);
        Assert.All(review.Doses, d => Assert.NotNull(d.Outcome));
        var medications = new MedicationsController(db, tenant.Object);
        var mar = Assert.IsType<ApiResponse<MarDayDto>>(Assert.IsType<OkObjectResult>((await medications.GetMar(new DateOnly(2026, 7, 14), participantId, default)).Result).Value).Data!;
        Assert.Equal(2, mar.Entries.Count);
    }
}
