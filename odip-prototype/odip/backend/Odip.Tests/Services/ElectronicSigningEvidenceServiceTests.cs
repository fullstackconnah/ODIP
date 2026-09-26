using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>Focused safety coverage for development-only signing evidence. It never changes an agreement or schedule to approved/signed.</summary>
public class ElectronicSigningEvidenceServiceTests
{
    private static (OdipDbContext Db, Mock<ICurrentTenant> Tenant) CreateDb(Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options;
        return (new OdipDbContext(options, tenant.Object), tenant);
    }

    private static (Participant Participant, ServiceAgreementDraft Draft) AddDraft(OdipDbContext db, Guid tenantId)
    {
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Participant", IsActive = true, IsDraft = true }).Entity;
        var draft = db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = 2, State = "NSW", ParticipantNameSnapshot = "Ada Participant", CreatedBy = "test" }).Entity;
        draft.Lines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), DraftId = draft.Id, ServiceType = "Support", ItemCode = "TEST", Hours = 1, UnitPrice = 1, CatalogueVersion = "test", CatalogueEffectiveFrom = new DateOnly(2026, 1, 1) });
        return (participant, draft);
    }

    private static SubmitElectronicSigningEvidenceDto Attestation(string key = "idem-1") => new()
    {
        IdempotencyKey = key, SignerName = "Ada Participant", SignerCapacity = "Participant",
        DocumentWasDisplayed = true, ConsentToElectronicMethod = true, IntendsToSign = true
    };

    [Fact]
    public async Task CreateSnapshot_RejectsStaleVersion_AndDoesNotPersistSnapshot()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            var (snapshot, error) = await new ElectronicSigningEvidenceService(db).CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = 1 }, CancellationToken.None);
            Assert.Null(snapshot); Assert.Equal("The selected document version is unavailable or stale.", error);
            Assert.Empty(db.ElectronicSigningSnapshots.IgnoreQueryFilters());
        }
    }

    [Fact]
    public async Task Submit_IsIdempotent_AndLeavesEvidencePendingVerificationOnly()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            var service = new ElectronicSigningEvidenceService(db);
            var (snapshot, snapshotError) = await service.CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.Null(snapshotError);
            var (first, firstError) = await service.SubmitAsync(tenantId, participant.Id, snapshot!.Id, Attestation(), CancellationToken.None);
            var (second, secondError) = await service.SubmitAsync(tenantId, participant.Id, snapshot.Id, Attestation(), CancellationToken.None);
            Assert.Null(firstError); Assert.Null(secondError); Assert.Equal(first!.Id, second!.Id); Assert.Equal("PendingVerification", first.Status);
            Assert.Single(db.ElectronicSigningEvidence.IgnoreQueryFilters());
            Assert.Null(typeof(ServiceAgreementDraft).GetProperty("IsSigned"));
            Assert.Null(typeof(ServiceAgreementDraft).GetProperty("SignedAt"));
        }
    }

    [Fact]
    public async Task Submit_RejectsForeignTenantAndMissingConsent_AndAcceptsRepresentativeCapacity()
    {
        var owner = Guid.NewGuid(); var foreign = Guid.NewGuid(); var (db, _) = CreateDb(owner); using (db)
        {
            var (participant, draft) = AddDraft(db, owner); await db.SaveChangesAsync();
            var service = new ElectronicSigningEvidenceService(db);
            var (snapshot, _) = await service.CreateSnapshotAsync(owner, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            var foreignResult = await service.SubmitAsync(foreign, participant.Id, snapshot!.Id, Attestation(), CancellationToken.None);
            Assert.Null(foreignResult.Evidence); Assert.Equal("Document snapshot not found.", foreignResult.Error);
            var noConsent = Attestation("no-consent") with { ConsentToElectronicMethod = false };
            var missing = await service.SubmitAsync(owner, participant.Id, snapshot.Id, noConsent, CancellationToken.None);
            Assert.Null(missing.Evidence); Assert.Contains("consent", missing.Error!);
            var representative = Attestation("representative") with { IsAuthorisedRepresentative = true, SignerCapacity = "Appointed guardian" };
            var accepted = await service.SubmitAsync(owner, participant.Id, snapshot.Id, representative, CancellationToken.None);
            Assert.Null(accepted.Error); Assert.True(accepted.Evidence!.IsAuthorisedRepresentative); Assert.Equal("Appointed guardian", accepted.Evidence.SignerCapacity);
        }
    }

    [Fact]
    public async Task MissingTenantAndNoConfiguredPricing_FailClosedBeforeAnySchedulingOrEvidence()
    {
        var tenantId = Guid.NewGuid(); var (db, tenant) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            tenant.SetupGet(x => x.TenantId).Returns((Guid?)null);
            var controller = new ServiceAgreementDraftsController(db, tenant.Object, new ServiceAgreementDraftService(db), new ElectronicSigningEvidenceService(db));
            var response = await controller.CreateSigningSnapshot(participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.IsType<BadRequestObjectResult>(response.Result);

            // The pricing phase requires the original tenant context; keep it isolated from the missing-tenant assertion above.
            tenant.SetupGet(x => x.TenantId).Returns(tenantId);
            var noCatalogueRequest = new CreateServiceAgreementDraftDto { PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30), AgreementStartDate = new DateOnly(2026, 7, 1), AgreementEndDate = new DateOnly(2027, 6, 30), State = "NSW", ServiceTypes = ["Support"], Lines = [new CreateServiceAgreementDraftLineDto { ServiceType = "Support", ItemCode = "UNCONFIGURED", Hours = 1 }] };
            var failedDraft = await new ServiceAgreementDraftService(db).CreateAsync(tenantId, participant.Id, noCatalogueRequest, "test", CancellationToken.None);
            Assert.Null(failedDraft.Draft); Assert.Equal("No active effective weekday catalogue price exists for UNCONFIGURED.", failedDraft.Error);
            Assert.Empty(db.ElectronicSigningEvidence.IgnoreQueryFilters());
        }
    }
}
