using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Odip.Tests.Support;
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

    /// <summary>A migrated scratch database with one organisation (a Sydney provider) and one participant of it; by default the fixture's nine roster weeks are started (StartedWeekRows).</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync(bool active = true, bool weeksStarted = true)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = active, IsDraft = !active }).Entity;
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            if (weeksStarted) setup.RosterWeeks.AddRange(StartedWeekRows(tenantId));
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participant.Id);
        }
    }

    private static async Task<ServiceAgreementDraft> StoreAsync(string connectionString, Guid tenantId, Guid participantId, int version, DateOnly? start = null, DateOnly? end = null, IReadOnlyList<PlanBlock>? blocks = null, IEnumerable<HolidayEntry>? holidays = null)
    {
        await using var db = Open(connectionString, tenantId);
        var draft = BuildRevision(tenantId, participantId, version, blocks ?? new[] { WeekdayBlock() }, start, end, requirements: new Application.DTOs.DraftBlockRequirementsDto { WorkerGender = "Female", Driver = true, Skills = new List<string> { "FirstAid" } }, holidays: holidays);
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return draft;
    }

    private static async Task<ApprovalOutcome> ApproveAsync(string connectionString, Guid tenantId, Guid participantId, Guid draftId, FakeClock clock, ApprovalCaller? caller = null, TimeSpan? lockWait = null)
    {
        await using var db = Open(connectionString, tenantId);
        return await new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(lockWait), clock: clock).ApproveAsync(tenantId, participantId, draftId, false, caller ?? Admin, CancellationToken.None);
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
        await OlderSchemaSeeds.SaveWithLaterColumnsAsync(db);
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
        Assert.All(await read.ShiftPatterns.AsNoTracking().ToListAsync(), p => Assert.Equal(new DateOnly(2026, 12, 6), p.GeneratedThrough));      // how far shifts were made, in a real date column
        Assert.Equal(40, await read.Shifts.CountAsync());
        var again = await ApproveAsync(cs, tenantId, participantId, draft.Id, clock, Coordinator);
        Assert.Equal((ApprovalStatus.AlreadyApproved, "Alex Admin"), (again.Status, again.Approval!.ApprovedByName));
    }

    [SkippableFact]
    public async Task AFirstApproval_WaitsForAStartInFlight_AndFillsTheWeekItStarted()   // R6: approval takes the organisation's board lock before the participant's
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync(weeksStarted: false);
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);

        await using var holder = Open(cs, tenantId);
        await using var held = await RosterGenerationLock.AcquireAsync(holder, tenantId, default, scope: "roster-board");   // a Start, still running
        var approving = ApproveAsync(cs, tenantId, participantId, draft.Id, clock, lockWait: TimeSpan.FromSeconds(10));
        await Task.Delay(500);
        Assert.False(approving.IsCompleted);                                                                            // waiting on the board lock
        holder.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = new DateOnly(2026, 10, 19) });
        await holder.SaveChangesAsync();
        await held.CommitAsync(default);

        var outcome = await approving;

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        await using var read = Open(cs, tenantId);
        Assert.Equal(Enumerable.Range(0, 5).Select(i => new DateOnly(2026, 10, 19).AddDays(i)), await read.Shifts.Select(s => s.ServiceDate).OrderBy(d => d).ToListAsync());
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

    /// <summary>On the first save that holds an approval to write, lets another request finish first (the save that replaces the revision), then lets this save run against what that request left.</summary>
    private sealed class OtherRequestFinishesFirst(Func<Task> otherRequest) : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData, Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (_fired || !eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any(entry => entry.State == EntityState.Added)) return result;
            _fired = true;
            await otherRequest();
            return result;
        }
    }

    // A save deletes the participant's earlier unapproved revision. An approval that has passed its checks and is writing the patterns and the approval row meets the restricting keys of the
    // revision that has just gone: PostgreSQL refuses (23503), the transaction is rolled back, and the answer is "superseded" with the newest version, not a server error.
    [SkippableFact]
    public async Task AnApprovalWhoseRevisionASaveReplacesMeanwhile_IsSupersededNotAServerError_AndWritesNothing()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var interceptor = new OtherRequestFinishesFirst(async () =>
        {
            await using var other = Open(cs, tenantId);
            var saved = await new ServiceAgreementDraftService(other).SaveAsync(tenantId, participantId, new CreateServiceAgreementDraftDto
            {
                PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = Start, AgreementEndDate = new DateOnly(2026, 12, 20), State = "NSW",
                BaseVersion = 1,
                Blocks = new List<DraftBlockDto> { new() { Block = WeekdayBlock() } },
            }, "another coordinator", CancellationToken.None);
            Assert.Equal(2, Assert.IsType<ServiceAgreementDraft>(saved.Draft).Version);          // version 1 was nobody's, so this save replaces it
        });
        await using var racing = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(interceptor).Options, TenantOf(tenantId));

        var outcome = await new ServiceAgreementApprovalService(racing, new RosterPlacementGate(), new RosterShiftGenerator(), clock: clock).ApproveAsync(tenantId, participantId, v1.Id, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Superseded, outcome.Status);
        Assert.Equal(2, outcome.NewestVersion);
        await using var read = Open(cs, tenantId);
        Assert.Empty(await read.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Empty(await read.ShiftPatterns.ToListAsync());
        Assert.Empty(await read.Shifts.ToListAsync());
        Assert.Equal(new[] { 2 }, await read.ServiceAgreementDrafts.AsNoTracking().Select(d => d.Version).ToListAsync());
    }

    [SkippableFact]
    public async Task ApprovingTheNextRevision_EndsTheOldPatterns_RemovesTheirUnfilledShiftsFromItsStart()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 12, 20), blocks: new[] { WeekdayBlock(change: b => b with { End = T(14) }) });

        var outcome = await ApproveAsync(cs, tenantId, participantId, v2.Id, clock);

        Assert.Equal((ApprovalStatus.Approved, 5, 5), (outcome.Status, outcome.Approval!.PatternsCreated, outcome.Approval.PatternsEnded));
        Assert.Equal((0, 0, 25), (outcome.OldShifts!.Assigned, outcome.OldShifts.Open, outcome.OldShifts.Removed));    // v1's unfilled shifts from Monday 2 November to Friday 4 December: 25, all removed
        await using (var read = Open(cs, tenantId))
        {
            Assert.All(await read.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal((new DateOnly(2026, 11, 1), true), (p.EffectiveTo!.Value, p.IsActive)));
            Assert.Equal(15, await read.Shifts.CountAsync(s => read.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == v1.Id)));
        }

    }

    [SkippableFact]
    public async Task ApprovingASuccessor_RemovesTheUnfilledDrafts_ButKeepsOneWithANote_AndCommits()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        Guid noted;
        await using (var db = Open(cs, tenantId))
        {
            var author = db.Users.Add(new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = $"ben{Guid.NewGuid():N}", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true }).Entity;
            var shift = await db.Shifts.SingleAsync(s => s.ServiceDate == new DateOnly(2026, 11, 4));        // Wednesday 4 November: an unfilled Draft of v1
            noted = shift.Id;
            // A note restricts the delete of its shift: removing this one would roll the whole approval back with a foreign-key violation.
            db.ShiftNotes.Add(new ShiftNote { Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shift.Id, AuthorUserId = author.Id, AuthorName = "Ben Turner", Body = "Asked to come at ten." });
            await db.SaveChangesAsync();
        }
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), blocks: new[] { WeekdayBlock(change: b => b with { End = T(14) }) });

        var outcome = await ApproveAsync(cs, tenantId, participantId, v2.Id, clock);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal((24, 1, 0), (outcome.OldShifts!.Removed, outcome.OldShifts.Open, outcome.OldShifts.Assigned));
        Assert.Equal(noted, Assert.Single(outcome.OldShifts.Shifts).Id);
        await using var read = Open(cs, tenantId);
        Assert.True(await read.Shifts.AnyAsync(s => s.Id == noted));
        Assert.Equal(15 + 1, await read.Shifts.CountAsync(s => read.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == v1.Id)));
    }

    [SkippableFact]
    public async Task AnAssignmentNotYetCommittedWhenTheApprovalReachesTheShift_IsWaitedFor_AndTheShiftIsKeptNotRemoved()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), blocks: new[] { WeekdayBlock(change: b => b with { End = T(14) }) });
        var staff = Guid.NewGuid();
        Guid target;
        await using (var db = Open(cs, tenantId))
        {
            db.Users.Add(new User { Id = staff, TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = $"ben{Guid.NewGuid():N}", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
            await db.SaveChangesAsync();
            target = await db.Shifts.Where(s => s.ServiceDate == new DateOnly(2026, 11, 4)).Select(s => s.Id).SingleAsync();     // Wednesday 4 November: an unfilled Draft of v1
        }

        // Another request assigns a worker to that shift and has not committed when the approval reaches it.
        await using var other = new NpgsqlConnection(cs);
        await other.OpenAsync();
        await using var assigning = await other.BeginTransactionAsync();
        await using (var assign = new NpgsqlCommand(@"UPDATE ""Shifts"" SET ""UserId"" = @staff WHERE ""Id"" = @id", other, assigning))
        {
            assign.Parameters.AddWithValue("staff", staff);
            assign.Parameters.AddWithValue("id", target);
            await assign.ExecuteNonQueryAsync();
        }
        var approving = ApproveAsync(cs, tenantId, participantId, v2.Id, clock);
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.False(approving.IsCompleted);                                                     // it waits on that shift's row
        await assigning.CommitAsync();

        var outcome = await approving;

        // Without the row lock the approval read the shift as unfilled, its DELETE waited for the assignment and then removed the assigned shift.
        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal((1, 24), (outcome.OldShifts!.Assigned, outcome.OldShifts.Removed));
        await using var read = Open(cs, tenantId);
        Assert.Equal(staff, (await read.Shifts.AsNoTracking().SingleAsync(s => s.Id == target)).UserId);
    }
    [SkippableFact]
    public async Task AnAssignmentCommittedDuringTheApproval_OnADayTheNewPlanSkipsForAHoliday_IsKeptNotRemoved()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var holiday = new[] { new HolidayEntry(new DateOnly(2026, 11, 9), "NSW", "Test holiday", null, null, "test") };          // Monday 9 November
        var v1 = await StoreAsync(cs, tenantId, participantId, 1, blocks: new[] { WeekdayBlock(change: b => b with { OnPublicHoliday = HolidayDecision.Charge }) }, holidays: holiday);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        // The same support, but the 9th is skipped: that day's shift is not carried, so it is one approval may remove.
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), blocks: new[] { WeekdayBlock(change: b => b with { OnPublicHoliday = HolidayDecision.Skip }) }, holidays: holiday);
        var staff = Guid.NewGuid();
        Guid target;
        await using (var db = Open(cs, tenantId))
        {
            db.Users.Add(new User { Id = staff, TenantId = tenantId, FirstName = "Ben", LastName = "Turner", Username = $"ben{Guid.NewGuid():N}", Email = "ben@example.com", Role = UserRole.SupportWorker, IsActive = true });
            await db.SaveChangesAsync();
            target = await db.Shifts.Where(s => s.ServiceDate == new DateOnly(2026, 11, 9)).Select(s => s.Id).SingleAsync();
        }

        // Another request assigns a worker to that shift and has not committed when the approval starts reading the roster.
        await using var other = new NpgsqlConnection(cs);
        await other.OpenAsync();
        await using var assigning = await other.BeginTransactionAsync();
        await using (var assign = new NpgsqlCommand(@"UPDATE ""Shifts"" SET ""UserId"" = @staff WHERE ""Id"" = @id", other, assigning))
        {
            assign.Parameters.AddWithValue("staff", staff);
            assign.Parameters.AddWithValue("id", target);
            await assign.ExecuteNonQueryAsync();
        }
        var approving = ApproveAsync(cs, tenantId, participantId, v2.Id, clock);
        await Task.Delay(TimeSpan.FromSeconds(2));
        Assert.False(approving.IsCompleted);                                                     // it waits on the shift rows before it reads any of them
        await assigning.CommitAsync();

        var outcome = await approving;

        // Without the lock before the carry-over read, the shift was read unfilled, tracked, and deleted after the assignment committed.
        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal((1, 0), (outcome.OldShifts!.Assigned, outcome.OldShifts.Removed));
        await using var read = Open(cs, tenantId);
        Assert.Equal(staff, (await read.Shifts.AsNoTracking().SingleAsync(s => s.Id == target)).UserId);
    }

    [SkippableFact]
    public async Task AShiftRowHeldLongerThanTheApprovalWaits_IsTheBusyAnswer_AndNothingIsWritten()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), blocks: new[] { WeekdayBlock(change: b => b with { End = T(14) }) });
        Guid target;
        await using (var db = Open(cs, tenantId)) target = await db.Shifts.Where(s => s.ServiceDate == new DateOnly(2026, 11, 4)).Select(s => s.Id).SingleAsync();

        // Another request holds one of the old shifts' rows and does not let go.
        await using var other = new NpgsqlConnection(cs);
        await other.OpenAsync();
        await using var holding = await other.BeginTransactionAsync();
        await using (var hold = new NpgsqlCommand(@"SELECT 1 FROM ""Shifts"" WHERE ""Id"" = @id FOR UPDATE", other, holding))
        {
            hold.Parameters.AddWithValue("id", target);
            await hold.ExecuteNonQueryAsync();
        }
        try
        {
            var approving = ApproveAsync(cs, tenantId, participantId, v2.Id, clock, lockWait: TimeSpan.FromMilliseconds(500));
            var finished = await Task.WhenAny(approving, Task.Delay(TimeSpan.FromSeconds(8)));

            // Without a bound the row lock waited for ever (the server's default lock_timeout), and a lock failure there was a raw PostgresException: a 500.
            Assert.Same(approving, finished);
            var outcome = await approving;
            Assert.Equal((ApprovalStatus.Busy, RosterBusyException.Words), (outcome.Status, Assert.Single(outcome.Errors!)));
        }
        finally
        {
            await holding.RollbackAsync();
        }
        await using var read = Open(cs, tenantId);
        Assert.False(await read.ServiceAgreementDraftApprovals.AnyAsync(a => a.DraftId == v2.Id));
    }


    [SkippableFact]
    public async Task ApprovingASplitRevision_MakesItsPatternsUnderTheUniqueKey_CarriesTheUnchangedDays_AndTidiesTheChangedOne_InOneSave()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var v1 = await StoreAsync(cs, tenantId, participantId, 1);
        await ApproveAsync(cs, tenantId, participantId, v1.Id, clock);
        // What a longer Monday from 2 November saves: the weekday block keeps Tuesday to Friday, and Monday is a block of its own.
        var v2 = await StoreAsync(cs, tenantId, participantId, 2, start: new DateOnly(2026, 11, 2), end: new DateOnly(2026, 12, 20), blocks: new[]
        {
            WeekdayBlock(change: b => b with { Days = ApprovalTestSupport.Weekdays.Skip(1).ToArray() }), WeekdayBlock("weekdays-mon", b => b with { Days = new[] { DayOfWeek.Monday }, End = T(14) }),
        });

        var outcome = await ApproveAsync(cs, tenantId, participantId, v2.Id, clock);

        Assert.Equal((ApprovalStatus.Approved, 5, 20, 5), (outcome.Status, outcome.Approval!.ShiftsCreated, outcome.OldShifts!.Carried, outcome.OldShifts.Removed));
        await using var read = Open(cs, tenantId);
        var keys = await read.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v2.Id).OrderBy(p => p.DayOfWeek).Select(p => p.SourceBlockKey).ToListAsync();
        Assert.Equal(new[] { "weekdays-mon", "weekdays", "weekdays", "weekdays", "weekdays" }, keys);
        Assert.Equal(40, await read.Shifts.CountAsync());                                                // five unfilled Mondays went, five new ones came, twenty moved
        Assert.Equal(25, await read.Shifts.CountAsync(s => read.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == v2.Id)));
    }

    // ── Another generation holds the roster ───────────────────────────────────────

    [SkippableFact]
    public async Task AGenerationWaitingOnAnotherOfTheSameParticipant_GivesUpWithBusy_AndNothingIsLeftHalfDone()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        Guid handMadeId;
        await using (var seed = Open(cs, tenantId))
        {
            var handMade = new ShiftPattern { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), EffectiveFrom = new DateOnly(2026, 10, 1), IsActive = true };
            seed.ShiftPatterns.Add(handMade);
            await seed.SaveChangesAsync();
            handMadeId = handMade.Id;
        }

        var impatient = new RosterShiftGenerator(TimeSpan.FromMilliseconds(400));
        await using var holder = new NpgsqlConnection(cs);
        await holder.OpenAsync();
        await using var held = await holder.BeginTransactionAsync();
        await using (var take = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext('roster-generate:' || @p::text))", holder, held))
        {
            take.Parameters.AddWithValue("p", participantId);
            await take.ExecuteNonQueryAsync();
        }

        // The lock itself: it gives up quickly, and does not leave its context inside an aborted transaction.
        await using (var db = Open(cs, tenantId))
        {
            var waited = Stopwatch.StartNew();
            await Assert.ThrowsAsync<RosterBusyException>(() => RosterGenerationLock.AcquireAsync(db, participantId, CancellationToken.None, TimeSpan.FromMilliseconds(400)));
            Assert.True(waited.Elapsed < TimeSpan.FromSeconds(10), $"waited {waited.Elapsed}");
            Assert.Null(db.Database.CurrentTransaction);
            Assert.Equal(1, await db.ShiftPatterns.CountAsync());                                    // and the context is usable
        }

        // An approval answers Busy and changes nothing.
        await using (var db = Open(cs, tenantId))
        {
            var outcome = await new ServiceAgreementApprovalService(db, new RosterPlacementGate(), impatient, clock: FakeClock.AtUtc(2026, 10, 10, 2, 0)).ApproveAsync(tenantId, participantId, draft.Id, false, Admin, CancellationToken.None);
            Assert.Equal(ApprovalStatus.Busy, outcome.Status);
            Assert.Contains("still running", Assert.Single(outcome.Errors!));
        }

        // The Generate button answers 409 in words.
        await using (var db = Open(cs, tenantId))
        {
            var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), generator: impatient);
            var result = await controller.GeneratePattern(handMadeId, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 26), CancellationToken.None);
            var body = Assert.IsType<ApiResponse<GeneratePatternResultDto>>(Assert.IsType<ConflictObjectResult>(result.Result).Value);
            Assert.Contains("still running", Assert.Single(body.Errors!));
        }

        await using (var read = Open(cs, tenantId))
        {
            Assert.Empty(await read.ServiceAgreementDraftApprovals.ToListAsync());
            Assert.Empty(await read.Shifts.ToListAsync());
            Assert.Equal(1, await read.ShiftPatterns.CountAsync());
        }

        // Released, the same calls go through.
        await held.RollbackAsync();
        await using var free = Open(cs, tenantId);
        var made = await impatient.GenerateAsync(free, participantId, new[] { handMadeId }, new DateOnly(2026, 10, 12), new DateOnly(2026, 10, 26), CancellationToken.None);
        Assert.Equal(3, made.Created);
    }

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
