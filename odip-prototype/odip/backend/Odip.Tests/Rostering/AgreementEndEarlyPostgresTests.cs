using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Services;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Delete draft and End early on PostgreSQL: the roster lock answering busy, and an approval that lands between Delete's check and its delete (the restricting key), which InMemory cannot vouch for.</summary>
public class AgreementEndEarlyPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public AgreementEndEarlyPostgresTests(PostgresFixture pg) { _pg = pg; }

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    private static OdipDbContext Open(string connectionString, Guid tenantId, params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(connectionString).AddInterceptors(interceptors).Options, TenantOf(tenantId));

    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync()
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participantId = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", NdisNumber = "431000001", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true }).Entity.Id;
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            setup.RosterWeeks.AddRange(StartedWeekRows(tenantId));
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participantId);
        }
    }

    private static async Task<ServiceAgreementDraft> StoreAsync(string connectionString, Guid tenantId, Guid participantId, int version)
    {
        await using var db = Open(connectionString, tenantId);
        var draft = BuildRevision(tenantId, participantId, version, new[] { WeekdayBlock() }, null, null);
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        return draft;
    }

    private static ServiceAgreementApprovalService Service(OdipDbContext db, TimeSpan? lockWait = null) =>
        new(db, new RosterPlacementGate(), lockWait is null ? new RosterShiftGenerator() : new RosterShiftGenerator(lockWait.Value), clock: FakeClock.AtUtc(2026, 10, 10, 2, 0));

    [SkippableFact]
    public async Task EndEarly_AnswersBusy_WhenARosterGenerationHoldsTheParticipantsLock_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        await using (var approve = Open(cs, tenantId))
            Assert.Equal(ApprovalStatus.Approved, (await Service(approve).ApproveAsync(tenantId, participantId, draft.Id, false, Admin, CancellationToken.None)).Status);

        await using var holder = new NpgsqlConnection(cs);
        await holder.OpenAsync();
        await using var held = await holder.BeginTransactionAsync();
        await using (var take = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext('roster-generate:' || @p::text))", holder, held))
        {
            take.Parameters.AddWithValue("p", participantId);
            await take.ExecuteNonQueryAsync();
        }

        await using var db = Open(cs, tenantId);
        var outcome = await Service(db, TimeSpan.FromMilliseconds(400)).EndEarlyAsync(tenantId, participantId, draft.Id, new DateOnly(2026, 10, 30), Admin, CancellationToken.None);

        Assert.Equal(EndEarlyStatus.Busy, outcome.Status);
        Assert.Equal(RosterBusyException.Words, outcome.Error);
        await using var check = Open(cs, tenantId);
        var after = await check.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == draft.Id);
        Assert.Equal(new DateOnly(2026, 12, 20), after.AgreementEndDate);
        Assert.Null(after.OriginalAgreementEndDate);
    }

    [SkippableFact]
    public async Task EndEarly_StopsThePatterns_AndKeepsTheSignedEnd_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        await using (var work = Open(cs, tenantId))
        {
            var service = Service(work);
            await service.ApproveAsync(tenantId, participantId, draft.Id, false, Admin, CancellationToken.None);
            var outcome = await service.EndEarlyAsync(tenantId, participantId, draft.Id, new DateOnly(2026, 10, 30), Admin, CancellationToken.None);
            Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        }

        await using var check = Open(cs, tenantId);
        var after = await check.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == draft.Id);
        Assert.Equal((new DateOnly(2026, 10, 30), new DateOnly(2026, 12, 20)), (after.AgreementEndDate, after.OriginalAgreementEndDate));
        Assert.All(await check.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == draft.Id).ToListAsync(), p => Assert.Equal(new DateOnly(2026, 10, 30), p.EffectiveTo));
    }

    /// <summary>An approval that lands after Delete read "no approval" and before it deleted meets the restricting key: the same 409 words as an approved draft, and the draft is still there.</summary>
    [SkippableFact]
    public async Task Delete_AnswersRefused_NotAServerError_WhenAnApprovalLandsBeforeTheDelete_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, participantId, 1);
        var race = new RunOnceBeforeSave(async () =>
        {
            await using var other = Open(cs, tenantId);
            await Service(other).ApproveAsync(tenantId, participantId, draft.Id, false, Admin, CancellationToken.None);
        });

        await using var db = Open(cs, tenantId, race);
        var outcome = await new ServiceAgreementDraftService(db).DeleteAsync(tenantId, participantId, draft.Id, Admin, CancellationToken.None);

        Assert.Equal(DraftDeleteStatus.Refused, outcome.Status);
        Assert.Equal(ServiceAgreementDraftService.ApprovedCantBeDeleted, outcome.Error);
        await using var check = Open(cs, tenantId);
        Assert.True(await check.ServiceAgreementDrafts.AnyAsync(x => x.Id == draft.Id));
        Assert.Equal(0, await check.AuditLogs.CountAsync(a => a.EntityId == draft.Id));
    }

    private sealed class RunOnceBeforeSave(Func<Task> action) : SaveChangesInterceptor
    {
        private bool _ran;
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
        {
            if (!_ran) { _ran = true; await action(); }
            return result;
        }
    }
}
