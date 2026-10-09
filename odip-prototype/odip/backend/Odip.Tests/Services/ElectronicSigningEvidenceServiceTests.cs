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
    public async Task CreateSnapshot_RejectsUnapprovedSource_WithoutSnapshotOrEvidenceWrites()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            var service = new ElectronicSigningEvidenceService(db);
            var (snapshot, snapshotError) = await service.CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.Null(snapshot);
            Assert.Equal("Electronic signing evidence is unavailable because the selected agreement source is not approved.", snapshotError);
            Assert.Empty(db.ElectronicSigningSnapshots.IgnoreQueryFilters());
            Assert.Empty(db.ElectronicSigningEvidence.IgnoreQueryFilters());
        }
    }

    [Fact]
    public async Task Submit_RejectsPreExistingSnapshotForUnapprovedSource_WithoutEvidenceWrites()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            var snapshot = db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, DraftId = draft.Id,
                DraftVersion = draft.Version, DocumentJson = "pre-existing", DocumentHash = "not-checked-before-source-gate"
            }).Entity;
            await db.SaveChangesAsync();

            var service = new ElectronicSigningEvidenceService(db);
            var (evidence, error) = await service.SubmitAsync(tenantId, participant.Id, snapshot.Id, Attestation(), CancellationToken.None);

            Assert.Null(evidence);
            Assert.Equal("Electronic signing evidence is unavailable because the selected agreement source is not approved.", error);
            Assert.Single(db.ElectronicSigningSnapshots.IgnoreQueryFilters());
            Assert.Empty(db.ElectronicSigningEvidence.IgnoreQueryFilters());
        }
    }

    // The agreement PDF no longer says "UNAPPROVED / NOT FOR SIGNING". That is only what it prints: the template's state is what keeps signing closed, and it is what it was.
    [Fact]
    public async Task A_pdf_with_no_unapproved_banner_does_not_open_signing_the_state_and_both_refusals_are_what_they_were()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); await db.SaveChangesAsync();
            const string refusal = "Electronic signing evidence is unavailable because the selected agreement source is not approved.";

            var text = Odip.Tests.PlanPricing.DraftSigningAndPdfTests.TextOf(ServiceAgreementDraftPdfRenderer.Render(draft));

            Assert.DoesNotContain(Odip.Tests.PlanPricing.DraftSigningAndPdfTests.Skeleton("UNAPPROVED"), text);
            Assert.Equal("UnapprovedDraft", ProvisionalAgreementTemplate.State);
            Assert.False(ProvisionalAgreementTemplate.AllowsElectronicSigningEvidence);
            var service = new ElectronicSigningEvidenceService(db);
            var (snapshot, snapshotError) = await service.CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.Null(snapshot);
            Assert.Equal(refusal, snapshotError);
            var stored = db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, DraftId = draft.Id, DraftVersion = draft.Version, DocumentJson = "{}", DocumentHash = new string('a', 64),
            }).Entity;
            await db.SaveChangesAsync();
            var (evidence, evidenceError) = await service.SubmitAsync(tenantId, participant.Id, stored.Id, Attestation(), CancellationToken.None);
            Assert.Null(evidence);
            Assert.Equal(refusal, evidenceError);
            Assert.Empty(db.ElectronicSigningEvidence.IgnoreQueryFilters());
        }
    }

    private static ServiceAgreementDraft AddNewerRevision(OdipDbContext db, Guid tenantId, Participant participant, ServiceAgreementDraft older) =>
        db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = older.Version + 1, State = "NSW", ParticipantNameSnapshot = "Ada Participant", CreatedBy = "test" }).Entity;

    [Fact]
    public async Task CreateSnapshot_RejectsDraftWithNewerRevision_BeforeAnySnapshotIsWritten()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); AddNewerRevision(db, tenantId, participant, draft); await db.SaveChangesAsync();
            var (snapshot, error) = await new ElectronicSigningEvidenceService(db).CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.Null(snapshot);
            Assert.Equal(ElectronicSigningEvidenceService.SupersededDraftError, error);
            Assert.Empty(db.ElectronicSigningSnapshots.IgnoreQueryFilters());
        }
    }

    [Fact]
    public async Task Submit_RejectsSnapshotOfSupersededDraft_WithoutEvidenceWrites()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId); AddNewerRevision(db, tenantId, participant, draft);
            var snapshot = db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, DraftId = draft.Id,
                DraftVersion = draft.Version, DocumentJson = "pre-existing", DocumentHash = "not-checked-before-superseded-gate"
            }).Entity;
            await db.SaveChangesAsync();
            var (evidence, error) = await new ElectronicSigningEvidenceService(db).SubmitAsync(tenantId, participant.Id, snapshot.Id, Attestation(), CancellationToken.None);
            Assert.Null(evidence);
            Assert.Equal(ElectronicSigningEvidenceService.SupersededDraftError, error);
            Assert.Empty(db.ElectronicSigningEvidence.IgnoreQueryFilters());
        }
    }

    [Fact]
    public async Task NewerRevisionOfAnotherParticipant_DoesNotSupersedeThisDraft()
    {
        var tenantId = Guid.NewGuid(); var (db, _) = CreateDb(tenantId); using (db)
        {
            var (participant, draft) = AddDraft(db, tenantId);
            var (other, otherDraft) = AddDraft(db, tenantId); AddNewerRevision(db, tenantId, other, otherDraft); await db.SaveChangesAsync();
            var (_, error) = await new ElectronicSigningEvidenceService(db).CreateSnapshotAsync(tenantId, participant.Id, new() { DraftId = draft.Id, DraftVersion = draft.Version }, CancellationToken.None);
            Assert.Equal("Electronic signing evidence is unavailable because the selected agreement source is not approved.", error);
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
