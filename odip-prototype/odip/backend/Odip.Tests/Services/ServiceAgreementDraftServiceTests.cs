using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>Safety-contract tests for quote-only, unsigned service-agreement draft snapshots.</summary>
public class ServiceAgreementDraftServiceTests
{
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static Participant AddParticipant(OdipDbContext db, Guid tenantId) =>
        db.Participants.Add(new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Synthetic", LastName = "Participant",
            NdisNumber = "43100001234", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true, IsDraft = true
        }).Entity;

    /// <summary>A draft is scoped to the community access group, so its items live in a real one (an item always has a group in production; InMemory does not enforce the FK).</summary>
    private static SupportActivityGroup CommunityAccessGroup(OdipDbContext db) =>
        db.SupportActivityGroups.Local.FirstOrDefault(g => g.GroupCode == "GRP_COMMUNITY_ACCESS")
        ?? db.SupportActivityGroups.Add(new SupportActivityGroup { Id = Guid.NewGuid(), GroupCode = "GRP_COMMUNITY_ACCESS", DisplayName = "Community Access", SupportCategory = 4 }).Entity;

    private static SupportCatalogueItem AddCatalogue(OdipDbContext db, string code = "TEST-CODE", decimal vicPrice = 71.25m,
        DateOnly? effectiveFrom = null, DateOnly? effectiveTo = null, bool active = true, string version = "synthetic-v1") =>
        db.SupportCatalogueItems.Add(new SupportCatalogueItem
        {
            Id = Guid.NewGuid(), ActivityGroupId = CommunityAccessGroup(db).Id, ItemNumber = code, Description = "Synthetic catalogue item",
            DayType = ClaimDayType.Weekday, IsIntensive = false, IsActive = active, CatalogueVersion = version,
            EffectiveFrom = effectiveFrom ?? new DateOnly(2025, 1, 1), EffectiveTo = effectiveTo,
            PriceLimit_ACT = 10m, PriceLimit_NSW = 20m, PriceLimit_NT = 30m, PriceLimit_QLD = 40m,
            PriceLimit_SA = 50m, PriceLimit_TAS = 60m, PriceLimit_VIC = vicPrice, PriceLimit_WA = 80m
        }).Entity;

    private static CreateServiceAgreementDraftDto Request(string code = "TEST-CODE", DateOnly? agreementStart = null) => new()
    {
        PlanStartDate = new DateOnly(2025, 7, 1), PlanEndDate = new DateOnly(2026, 6, 30),
        AgreementStartDate = agreementStart ?? new DateOnly(2025, 7, 1), AgreementEndDate = new DateOnly(2026, 6, 30),
        State = "VIC", ServiceTypes = ["Synthetic support"], Representative = "Representative",
        Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Synthetic support", ItemCode = code, Hours = 2.5m }]
    };

    [Fact]
    public async Task CreateAsync_RejectsForeignTenantParticipant_WithoutCreatingDraft()
    {
        var ownTenant = Guid.NewGuid();
        var foreignTenant = Guid.NewGuid();
        var (db, _) = CreateDb(ownTenant);
        using (db)
        {
            var foreignParticipant = AddParticipant(db, foreignTenant);
            AddCatalogue(db);
            await db.SaveChangesAsync();

            var (draft, error) = await new ServiceAgreementDraftService(db)
                .CreateAsync(ownTenant, foreignParticipant.Id, Request(), "synthetic-actor", CancellationToken.None);

            Assert.Null(draft);
            Assert.Equal("Participant not found.", error);
            Assert.Empty(db.ServiceAgreementDrafts.IgnoreQueryFilters());
        }
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CreateAsync_RejectsReversedPlanOrAgreementDateRange(bool reversedPlan)
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        using (db)
        {
            var participant = AddParticipant(db, tenantId);
            AddCatalogue(db);
            await db.SaveChangesAsync();
            var request = Request();
            request = reversedPlan
                ? request with { PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2026, 6, 30) }
                : request with { AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2026, 6, 30) };

            var (draft, error) = await new ServiceAgreementDraftService(db)
                .CreateAsync(tenantId, participant.Id, request, "synthetic-actor", CancellationToken.None);

            Assert.Null(draft);
            Assert.Equal("End dates must not precede start dates.", error);
            Assert.Empty(db.ServiceAgreementDrafts);
        }
    }

    [Fact]
    public async Task CreateAsync_UsesOnlySingleActiveEffectiveWeekdayCataloguePrice_AndHasNoCallerPriceOverride()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        using (db)
        {
            var participant = AddParticipant(db, tenantId);
            AddCatalogue(db, vicPrice: 71.25m, version: "synthetic-v1");
            await db.SaveChangesAsync();

            var (draft, error) = await new ServiceAgreementDraftService(db)
                .CreateAsync(tenantId, participant.Id, Request(), "synthetic-actor", CancellationToken.None);

            Assert.Null(error);
            var line = Assert.Single(draft!.Lines);
            Assert.Equal(71.25m, line.UnitPrice);
            Assert.Equal("synthetic-v1", line.CatalogueVersion);
            Assert.Null(typeof(CreateServiceAgreementDraftLineDto).GetProperty("UnitPrice"));
        }
    }

    [Theory]
    [InlineData("E")]    // an Each item such as a sleepover
    [InlineData("D")]    // a per-day item such as STA accommodation
    [InlineData("WK")]
    public async Task CreateAsync_RejectsAnItemThatIsNotPricedPerHour_BecauseALineIsHoursAtTheUnitPrice(string unit)
    {
        // The catalogue holds every item since the 2026-27 import: pricing "8 hours" of a $311.79 sleepover would quote 8 x $311.79.
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        using (db)
        {
            var participant = AddParticipant(db, tenantId);
            AddCatalogue(db).Unit = unit;
            await db.SaveChangesAsync();

            var (draft, error) = await new ServiceAgreementDraftService(db)
                .CreateAsync(tenantId, participant.Id, Request(), "synthetic-actor", CancellationToken.None);

            Assert.Null(draft);
            Assert.Equal("No active effective weekday catalogue price exists for TEST-CODE.", error);
            Assert.Empty(db.ServiceAgreementDrafts);
        }
    }

    [Fact]
    public async Task CreateAsync_FailsClosedForInactiveExpiredOrAmbiguousCatalogueRows()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        using (db)
        {
            var participant = AddParticipant(db, tenantId);
            AddCatalogue(db, active: false);
            AddCatalogue(db, code: "EXPIRED", effectiveTo: new DateOnly(2025, 6, 30));
            AddCatalogue(db, code: "AMBIGUOUS", version: "a");
            AddCatalogue(db, code: "AMBIGUOUS", version: "b");
            await db.SaveChangesAsync();
            var service = new ServiceAgreementDraftService(db);

            var (_, inactive) = await service.CreateAsync(tenantId, participant.Id, Request(), "synthetic-actor", CancellationToken.None);
            var (_, expired) = await service.CreateAsync(tenantId, participant.Id, Request("EXPIRED"), "synthetic-actor", CancellationToken.None);
            var (_, ambiguous) = await service.CreateAsync(tenantId, participant.Id, Request("AMBIGUOUS"), "synthetic-actor", CancellationToken.None);

            Assert.Equal("No active effective weekday catalogue price exists for TEST-CODE.", inactive);
            Assert.Equal("No active effective weekday catalogue price exists for EXPIRED.", expired);
            Assert.Equal("Ambiguous active effective catalogue prices exist for AMBIGUOUS.", ambiguous);
            Assert.Empty(db.ServiceAgreementDrafts);
        }
    }

    [Fact]
    public async Task CreateAsync_ProducesImmutableVersionedUnsignedCatalogueSnapshots()
    {
        var tenantId = Guid.NewGuid();
        var (db, _) = CreateDb(tenantId);
        using (db)
        {
            var participant = AddParticipant(db, tenantId);
            var catalogue = AddCatalogue(db, vicPrice: 71.25m, version: "synthetic-v1");
            await db.SaveChangesAsync();
            var service = new ServiceAgreementDraftService(db);

            var (first, firstError) = await service.CreateAsync(tenantId, participant.Id, Request(), "synthetic-actor", CancellationToken.None);
            Assert.Null(firstError);
            // An earlier revision nobody did anything with is replaced by the next save; one that was approved is kept exactly as it was saved.
            db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval { Id = Guid.NewGuid(), TenantId = tenantId, DraftId = first!.Id, ParticipantId = participant.Id, DraftVersion = first.Version, ApprovedAt = new DateTime(2025, 7, 1, 0, 0, 0, DateTimeKind.Utc), ApprovedByName = "Synthetic Approver" });
            catalogue.PriceLimit_VIC = 99.50m;
            catalogue.CatalogueVersion = "synthetic-v2";
            await db.SaveChangesAsync();
            var (second, secondError) = await service.CreateAsync(tenantId, participant.Id, Request(), "synthetic-actor", CancellationToken.None);

            Assert.Null(secondError);
            Assert.Equal(1, first.Version);
            Assert.Equal(2, second!.Version);
            var storedFirst = await db.ServiceAgreementDraftLines.SingleAsync(line => line.DraftId == first.Id);
            Assert.Equal(71.25m, storedFirst.UnitPrice);
            Assert.Equal("synthetic-v1", storedFirst.CatalogueVersion);
            Assert.Equal(99.50m, Assert.Single(second.Lines).UnitPrice);
            Assert.Equal("synthetic-v2", Assert.Single(second.Lines).CatalogueVersion);
            Assert.Equal("UnapprovedDraft", new ServiceAgreementDraftDto().Status);
            Assert.Equal("ODIP-Service-Agreement-Blank-DRAFT-2026-09-27", ProvisionalAgreementTemplate.Version);
            Assert.Equal("2d87e4c21d569161f22aa2246a0146418d5f14fabe6c607616844a97ecb8648f", ProvisionalAgreementTemplate.DocxSha256);
            Assert.Equal("d26f0d1ea2e78f4b29df37d89d0bad61400c842b4dc090e303969ddd9335d06d", ProvisionalAgreementTemplate.PdfSha256);
            Assert.Null(typeof(ServiceAgreementDraft).GetProperty("SignedAt"));
            Assert.Null(typeof(ServiceAgreementDraft).GetProperty("SignedBy"));
            Assert.Null(typeof(ServiceAgreementDraft).GetProperty("IsSigned"));
        }
    }

    [Fact]
    public async Task List_IsTenantFiltered_AndPdfAndEvidenceEndpointsFailClosed()
    {
        var ownTenant = Guid.NewGuid();
        var foreignTenant = Guid.NewGuid();
        var (db, tenant) = CreateDb(ownTenant);
        using (db)
        {
            var ownParticipant = AddParticipant(db, ownTenant);
            var foreignParticipant = AddParticipant(db, foreignTenant);
            db.ServiceAgreementDrafts.AddRange(
                new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = ownTenant, ParticipantId = ownParticipant.Id, Version = 1, State = "VIC", ParticipantNameSnapshot = "Own", CreatedBy = "synthetic" },
                new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = foreignTenant, ParticipantId = foreignParticipant.Id, Version = 1, State = "VIC", ParticipantNameSnapshot = "Foreign", CreatedBy = "synthetic" });
            await db.SaveChangesAsync();
            var controller = new ServiceAgreementDraftsController(db, tenant.Object, new ServiceAgreementDraftService(db));

            var list = await controller.List(foreignParticipant.Id, CancellationToken.None);

            var ok = Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(list.Result);
            var response = Assert.IsType<Odip.Application.Common.ApiResponse<List<ServiceAgreementDraftDto>>>(ok.Value);
            Assert.Empty(response.Data!);
            var ownList = await controller.List(ownParticipant.Id, CancellationToken.None);
            var ownResponse = Assert.IsType<Odip.Application.Common.ApiResponse<List<ServiceAgreementDraftDto>>>(((Microsoft.AspNetCore.Mvc.OkObjectResult)ownList.Result!).Value);
            var selected = Assert.Single(ownResponse.Data!);
            Assert.Equal("UnapprovedDraft", selected.Status);
            Assert.Equal(ProvisionalAgreementTemplate.Version, selected.TemplateVersion);
            Assert.Equal(ProvisionalAgreementTemplate.DocxSha256, selected.TemplateDocxSha256);
            Assert.Equal(ProvisionalAgreementTemplate.PdfSha256, selected.TemplatePdfSha256);
            var pdf = await controller.Pdf(ownParticipant.Id, Guid.NewGuid(), CancellationToken.None);
            Assert.IsType<Microsoft.AspNetCore.Mvc.NotFoundObjectResult>(pdf);
            Assert.IsType<Microsoft.AspNetCore.Mvc.ConflictObjectResult>(controller.AttachSignedEvidence(ownParticipant.Id, Guid.NewGuid()).Result);
        }
    }
}
