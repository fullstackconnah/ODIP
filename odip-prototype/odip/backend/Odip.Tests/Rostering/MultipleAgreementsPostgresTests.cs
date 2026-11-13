using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Postgres;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Several agreements per participant on PostgreSQL: the backfill of the migration and the first-save race (D-13).</summary>
public class MultipleAgreementsPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MultipleAgreementsPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static ICurrentTenant TenantOf(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return tenant.Object;
    }

    [SkippableFact]
    public async Task Backfill_OneAgreementPerParticipant_SameActiveRevision()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(connectionString);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        await migrator.MigrateAsync(all[all.IndexOf(all.Single(m => m.EndsWith("_AddAgreementSeries", StringComparison.Ordinal))) - 1]);

        var tenantId = Guid.NewGuid();
        var participantId = Guid.NewGuid();
        db.Tenants.Add(new Tenant { Id = tenantId, Name = "Live Provider", EmailDomain = $"{tenantId:N}.example.com" });
        db.Participants.Add(new Participant { Id = participantId, TenantId = tenantId, FirstName = "Live", LastName = "Participant", IsActive = true });
        var v1 = ApprovalTestSupport.BuildRevision(tenantId, participantId, 1, new[] { ApprovalTestSupport.WeekdayBlock() });
        var v2 = ApprovalTestSupport.BuildRevision(tenantId, participantId, 2, new[] { ApprovalTestSupport.WeekdayBlock() });
        db.ServiceAgreementDrafts.AddRange(v1, v2);
        db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
        {
            Id = Guid.NewGuid(), TenantId = tenantId, DraftId = v2.Id, ParticipantId = participantId, DraftVersion = 2, ApprovedAt = new DateTime(2026, 9, 1, 1, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex Admin",
        });
        await OlderSchemaSeeds.SaveWithLaterColumnsAsync(db);

        await migrator.MigrateAsync();
        await using var after = PostgresFixture.NewContext(connectionString);
        var drafts = await after.ServiceAgreementDrafts.AsNoTracking().IgnoreQueryFilters().OrderBy(d => d.Version).ToListAsync();
        var approval = await after.ServiceAgreementDraftApprovals.AsNoTracking().IgnoreQueryFilters().SingleAsync();

        Assert.All(drafts, d => Assert.Equal((participantId, AgreementKind.Core, null), (d.AgreementId, d.AgreementKind, d.AgreementName)));
        Assert.Equal(participantId, approval.AgreementId);
        // The participant's agreements read as one, whose newest approved revision is the one that was in force.
        var latest = await AgreementRevisions.LatestPerAgreementAsync(after, tenantId, new[] { participantId }, CancellationToken.None);
        Assert.Equal(2, latest[(participantId, participantId)].Current!.Version);
    }

    private static OdipDbContext GatedContext(string connectionString, Guid tenantId, InsertGate gate) =>
        new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(connectionString).AddInterceptors(new InsertGateInterceptor(gate)).Options, TenantOf(tenantId));

    /// <summary>Opens once every one of <paramref name="parties"/> has arrived; a party that waits over 30 s fails the test instead of hanging it.</summary>
    private sealed class InsertGate(int parties)
    {
        private readonly TaskCompletionSource _open = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _arrived;

        public Task ArriveAsync()
        {
            if (Interlocked.Increment(ref _arrived) == parties) _open.SetResult();
            return _open.Task.WaitAsync(TimeSpan.FromSeconds(30));
        }
    }

    private sealed class InsertGateInterceptor(InsertGate gate) : Microsoft.EntityFrameworkCore.Diagnostics.SaveChangesInterceptor
    {
        private bool _arrived;

        public override async ValueTask<Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int>> SavingChangesAsync(
            Microsoft.EntityFrameworkCore.Diagnostics.DbContextEventData eventData, Microsoft.EntityFrameworkCore.Diagnostics.InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (!_arrived && eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraft>().Any(e => e.State == EntityState.Added))
            {
                _arrived = true;
                await gate.ArriveAsync();
            }
            return result;
        }
    }

    [SkippableFact]
    public async Task Race_TwoFirstSavesOfNewAgreements_IsOneRevisionAndOne409_NeverA500()
    {
        RequirePostgres();
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        await using (var admin = PostgresFixture.NewContext(connectionString)) await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        Guid participantId;
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Synthetic", LastName = "Participant", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true });
            await setup.SaveChangesAsync();
            participantId = participant.Entity.Id;
        }

        var request = new CreateServiceAgreementDraftDto
        {
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 10, 12), AgreementEndDate = new DateOnly(2026, 10, 18), State = "NSW",
            NewAgreement = true, AgreementKind = AgreementKind.Core,
            Blocks = [new DraftBlockDto { Block = Block("b1", PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13)), Requirements = new DraftBlockRequirementsDto() }],
        };
        // Task.WhenAll alone does not make the two saves overlap: a save that commits before the other resolves its agreement id makes the other a legitimate second agreement (new id, no conflict).
        // The gate holds both after they have resolved the id and before either inserts, so both are the first agreement.
        var gate = new InsertGate(2);
        await using var first = GatedContext(connectionString, tenantId, gate);
        await using var second = GatedContext(connectionString, tenantId, gate);

        var results = await Task.WhenAll(
            new ServiceAgreementDraftService(first).SaveAsync(tenantId, participantId, request, "one", CancellationToken.None),
            new ServiceAgreementDraftService(second).SaveAsync(tenantId, participantId, request, "two", CancellationToken.None));

        // Both would be the participant's first agreement, with its fixed id: they meet on the unique index, and the loser is told to reload (409), with nothing of its plan kept.
        Assert.Single(results, r => r.Draft is not null);
        Assert.Equal(1, Assert.Single(results, r => r.Draft is null).ConflictVersion);
        await using var read = PostgresFixture.NewContext(connectionString, TenantOf(tenantId));
        var only = Assert.Single(await read.ServiceAgreementDrafts.AsNoTracking().ToListAsync());
        Assert.Equal((participantId, 1), (only.AgreementId, only.Version));
    }
}
