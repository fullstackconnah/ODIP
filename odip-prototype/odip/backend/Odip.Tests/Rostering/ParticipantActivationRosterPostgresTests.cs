using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>Lifecycle activation and roster population share the PostgreSQL roster transaction.</summary>
public sealed class ParticipantActivationRosterPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public ParticipantActivationRosterPostgresTests(PostgresFixture pg) => _pg = pg;

    private static ICurrentTenant Tenant(Guid id) => Mock.Of<ICurrentTenant>(x => x.TenantId == id && !x.IsSuperAdmin);
    private static OdipDbContext Context(string cs, Guid tenantId, IInterceptor interceptor) => new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs).AddInterceptors(interceptor).Options, Tenant(tenantId));
    private static ParticipantsController Controller(OdipDbContext db, TimeProvider? clock = null, ServiceAgreementApprovalService? approval = null) => new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db), clock: clock, agreementApproval: approval)
    { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

    [SkippableFact]
    public async Task BeginServices_WithNoAgreementPattern_CommitsLifecycleInsideTheRosterTransaction()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (seed, tenantId) = await _pg.NewTenantContextAsync(cs);
        await using (seed)
        {
            var p = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "B", IsActive = false, IsDraft = true, IntakeCompletedAt = DateTime.UtcNow };
            seed.Participants.Add(p); await seed.SaveChangesAsync();
            await using var request = PostgresFixture.NewContext(cs, Tenant(tenantId));
            var result = await Controller(request).BeginServices(p.Id, default);
            Assert.IsType<OkObjectResult>(result.Result);
        }
        await using var read = PostgresFixture.NewContext(cs, Tenant(tenantId));
        var saved = await read.Participants.SingleAsync();
        Assert.True(saved.IsActive); Assert.NotNull(saved.ServicesStartedAt);
        Assert.Empty(await read.Shifts.ToListAsync());
    }

    private sealed class PauseSave : SaveChangesInterceptor
    {
        public bool Armed { get; set; }
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
        { if (Armed) { Reached.TrySetResult(); await Release.Task.WaitAsync(ct); } return result; }
    }

    [SkippableFact]
    public async Task BeginServices_NoPatterns_HoldsBoardLockUntilLifecycleSave()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (seed, tenantId) = await _pg.NewTenantContextAsync(cs);
        Guid id;
        await using (seed) { id = Guid.NewGuid(); seed.Participants.Add(new Participant { Id = id, TenantId = tenantId, FirstName = "A", LastName = "B", IsActive = false, IsDraft = true, IntakeCompletedAt = DateTime.UtcNow }); await seed.SaveChangesAsync(); }
        var pause = new PauseSave { Armed = true };
        await using var activationDb = Context(cs, tenantId, pause);
        var activation = Controller(activationDb).BeginServices(id, default);
        try
        {
            await pause.Reached.Task.WaitAsync(TimeSpan.FromSeconds(10));
            await using var contender = PostgresFixture.NewContext(cs, Tenant(tenantId));
            await Assert.ThrowsAsync<RosterBusyException>(() => RosterGenerationLock.AcquireAsync(contender, tenantId, default, TimeSpan.FromMilliseconds(200), "roster-board"));
        }
        finally { pause.Release.TrySetResult(); }
        Assert.IsType<OkObjectResult>((await activation).Result);
    }

    private sealed class FailGeneratedShiftSave : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData data, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (data.Context!.ChangeTracker.Entries<Shift>().Any(e => e.State == EntityState.Added)) throw new InvalidOperationException("synthetic shift-save failure");
            return ValueTask.FromResult(result);
        }
    }

    [SkippableFact]
    public async Task BeginServices_GeneratedShiftSaveFailure_RollsBackLifecycleAndShifts()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (seed, tenantId) = await _pg.NewTenantContextAsync(cs); var day = new DateOnly(2026, 10, 10); Guid id;
        await using (seed)
        {
            id = Guid.NewGuid(); var draft = new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = id, AgreementStartDate = day.AddDays(-7), AgreementEndDate = day.AddDays(7) };
            seed.AddRange(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW" }, new Participant { Id = id, TenantId = tenantId, FirstName = "A", LastName = "B", IsActive = false, IsDraft = true, IntakeCompletedAt = DateTime.UtcNow }, draft,
                new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = tenantId, DraftId = draft.Id, ParticipantId = id, ApprovedAt = DateTime.UtcNow, ApprovedByName = "Synthetic" },
                new ShiftPattern { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = id, SourceDraftId = draft.Id, SourceBlockKey = "x", DayOfWeek = day.DayOfWeek, StartTime = new TimeOnly(9,0), EndTime = new TimeOnly(12,0), EffectiveFrom = day.AddDays(-7), EffectiveTo = day.AddDays(7), IsActive = true },
                new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = RosterWeek.MondayOf(day) }); await seed.SaveChangesAsync();
        }
        await using (var failing = Context(cs, tenantId, new FailGeneratedShiftSave()))
            await Assert.ThrowsAsync<InvalidOperationException>(() => Controller(failing, Odip.Tests.Medications.FakeClock.AtUtc(2026,10,10,2,0)).BeginServices(id, default));
        await using var read = PostgresFixture.NewContext(cs, Tenant(tenantId)); var p = await read.Participants.SingleAsync();
        Assert.False(p.IsActive); Assert.Null(p.ServicesStartedAt); Assert.Empty(await read.Shifts.ToListAsync());
    }

    [SkippableFact]
    public async Task BeginServices_WhenBoardBusy_Returns409AndChangesNothing()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync(); await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var (seed, tenantId) = await _pg.NewTenantContextAsync(cs); Guid id;
        await using (seed) { id = Guid.NewGuid(); seed.Participants.Add(new Participant { Id = id, TenantId = tenantId, FirstName = "A", LastName = "B", IsActive = false, IsDraft = true, IntakeCompletedAt = DateTime.UtcNow }); await seed.SaveChangesAsync(); }
        await using var holderDb = PostgresFixture.NewContext(cs, Tenant(tenantId)); await using var held = await RosterGenerationLock.AcquireAsync(holderDb, tenantId, default, scope: "roster-board");
        await using (var request = PostgresFixture.NewContext(cs, Tenant(tenantId)))
        {
            var approval = new ServiceAgreementApprovalService(request, new RosterPlacementGate(), new RosterShiftGenerator(TimeSpan.FromMilliseconds(200)));
            Assert.IsType<ConflictObjectResult>((await Controller(request, approval: approval).BeginServices(id, default)).Result);
        }
        await using var read = PostgresFixture.NewContext(cs, Tenant(tenantId)); Assert.False((await read.Participants.SingleAsync()).IsActive); Assert.Empty(await read.Shifts.ToListAsync());
    }
}
