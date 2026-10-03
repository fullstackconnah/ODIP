using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Plan builder phase D against a real PostgreSQL (see <see cref="PostgresFixture"/>: skipped, never failed, when POSTGRES_CONNECTION_STRING is unset, so these run in CI and not on a machine without
/// a server). What EF InMemory cannot show: the migration over live rows, the partial unique index and the restricting keys, the <c>jsonb</c> of the requirements, two approvals at once, and shifts
/// that are never made twice when generation runs at once. Every test has a scratch database of its own, never a demo fixture.
/// </summary>
public class PlanApprovalPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddServiceAgreementApprovalAndPatternSource";

    private readonly PostgresFixture _pg;
    public PlanApprovalPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static OdipDbContext Open(string connectionString, Guid tenantId) => PostgresFixture.NewContext(connectionString, TenantOf(tenantId));

    /// <summary>A migrated scratch database with one organisation (a Sydney provider) and one participant of it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync(bool active = true)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = active, IsDraft = !active }).Entity;
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participant.Id);
        }
    }

    private static async Task<ServiceAgreementDraft> StoreAsync(string connectionString, Guid tenantId, Guid participantId, int version, DateOnly? start = null, DateOnly? end = null)
    {
        await using var db = Open(connectionString, tenantId);
        var draft = BuildRevision(tenantId, participantId, version, new[] { WeekdayBlock() }, start, end, requirements: new Application.DTOs.DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } });
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return draft;
    }

    private static async Task<ApprovalOutcome> ApproveAsync(string connectionString, Guid tenantId, Guid participantId, Guid draftId, FakeClock clock, ApprovalCaller? caller = null)
    {
        await using var db = Open(connectionString, tenantId);
        return await new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: clock).ApproveAsync(tenantId, participantId, draftId, false, caller ?? Admin, CancellationToken.None);
    }

    private static async Task ExecuteAsync(string connectionString, string sql)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<string> SqlStateAsync(string connectionString, string sql)
    {
        var failure = await Assert.ThrowsAsync<PostgresException>(() => ExecuteAsync(connectionString, sql));
        return failure.SqlState;
    }

    // ── The migration ─────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task TheMigration_AppliesOverLivePatternsAndShifts_KeepsThemAsTheyWere_AndTheIndexTheNullsAndTheRestrictingKeysHold()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));

        // 1. The schema as it was before this migration, holding a participant with a hand-made pattern and a shift generated from it (raw SQL: the model has the new columns, the table does not yet).
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);
        var tenantId = Guid.NewGuid();
        var (participantId, draftId, patternId, shiftId) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.Participants.Add(new Participant { Id = participantId, TenantId = tenantId, FirstName = "Live", LastName = "Participant", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true });
        db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
        {
            Id = draftId, TenantId = tenantId, ParticipantId = participantId, Version = 1, State = "NSW", ParticipantNameSnapshot = "Live Participant",
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2026, 12, 31),
        });
        await db.SaveChangesAsync();
        await ExecuteAsync(connectionString,
            $"INSERT INTO \"ShiftPatterns\" (\"Id\",\"TenantId\",\"ParticipantId\",\"DayOfWeek\",\"StartTime\",\"EndTime\",\"EndsNextDay\",\"Ratio\",\"NightType\",\"EffectiveFrom\",\"IsActive\",\"Notes\") " +
            $"VALUES ('{patternId}','{tenantId}','{participantId}',1,'09:00','13:00',false,0,0,'2026-10-01',true,'Hand-made')");
        await ExecuteAsync(connectionString,
            $"INSERT INTO \"Shifts\" (\"Id\",\"TenantId\",\"ParticipantId\",\"ShiftPatternId\",\"ServiceDate\",\"StartTime\",\"EndTime\",\"EndsNextDay\",\"Ratio\",\"NightType\",\"Status\",\"ReturnCount\",\"CreatedAt\",\"UpdatedAt\") " +
            $"VALUES ('{shiftId}','{tenantId}','{participantId}','{patternId}','2026-10-12','09:00','13:00',false,0,0,0,0,now(),now())");

        // 2. The migration applies without error and keeps both as they were, with the new columns null.
        await migrator.MigrateAsync();
        await using (var after = PostgresFixture.NewContext(connectionString))
        {
            var pattern = await after.ShiftPatterns.AsNoTracking().SingleAsync();
            Assert.Equal((patternId, DayOfWeek.Monday, new TimeOnly(9, 0), new TimeOnly(13, 0), true, "Hand-made"), (pattern.Id, pattern.DayOfWeek, pattern.StartTime, pattern.EndTime, pattern.IsActive, pattern.Notes));
            Assert.Equal((null, null, null, null), (pattern.SourceDraftId, pattern.SourceBlockKey, pattern.WorkerSlot, pattern.RequirementsJson));
            var shift = await after.Shifts.AsNoTracking().SingleAsync();
            Assert.Equal((shiftId, patternId, new DateOnly(2026, 10, 12)), (shift.Id, shift.ShiftPatternId, shift.ServiceDate));
            Assert.Null(shift.RequirementsJson);
            Assert.Empty(await after.ServiceAgreementDraftApprovals.ToListAsync());
        }

        // 3. The partial unique key: one pattern for a block's weekday and worker slot of a revision; a different slot, day or block is another; a pattern with no source is outside the key.
        string Agreement(Guid id, Guid source, string block, int day, int slot, string requirements = "{}") =>
            $"INSERT INTO \"ShiftPatterns\" (\"Id\",\"TenantId\",\"ParticipantId\",\"DayOfWeek\",\"StartTime\",\"EndTime\",\"EndsNextDay\",\"Ratio\",\"NightType\",\"EffectiveFrom\",\"IsActive\",\"SourceDraftId\",\"SourceBlockKey\",\"WorkerSlot\",\"RequirementsJson\") " +
            $"VALUES ('{id}','{tenantId}','{participantId}',{day},'09:00','13:00',false,0,0,'2026-10-01',true,'{source}','{block}',{slot},'{requirements}')";
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b1", 1, 1));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await SqlStateAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b1", 1, 1)));
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b1", 1, 2));      // the second worker of a 2:1
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b1", 2, 1));      // another weekday
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b2", 1, 1));      // another block
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b2", 1, 1).Replace($"'{draftId}','b2'", "NULL,'b2'"));      // no source: never held to the key ...
        await ExecuteAsync(connectionString, Agreement(Guid.NewGuid(), draftId, "b2", 1, 1).Replace($"'{draftId}','b2'", "NULL,'b2'"));      // ... so the same again is allowed, as hand-made patterns always were
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await SqlStateAsync(connectionString, Agreement(Guid.NewGuid(), Guid.NewGuid(), "b9", 1, 1)));       // a source that is not a revision

        // 4. The approval is one row for each revision, and a revision with patterns or an approval cannot be deleted from under them.
        string Approval(Guid draft) =>
            $"INSERT INTO \"ServiceAgreementDraftApprovals\" (\"Id\",\"TenantId\",\"DraftId\",\"ParticipantId\",\"DraftVersion\",\"ApprovedAt\",\"ApprovedByName\",\"PatternsCreated\",\"PatternsEnded\",\"ShiftsCreated\") " +
            $"VALUES ('{Guid.NewGuid()}','{tenantId}','{draft}','{participantId}',1,now(),'Alex Admin',4,0,0)";
        await ExecuteAsync(connectionString, Approval(draftId));
        Assert.Equal(PostgresErrorCodes.UniqueViolation, await SqlStateAsync(connectionString, Approval(draftId)));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await SqlStateAsync(connectionString, Approval(Guid.NewGuid())));
        Assert.Equal(PostgresErrorCodes.ForeignKeyViolation, await SqlStateAsync(connectionString, $"DELETE FROM \"ServiceAgreementDrafts\" WHERE \"Id\" = '{draftId}'"));
    }

    [SkippableFact]
    public async Task TheRequirementsOfAPatternAndAShift_AreJsonbAndReadBackAsWhatTheyMean()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        // jsonb keeps its own key order and spacing, so the text that comes back is not the text that was written: it is read as what it means.
        await using (var write = Open(cs, tenantId))
        {
            write.ShiftPatterns.Add(new ShiftPattern
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true,
                SourceDraftId = draft.Id, SourceBlockKey = "weekdays", WorkerSlot = 1, RequirementsJson = """{"skills":["FirstAid","ManualHandling"],"driver":true,"workerGender":"Female"}""",
            });
            await write.SaveChangesAsync();
            var pattern = await write.ShiftPatterns.AsNoTracking().SingleAsync();
            await new RosterShiftGenerator().GenerateAsync(write, participantId, new[] { pattern.Id }, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 19), CancellationToken.None);
        }

        await using var read = Open(cs, tenantId);
        var shifts = await read.Shifts.AsNoTracking().OrderBy(s => s.ServiceDate).ToListAsync();
        Assert.Equal(2, shifts.Count);
        Assert.All(shifts, s =>
        {
            var requirements = DraftJson.ReadRequirements(s.RequirementsJson!);
            Assert.Equal(("Female", true), (requirements.WorkerGender, requirements.Driver));
            Assert.Equal(new[] { "FirstAid", "ManualHandling" }, requirements.Skills);
        });
        Assert.Equal(1, await read.ShiftPatterns.CountAsync(p => p.RequirementsJson != null && p.WorkerSlot == 1));
    }

    // ── Approval ──────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task ApprovingOnPostgres_MakesThePatternsTheShiftsAndTheApproval_AndTheStoredPricingAndBlocksReadBack()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);

        var outcome = await ApproveAsync(cs, tenantId, participantId, draft.Id, clock);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        await using var read = Open(cs, tenantId);
        var approval = await read.ServiceAgreementDraftApprovals.AsNoTracking().SingleAsync();
        Assert.Equal((draft.Id, 1, "Alex Admin", 5, 0, 40), (approval.DraftId, approval.DraftVersion, approval.ApprovedByName, approval.PatternsCreated, approval.PatternsEnded, approval.ShiftsCreated));
        Assert.Equal(new DateTime(2026, 10, 10, 2, 0, 0), approval.ApprovedAt);
        Assert.Equal(5, await read.ShiftPatterns.CountAsync(p => p.SourceDraftId == draft.Id));
        Assert.Equal(40, await read.Shifts.CountAsync());
        var again = await ApproveAsync(cs, tenantId, participantId, draft.Id, clock, Coordinator);
        Assert.Equal((ApprovalStatus.AlreadyApproved, "Alex Admin"), (again.Status, again.Approval!.ApprovedByName));
    }

    [SkippableFact]
    public async Task TwoApprovalsAtOnce_MakeOneApprovalAndOneSetOfPatterns_AndTheSecondIsAnsweredWithTheFirsts()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);

        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(i => ApproveAsync(cs, tenantId, participantId, draft.Id, clock, i % 2 == 0 ? Admin : Coordinator)));

        Assert.Equal(1, results.Count(r => r.Status == ApprovalStatus.Approved));
        Assert.Equal(3, results.Count(r => r.Status == ApprovalStatus.AlreadyApproved));
        Assert.Single(results.Select(r => r.Approval!.Id).Distinct());                          // every caller is told about the same approval
        await using var read = Open(cs, tenantId);
        Assert.Equal(1, await read.ServiceAgreementDraftApprovals.CountAsync());
        Assert.Equal(5, await read.ShiftPatterns.CountAsync());
        Assert.Equal(40, await read.Shifts.CountAsync());
    }

    [SkippableFact]
    public async Task ApprovingTheNextRevision_EndsTheOldPatterns_LeavesTheirShifts_AndTheTopUpThenWorksOnlyForTheLivePatterns()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 12, 20));

        var outcome = await ApproveAsync(cs, tenantId, participantId, v2.Id, clock);

        Assert.Equal((ApprovalStatus.Approved, 5, 5), (outcome.Status, outcome.Approval!.PatternsCreated, outcome.Approval.PatternsEnded));
        Assert.Equal((0, 25), (outcome.OldShifts!.Assigned, outcome.OldShifts.Open));              // v1's open shifts from Monday 2 November to Friday 4 December: 25, and all of them stay
        await using (var read = Open(cs, tenantId))
        {
            Assert.All(await read.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal((new DateOnly(2026, 11, 1), true), (p.EffectiveTo!.Value, p.IsActive)));
            Assert.Equal(40, await read.Shifts.CountAsync(s => read.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == v1.Id)));
        }

        // A week later the horizon has moved. v1's patterns still run to 1 November (they are read) but already have every shift they will; v2's are topped up with the five weekdays of 7 to 11 December.
        var later = FakeClock.AtUtc(2026, 10, 17, 2, 0);
        var services = new ServiceCollection();
        services.AddDbContext<OdipDbContext>(o => o.UseNpgsql(cs));
        services.AddSingleton<IRosterPlacementGate>(new RosterPlacementGate());
        services.AddSingleton<RosterShiftGenerator>();
        await using var provider = services.BuildServiceProvider();
        var job = new RosterTopUpBackgroundService(provider.GetRequiredService<IServiceScopeFactory>(), new ConfigurationBuilder().Build(), NullLogger<RosterTopUpBackgroundService>.Instance, later);

        var run = await job.RunOnceAsync(CancellationToken.None);

        Assert.Equal((1, 10, 5, 0), (run.Tenants, run.Patterns, run.ShiftsCreated, run.Failures));
        await using var after = Open(cs, tenantId);
        Assert.Equal(40, await after.Shifts.CountAsync(s => after.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == v1.Id)));      // v1's shifts: no more
        Assert.Equal(new DateOnly(2026, 12, 11), await after.Shifts.MaxAsync(s => s.ServiceDate));
    }

    // ── Generation at once ────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task GenerationRunningAtOnce_ForOneParticipant_NeverMakesAShiftTwice()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        Guid patternId;
        await using (var seed = Open(cs, tenantId))
        {
            var pattern = new ShiftPattern { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true };
            seed.ShiftPatterns.Add(pattern);
            await seed.SaveChangesAsync();
            patternId = pattern.Id;
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var db = Open(cs, tenantId);
            return await new RosterShiftGenerator().GenerateAsync(db, participantId, new[] { patternId }, new DateOnly(2026, 10, 12), new DateOnly(2026, 12, 6), CancellationToken.None);
        }));

        // Mondays 12 October to 30 November: eight. Whoever got there first made them; nobody made one that was there.
        Assert.Equal(8, results.Sum(r => r.Created));
        await using var read = Open(cs, tenantId);
        var shifts = await read.Shifts.AsNoTracking().ToListAsync();
        Assert.Equal(8, shifts.Count);
        Assert.Equal(8, shifts.Select(s => (s.ShiftPatternId, s.ServiceDate)).Distinct().Count());
    }
}
