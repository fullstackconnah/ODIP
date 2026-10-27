using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Postgres;
using Odip.Tests.Medications;
using Xunit;
using Xunit.Abstractions;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements page (PR A) on PostgreSQL: the list and price-list queries (GroupBy, EXISTS, ANY) and approve-batch in series, which EF InMemory cannot vouch for.</summary>
public class AgreementListPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    private readonly ITestOutputHelper _output;
    public AgreementListPostgresTests(PostgresFixture pg, ITestOutputHelper output) { _pg = pg; _output = output; }

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static OdipDbContext Open(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    /// <summary>A migrated scratch database with one organisation (a Sydney provider), the nine started roster weeks and <paramref name="count"/> participants.</summary>
    private async Task<(string ConnectionString, Guid TenantId, List<Guid> ParticipantIds)> SetUpAsync(int count = 1)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        await using (setup)
        {
            var ids = new List<Guid>();
            for (var i = 0; i < count; i++)
                ids.Add(setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = $"Amy{i:00}", LastName = "Ng", NdisNumber = $"4310000{i:0000}", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true }).Entity.Id);
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            setup.RosterWeeks.AddRange(StartedWeekRows(tenantId));
            await setup.SaveChangesAsync();
            return (connectionString, tenantId, ids);
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

    private static ServiceAgreementsController Controller(OdipDbContext db, Guid tenantId, ServiceAgreementApprovalService? approval = null)
    {
        var identity = new System.Security.Claims.ClaimsIdentity(new[]
        {
            new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()),
            new System.Security.Claims.Claim("fullName", Admin.Name), new System.Security.Claims.Claim(System.Security.Claims.ClaimTypes.Role, "Admin"),
        }, "Test");
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        return new ServiceAgreementsController(db, Mock.Of<ICurrentTenant>(t => t.TenantId == tenantId), clock, approval ?? new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: clock))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new System.Security.Claims.ClaimsPrincipal(identity) } },
        };
    }

    private static AgreementApproveBatchDto Batch(IEnumerable<(Guid ParticipantId, Guid DraftId)> items) =>
        new() { Items = items.Select(i => new AgreementDraftRefDto { ParticipantId = i.ParticipantId, DraftId = i.DraftId }).ToList() };

    private static List<AgreementApproveResultDto> Data(ActionResult<ApiResponse<List<AgreementApproveResultDto>>> r) =>
        Assert.IsType<ApiResponse<List<AgreementApproveResultDto>>>(Assert.IsType<OkObjectResult>(r.Result).Value).Data!;

    [SkippableFact]
    public async Task TheList_AndThePriceLists_Translate_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync(2);
        await using (var catalogue = Open(cs, tenantId))
        {
            await CatalogueImportTestSupport.ImportAsync(catalogue, CatalogueFixtures.File2025_26Trimmed);
            await CatalogueImportTestSupport.ImportAsync(catalogue, CatalogueFixtures.File2026_27);
        }
        await StoreAsync(cs, tenantId, ids[0], 1);
        await StoreAsync(cs, tenantId, ids[1], 1);
        await StoreAsync(cs, tenantId, ids[1], 2);

        await using var db = Open(cs, tenantId);
        var controller = Controller(db, tenantId);
        var list = Assert.IsType<ApiResponse<AgreementListDto>>(Assert.IsType<OkObjectResult>((await controller.List(CancellationToken.None)).Result).Value).Data!;
        var lists = Assert.IsType<ApiResponse<List<PriceListDto>>>(Assert.IsType<OkObjectResult>((await controller.PriceLists(CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(2, list.Rows.Count);
        Assert.Equal(new[] { "NotApproved", "NotApproved" }, list.Rows.Select(r => r.Status));
        Assert.True(lists.Count >= 2);
        Assert.Equal(lists.OrderByDescending(l => l.Start).Select(l => l.Version), lists.Select(l => l.Version));
    }

    [SkippableFact]
    public async Task ApproveBatch_ApprovesInSeries_AndAnswersEveryItem_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync(3);
        var d0 = await StoreAsync(cs, tenantId, ids[0], 1);
        var d1 = await StoreAsync(cs, tenantId, ids[1], 1);
        await StoreAsync(cs, tenantId, ids[1], 2);                                                // d1 is now superseded
        var d2 = await StoreAsync(cs, tenantId, ids[2], 1);

        await using var db = Open(cs, tenantId);
        var data = Data(await Controller(db, tenantId).ApproveBatch(Batch(new[] { (ids[0], d0.Id), (ids[1], d1.Id), (ids[2], d2.Id) }), CancellationToken.None));

        Assert.Equal(new[] { "Approved", "Superseded", "Approved" }, data.Select(r => r.Outcome));
        await using var check = Open(cs, tenantId);
        Assert.Equal(2, await check.ServiceAgreementDraftApprovals.CountAsync());
    }

    [SkippableFact]
    public async Task ApproveBatch_AnswersBusy_WhenARosterGenerationHoldsTheLock_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync();
        var draft = await StoreAsync(cs, tenantId, ids[0], 1);

        await using var holder = new NpgsqlConnection(cs);
        await holder.OpenAsync();
        await using var held = await holder.BeginTransactionAsync();
        await using (var take = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext('roster-generate:' || @p::text))", holder, held))
        {
            take.Parameters.AddWithValue("p", ids[0]);
            await take.ExecuteNonQueryAsync();
        }

        await using var db = Open(cs, tenantId);
        var clock = FakeClock.AtUtc(2026, 10, 10, 2, 0);
        var approval = new ServiceAgreementApprovalService(db, new RosterPlacementGate(), new RosterShiftGenerator(TimeSpan.FromMilliseconds(400)), clock: clock);
        var data = Data(await Controller(db, tenantId, approval).ApproveBatch(Batch(new[] { (ids[0], draft.Id) }), CancellationToken.None));

        Assert.Equal("Busy", Assert.Single(data).Outcome);
        await using var check = Open(cs, tenantId);
        Assert.Equal(0, await check.ServiceAgreementDraftApprovals.CountAsync());
    }

    /// <summary>Times one full batch (the proxies keep a 60 s default). The seconds are printed for the report; over 40 s the cap and the page's chunk drop to 10.</summary>
    [SkippableFact]
    public async Task ApproveBatch_OfTheFullCap_FitsInsideTheProxyTimeout_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync(ServiceAgreementsController.MaxItems);
        var items = new List<(Guid, Guid)>();
        foreach (var id in ids) items.Add((id, (await StoreAsync(cs, tenantId, id, 1)).Id));

        await using var db = Open(cs, tenantId);
        var clock = Stopwatch.StartNew();
        var data = Data(await Controller(db, tenantId).ApproveBatch(Batch(items), CancellationToken.None));
        clock.Stop();

        _output.WriteLine($"TIMING approve-batch of {items.Count}: {clock.Elapsed.TotalSeconds:F1} s");
        Assert.All(data, r => Assert.Equal("Approved", r.Outcome));
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(40), $"approve-batch of {items.Count} took {clock.Elapsed.TotalSeconds:F1} s");
    }
}
