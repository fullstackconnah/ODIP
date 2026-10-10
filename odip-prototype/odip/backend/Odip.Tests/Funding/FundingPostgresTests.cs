using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Funding.FundingTestKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget record against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these run in CI and
/// not on a machine without a server). EF InMemory cannot show that the migration applies over live rows, that a unique index holds, what a numeric(18,2) column does to
/// a figure, that a cascade runs, that the service's queries translate to SQL, or what two requests at once do.
///
/// How two overlapping plans are kept apart, and why (the spec asks for it to be documented): the unique index on (tenant, participant, plan start) only catches two plans that
/// start on the same day. Overlap between different start days is a check, and a check-then-insert lets two requests at once both pass it. So every create and replace takes a
/// TRANSACTION-LEVEL lock first (<see cref="FundingPlanLock"/>: <c>SELECT ... FOR NO KEY UPDATE</c> on the participant's row, held until the save commits). The second request
/// waits, reads what the first committed, and is refused as an overlap. The unique-violation catch in the service is the backstop. The concurrency tests below run both paths
/// at once, repeatedly, so a missing lock would show as two plans.
/// </summary>
public class FundingPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddParticipantBudgetRecord";

    private readonly PostgresFixture _pg;
    public FundingPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static OdipDbContext Open(string connectionString, Guid tenantId) => PostgresFixture.NewContext(connectionString, TenantOf(tenantId));

    /// <summary>A migrated scratch database holding one tenant and <paramref name="participants"/> participants of it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, List<Guid> ParticipantIds)> SetUpAsync(int participants = 1)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var ids = new List<Guid>();
            for (var i = 0; i < participants; i++)
            {
                var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Synthetic", LastName = "Participant" + i, IsActive = true, IsDraft = false }).Entity;
                ids.Add(participant.Id);
            }
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, ids);
        }
    }

    /// <summary>A plan row with one pool and one period, written straight to the context (no service), for the tests of the storage itself.</summary>
    private static FundingPlan StoredPlan(Guid tenantId, Guid participantId, DateOnly start, DateOnly end, decimal amount = 1000m, decimal? setAside = null)
    {
        var plan = new FundingPlan
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, PlanStart = start, PlanEnd = end, Evidence = BudgetEvidenceSource.PlanCopy, Revision = 1,
            CreatedAt = Now.UtcDateTime, UpdatedAt = Now.UtcDateTime, CreatedBy = "test", UpdatedBy = "test",
        };
        var pool = new FundingPool { Id = Guid.NewGuid(), TenantId = tenantId, FundingPlanId = plan.Id, Position = 0, Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = PlanType.PlanManaged, Name = "Core (flexible)" };
        pool.Periods.Add(new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = pool.Id, Position = 0, PeriodStart = start, PeriodEnd = end, PlanAmount = amount, SetAside = setAside });
        plan.Pools.Add(pool);
        return plan;
    }

    private static SaveFundingPlanDto WholePlan(DateOnly start, DateOnly end, decimal amount = 1000m) => new()
    {
        PlanStart = start, PlanEnd = end, PeriodLengthMonths = null, Evidence = BudgetEvidenceSource.PlanCopy,
        Pools = new List<SaveFundingPoolDto> { Core(periods: new() { Period(start, end, amount) }) },
    };

    private static async Task<string> SqlStateOfAsync(Func<Task> action)
    {
        var ex = await Assert.ThrowsAnyAsync<Exception>(action);
        var pg = ex as PostgresException ?? ex.InnerException as PostgresException ?? ex.InnerException?.InnerException as PostgresException;
        Assert.NotNull(pg);
        return pg!.SqlState;
    }

    private static async Task<long> CountAsync(string connectionString, string sql, params (string Name, object Value)[] parameters)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var command = new NpgsqlCommand(sql, conn);
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    // ── The migration ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task TheMigration_AppliesOverLiveRows_KeepsThemUntouched_AndTheDefaultsAndTheUniqueIndexHold()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();

        // 1. The schema as it was before this migration, holding live-shaped rows: a tenant with settings, and a participant with plan dates.
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);

        var tenantId = Guid.NewGuid();
        var participantId = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Live Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
        db.Participants.Add(new Participant { Id = participantId, TenantId = tenantId, FirstName = "Live", LastName = "Participant", IsActive = true, PlanStartDate = D(2026, 7, 1), PlanEndDate = D(2027, 6, 30) });
        await db.SaveChangesAsync();

        // 2. The migration applies without error and keeps every one of them as it was.
        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var provider = await after.ProviderSettings.AsNoTracking().SingleAsync();
        Assert.Equal(("Live Provider", "NSW", "062000", "12345678"), (provider.OrganisationName, provider.State, provider.BSB, provider.AccountNumber));
        var participant = await after.Participants.AsNoTracking().SingleAsync();
        Assert.Equal((participantId, D(2026, 7, 1), D(2027, 6, 30)), (participant.Id, participant.PlanStartDate, participant.PlanEndDate));

        // 3. The new tables are there and empty: a plan budget is typed in, never derived from what was there.
        Assert.Equal(0, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPlans\""));
        Assert.Equal(0, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPools\""));
        Assert.Equal(0, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPeriods\""));

        // 4. A settings row that names only its tenant reads back as the defaults (the column defaults), and a tenant has one row.
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await using var insert = new NpgsqlCommand("INSERT INTO \"BudgetSettings\" (\"Id\",\"TenantId\") VALUES (@id,@tenant)", conn);
            insert.Parameters.AddWithValue("id", Guid.NewGuid());
            insert.Parameters.AddWithValue("tenant", tenantId);
            await insert.ExecuteNonQueryAsync();

            await using var duplicate = new NpgsqlCommand("INSERT INTO \"BudgetSettings\" (\"Id\",\"TenantId\") VALUES (@id,@tenant)", conn);
            duplicate.Parameters.AddWithValue("id", Guid.NewGuid());
            duplicate.Parameters.AddWithValue("tenant", tenantId);
            var error = await Assert.ThrowsAsync<PostgresException>(() => duplicate.ExecuteNonQueryAsync());
            Assert.Equal("23505", error.SqlState);
        }

        await using var read = PostgresFixture.NewContext(connectionString);
        var settings = await read.BudgetSettings.AsNoTracking().SingleAsync();
        Assert.Equal((BudgetLimitMode.Warn, 80), (settings.Mode, settings.ApproachingPercent));
    }

    // ── The indexes, the money and the cascade ──────────────────────────────

    [SkippableFact]
    public async Task TheUniqueIndexesHold_OnePlanPerParticipantPerStartDay_OnePoolPerCategoryAndManagement_OnePeriodPerStartDay()
    {
        RequirePostgres();
        var (connectionString, tenantId, participants) = await SetUpAsync(2);
        await using (var db = Open(connectionString, tenantId))
        {
            db.FundingPlans.Add(StoredPlan(tenantId, participants[0], D(2026, 7, 1), D(2027, 6, 30)));
            await db.SaveChangesAsync();
        }

        // The same participant, the same start day.
        await using (var db = Open(connectionString, tenantId))
        {
            db.FundingPlans.Add(StoredPlan(tenantId, participants[0], D(2026, 7, 1), D(2026, 12, 31)));
            Assert.Equal("23505", await SqlStateOfAsync(() => db.SaveChangesAsync()));
        }

        // Another participant may have the same dates.
        await using (var db = Open(connectionString, tenantId))
        {
            db.FundingPlans.Add(StoredPlan(tenantId, participants[1], D(2026, 7, 1), D(2027, 6, 30)));
            await db.SaveChangesAsync();
        }

        // The same category and management type twice in one plan.
        await using (var db = Open(connectionString, tenantId))
        {
            var plan = StoredPlan(tenantId, participants[0], D(2027, 7, 1), D(2028, 6, 30));
            plan.Pools.Add(new FundingPool { Id = Guid.NewGuid(), TenantId = tenantId, FundingPlanId = plan.Id, Position = 1, Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = PlanType.PlanManaged, Name = "Again" });
            db.FundingPlans.Add(plan);
            Assert.Equal("23505", await SqlStateOfAsync(() => db.SaveChangesAsync()));
        }

        // The same category under another management type is a different pool.
        await using (var db = Open(connectionString, tenantId))
        {
            var plan = StoredPlan(tenantId, participants[0], D(2027, 7, 1), D(2028, 6, 30));
            var other = new FundingPool { Id = Guid.NewGuid(), TenantId = tenantId, FundingPlanId = plan.Id, Position = 1, Kind = FundingPoolKind.CoreFlexible, PaceCategory = 0, ManagementType = PlanType.AgencyManaged, Name = "Core (flexible)" };
            other.Periods.Add(new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = other.Id, PeriodStart = D(2027, 7, 1), PeriodEnd = D(2028, 6, 30), PlanAmount = 1m });
            plan.Pools.Add(other);
            db.FundingPlans.Add(plan);
            await db.SaveChangesAsync();
        }

        // The same start day twice in one pool.
        await using (var db = Open(connectionString, tenantId))
        {
            var plan = StoredPlan(tenantId, participants[0], D(2028, 7, 1), D(2029, 6, 30));
            var pool = plan.Pools.Single();
            pool.Periods.Add(new FundingPeriod { Id = Guid.NewGuid(), TenantId = tenantId, FundingPoolId = pool.Id, Position = 1, PeriodStart = D(2028, 7, 1), PeriodEnd = D(2028, 12, 31), PlanAmount = 1m });
            db.FundingPlans.Add(plan);
            Assert.Equal("23505", await SqlStateOfAsync(() => db.SaveChangesAsync()));
        }
    }

    [SkippableFact]
    public async Task TheMoneyColumns_RoundTripToTheCent_ASetAsideOfNothingStaysNothing_AndTheDatabaseWouldRoundASlippedThirdDecimalSilently()
    {
        RequirePostgres();
        var (connectionString, tenantId, participants) = await SetUpAsync();
        var big = StoredPlan(tenantId, participants[0], D(2026, 7, 1), D(2027, 6, 30), amount: 99_999_999.99m, setAside: 0.01m);
        var none = StoredPlan(tenantId, participants[0], D(2027, 7, 1), D(2028, 6, 30), amount: 0m, setAside: null);
        var third = StoredPlan(tenantId, participants[0], D(2028, 7, 1), D(2029, 6, 30), amount: 100.005m);
        await using (var db = Open(connectionString, tenantId))
        {
            db.FundingPlans.AddRange(big, none, third);
            await db.SaveChangesAsync();
        }

        await using var read = Open(connectionString, tenantId);
        var periods = await read.FundingPeriods.AsNoTracking().OrderBy(p => p.PeriodStart).ToListAsync();
        Assert.Equal((99_999_999.99m, (decimal?)0.01m), (periods[0].PlanAmount, periods[0].SetAside));
        Assert.Equal((0m, (decimal?)null), (periods[1].PlanAmount, periods[1].SetAside));
        // numeric(18,2) rounds on the way in: the server therefore refuses a third decimal (FundingPlanValidator) rather than let it change silently.
        Assert.Equal(100.01m, periods[2].PlanAmount);
        Assert.Equal("99999999.99", await TextAsync(connectionString, "SELECT \"PlanAmount\"::text FROM \"FundingPeriods\" WHERE \"PlanAmount\" > 1000000"));
    }

    private static async Task<string> TextAsync(string connectionString, string sql)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var command = new NpgsqlCommand(sql, conn);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    [SkippableFact]
    public async Task DeletingAPlan_CascadesToItsPoolsAndPeriods_ButAParticipantWithAPlanCannotBeDeleted()
    {
        RequirePostgres();
        var (connectionString, tenantId, participants) = await SetUpAsync();
        var plan = StoredPlan(tenantId, participants[0], D(2026, 7, 1), D(2027, 6, 30));
        await using (var db = Open(connectionString, tenantId))
        {
            db.FundingPlans.Add(plan);
            await db.SaveChangesAsync();
        }

        // The participant owns the plan's history: it is not deleted from under it (Restrict).
        Assert.Equal("23503", await SqlStateOfAsync(() => CountAsync(connectionString, "WITH gone AS (DELETE FROM \"Participants\" WHERE \"Id\" = @id RETURNING 1) SELECT COUNT(*) FROM gone", ("id", participants[0]))));

        // Removing the plan removes what hangs off it: straight SQL, so it is the foreign keys' cascade and not EF's.
        await using (var conn = new NpgsqlConnection(connectionString))
        {
            await conn.OpenAsync();
            await using var delete = new NpgsqlCommand("DELETE FROM \"FundingPlans\" WHERE \"Id\" = @id", conn);
            delete.Parameters.AddWithValue("id", plan.Id);
            Assert.Equal(1, await delete.ExecuteNonQueryAsync());
        }

        Assert.Equal(0, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPools\""));
        Assert.Equal(0, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPeriods\""));
    }

    // ── The service on Npgsql ───────────────────────────────────────────────

    [SkippableFact]
    public async Task TheService_RunsOnNpgsql_CreatesListsReplacesAndDeletes_AndTheOverlapQueriesTranslate()
    {
        RequirePostgres();
        var (connectionString, tenantId, participants) = await SetUpAsync();
        var participantId = participants[0];
        await using var db = Open(connectionString, tenantId);
        var service = new FundingPlanService(db, TimeProvider.System);
        var first = (await service.CreateAsync(tenantId, participantId, Plan(), "user-1", default)).Plan!;
        var second = (await service.CreateAsync(tenantId, participantId, NextYearsPlan(), "user-1", default)).Plan!;

        var list = (await service.ListAsync(tenantId, participantId, default))!;
        Assert.Equal(new[] { second.Id, first.Id }, list.Plans.Select(p => p.Id));
        Assert.Equal(new[] { 0, 15 }, list.Plans[1].Pools.Select(p => p.PaceCategory));
        Assert.Equal(8_000m, list.Plans[1].Pools[0].PlanTotal);

        var overlap = await service.CreateAsync(tenantId, participantId, WholePlan(D(2027, 6, 1), D(2028, 5, 31)), "user-1", default);
        Assert.Equal(first.Id, overlap.Overlap!.ConflictingPlanId);   // the plan that starts earliest is the one named

        var replaced = await service.UpdateAsync(tenantId, participantId, first.Id, Plan() with { Revision = 1, Notes = "edited" }, "user-2", default);
        Assert.Equal((2, "edited"), (replaced.Plan!.Revision, replaced.Plan.Notes));

        Assert.True(await service.DeleteAsync(tenantId, participantId, first.Id, default));
        Assert.Equal(1, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPlans\""));
        Assert.Equal(4, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPeriods\""));
    }

    // ── Two requests at once ────────────────────────────────────────────────

    [SkippableFact]
    public async Task TwoConcurrentCreates_ForOverlappingPlansOfDifferentStartDays_LeaveExactlyOne_TheOtherIsRefusedAsAnOverlap()
    {
        RequirePostgres();
        const int rounds = 8;
        var (connectionString, tenantId, participants) = await SetUpAsync(rounds);

        foreach (var participantId in participants)
        {
            // Different start days, so the unique index cannot tell them apart: only the lock under the check keeps them from both being saved.
            await using var a = Open(connectionString, tenantId);
            await using var b = Open(connectionString, tenantId);
            var start = new TaskCompletionSource();
            var first = Task.Run(async () => { await start.Task; return await new FundingPlanService(a, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2026, 7, 1), D(2027, 6, 30)), "a", default); });
            var second = Task.Run(async () => { await start.Task; return await new FundingPlanService(b, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2027, 6, 1), D(2028, 5, 31)), "b", default); });
            start.SetResult();
            var results = await Task.WhenAll(first, second);

            Assert.Equal(1, results.Count(r => r.Plan is not null));
            var refused = Assert.Single(results, r => r.Plan is null);
            Assert.NotNull(refused.Overlap);
            Assert.Equal(1, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPlans\" WHERE \"ParticipantId\" = @id", ("id", participantId)));
        }
    }

    [SkippableFact]
    public async Task TwoConcurrentCreates_ForPlansStartingTheSameDay_LeaveExactlyOne_NeitherIsA500()
    {
        RequirePostgres();
        const int rounds = 8;
        var (connectionString, tenantId, participants) = await SetUpAsync(rounds);

        foreach (var participantId in participants)
        {
            await using var a = Open(connectionString, tenantId);
            await using var b = Open(connectionString, tenantId);
            var start = new TaskCompletionSource();
            var first = Task.Run(async () => { await start.Task; return await new FundingPlanService(a, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2026, 7, 1), D(2027, 6, 30)), "a", default); });
            var second = Task.Run(async () => { await start.Task; return await new FundingPlanService(b, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2026, 7, 1), D(2026, 12, 31), 5m), "b", default); });
            start.SetResult();
            var results = await Task.WhenAll(first, second);

            Assert.Equal(1, results.Count(r => r.Plan is not null));
            Assert.NotNull(Assert.Single(results, r => r.Plan is null).Overlap);
        }
    }

    [SkippableFact]
    public async Task TwoConcurrentReplaces_MadeFromTheSameRevision_ApplyOne_AndTheOtherIsStale()
    {
        RequirePostgres();
        const int rounds = 6;
        var (connectionString, tenantId, participants) = await SetUpAsync(rounds);

        foreach (var participantId in participants)
        {
            Guid planId;
            await using (var setup = Open(connectionString, tenantId))
                planId = (await new FundingPlanService(setup, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2026, 7, 1), D(2027, 6, 30)), "setup", default)).Plan!.Id;

            await using var a = Open(connectionString, tenantId);
            await using var b = Open(connectionString, tenantId);
            var start = new TaskCompletionSource();
            var first = Task.Run(async () => { await start.Task; return await new FundingPlanService(a, TimeProvider.System).UpdateAsync(tenantId, participantId, planId, WholePlan(D(2026, 7, 1), D(2027, 6, 30), 1m) with { Revision = 1, Notes = "from a" }, "a", default); });
            var second = Task.Run(async () => { await start.Task; return await new FundingPlanService(b, TimeProvider.System).UpdateAsync(tenantId, participantId, planId, WholePlan(D(2026, 7, 1), D(2027, 6, 30), 2m) with { Revision = 1, Notes = "from b" }, "b", default); });
            start.SetResult();
            var results = await Task.WhenAll(first, second);

            Assert.Equal(1, results.Count(r => r.Plan is not null));
            Assert.Equal(2, Assert.Single(results, r => r.Plan is null).CurrentRevision);
            Assert.Equal(2L, await CountAsync(connectionString, "SELECT \"Revision\" FROM \"FundingPlans\" WHERE \"Id\" = @id", ("id", planId)));
        }
    }

    // ── Every writer waits for the participant's row ────────────────────────
    //
    // The two-task races above are only probabilistic proof of the lock. These hold FOR NO KEY UPDATE on the participant's row from a connection of the test's own (what an in-flight
    // create or replace holds) and check, deterministically, that each writer WAITS for it and then completes: so a writer that forgot to take the lock goes straight through and fails here.

    private static async Task<NpgsqlTransaction> HoldTheParticipantAsync(NpgsqlConnection connection, Guid participantId)
    {
        var transaction = await connection.BeginTransactionAsync();
        await using var command = new NpgsqlCommand("SELECT \"Id\" FROM \"Participants\" WHERE \"Id\" = @id FOR NO KEY UPDATE", connection, transaction);
        command.Parameters.AddWithValue("id", participantId);
        await command.ExecuteScalarAsync();
        return transaction;
    }

    /// <summary>The writer must still be waiting after a while; once the held row is released it completes, and its result is returned.</summary>
    private static async Task<T> WaitsForTheHeldRowAsync<T>(Task<T> writer, NpgsqlTransaction held, string what)
    {
        await Task.Delay(1500);
        Assert.False(writer.IsCompleted, $"{what} went ahead while another request held the participant's row: it does not take the lock.");
        await held.CommitAsync();
        await held.DisposeAsync();
        return await writer.WaitAsync(TimeSpan.FromSeconds(30));
    }

    [SkippableFact]
    public async Task EveryWriter_CreateReplaceDeleteAndApplyDates_WaitsForTheParticipantsRow_ThenCompletes()
    {
        RequirePostgres();
        var (connectionString, tenantId, participants) = await SetUpAsync();
        var participantId = participants[0];
        Guid planId;
        await using (var setup = Open(connectionString, tenantId))
        {
            planId = (await new FundingPlanService(setup, TimeProvider.System).CreateAsync(tenantId, participantId, WholePlan(D(2026, 7, 1), D(2027, 6, 30)), "setup", default)).Plan!.Id;
            // The profile already says what the plan says, so apply-dates has nothing to write: only the lock can make it wait.
            var participant = await setup.Participants.SingleAsync(p => p.Id == participantId);
            participant.PlanStartDate = D(2026, 7, 1);
            participant.PlanEndDate = D(2027, 6, 30);
            await setup.SaveChangesAsync();
        }

        await using var holder = new NpgsqlConnection(connectionString);
        await holder.OpenAsync();

        // The row is held BEFORE the writer starts (an argument list would start it first), so a writer that does not take the lock cannot slip in ahead of the hold.
        var heldForCreate = await HoldTheParticipantAsync(holder, participantId);
        await using var forCreate = Open(connectionString, tenantId);
        var created = await WaitsForTheHeldRowAsync(
            Task.Run(() => new FundingPlanService(forCreate, TimeProvider.System).CreateAsync(tenantId, participantId, NextYearsPlan(), "a", default)), heldForCreate, "A create");
        Assert.NotNull(created.Plan);

        var heldForReplace = await HoldTheParticipantAsync(holder, participantId);
        await using var forReplace = Open(connectionString, tenantId);
        var replaced = await WaitsForTheHeldRowAsync(
            Task.Run(() => new FundingPlanService(forReplace, TimeProvider.System).UpdateAsync(tenantId, participantId, planId, WholePlan(D(2026, 7, 1), D(2027, 6, 30), 5m) with { Revision = 1, Notes = "edited" }, "b", default)),
            heldForReplace, "A replace");
        Assert.Equal(2, replaced.Plan!.Revision);

        var heldForApply = await HoldTheParticipantAsync(holder, participantId);
        await using var forApply = Open(connectionString, tenantId);
        var applied = await WaitsForTheHeldRowAsync(
            Task.Run(() => new FundingPlanService(forApply, TimeProvider.System).ApplyDatesToProfileAsync(tenantId, participantId, planId, default)), heldForApply, "Apply-dates");
        Assert.False(applied!.Changed);

        var heldForDelete = await HoldTheParticipantAsync(holder, participantId);
        await using var forDelete = Open(connectionString, tenantId);
        var deleted = await WaitsForTheHeldRowAsync(
            Task.Run(() => new FundingPlanService(forDelete, TimeProvider.System).DeleteAsync(tenantId, participantId, created.Plan!.Id, default)), heldForDelete, "A delete");
        Assert.True(deleted);
        Assert.Equal(1, await CountAsync(connectionString, "SELECT COUNT(*) FROM \"FundingPlans\" WHERE \"ParticipantId\" = @id", ("id", participantId)));
    }
}
