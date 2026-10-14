using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreement PR 2 on PostgreSQL: the ending query (an EXISTS in its projection, ANY over the participants) and the renewal (Task 4), which EF InMemory cannot vouch for.</summary>
public class AgreementRenewalPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public AgreementRenewalPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static OdipDbContext Open(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    /// <summary>A migrated scratch database with one organisation (a Sydney provider) and one participant of it.</summary>
    private async Task<(string ConnectionString, Guid TenantId, Guid ParticipantId)> SetUpAsync()
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var participant = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true }).Entity;
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, participant.Id);
        }
    }

    /// <summary>A revision stored as a save stores it, with an approval row when it is approved.</summary>
    private static async Task<ServiceAgreementDraft> StoreAsync(string connectionString, Guid tenantId, Guid participantId, int version, DateOnly start, DateOnly end, bool approved)
    {
        await using var db = Open(connectionString, tenantId);
        var draft = BuildRevision(tenantId, participantId, version, new[] { WeekdayBlock() }, start, end);
        db.ServiceAgreementDrafts.Add(draft);
        await db.SaveChangesAsync();
        if (approved) await MarkApprovedAsync(db, draft);
        return draft;
    }

    [SkippableFact]
    public async Task TheEndingQuery_ReadsTheApprovalsAndTheWaitingRenewal_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, participantId) = await SetUpAsync();
        await StoreAsync(cs, tenantId, participantId, 1, new DateOnly(2026, 9, 7), new DateOnly(2026, 10, 5), approved: true);
        await StoreAsync(cs, tenantId, participantId, 2, new DateOnly(2026, 10, 6), new DateOnly(2027, 3, 31), approved: false);

        await using var db = Open(cs, tenantId);
        var row = Assert.Single(await AgreementEnding.FindAsync(db, new[] { participantId }, new DateOnly(2026, 10, 10), CancellationToken.None));

        Assert.Equal((1, -5, (int?)2), (row.Version, row.DaysLeft, row.RenewalVersion));
    }
}
