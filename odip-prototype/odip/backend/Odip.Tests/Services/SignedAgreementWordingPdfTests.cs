using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>A signed agreement's PDF prints the wording it was signed with, whatever the organisation's wording says now. Signing is closed by design, so the snapshot and its evidence row are written directly.</summary>
public class SignedAgreementWordingPdfTests
{
    private static string Sk(string text) => PlanPricing.DraftSigningAndPdfTests.Skeleton(text);
    private const string Standard = "Complete approved responsibilities";

    private static (OdipDbContext Db, Guid TenantId, Guid ParticipantId, ServiceAgreementDraft Draft) Setup(string? liveResponsibilities, string? liveComplaints)
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        var participant = db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Participant", IsActive = true, IsDraft = true }).Entity;
        var draft = db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, Version = 2, State = "NSW", ParticipantNameSnapshot = "Ada Participant", CreatedBy = "test" }).Entity;
        draft.Lines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), DraftId = draft.Id, ServiceType = "Support", ItemCode = "TEST", Hours = 1, UnitPrice = 1, CatalogueVersion = "test", CatalogueEffectiveFrom = new DateOnly(2026, 1, 1) });
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, State = "NSW", AgreementResponsibilitiesTerms = liveResponsibilities, AgreementComplaintsTerms = liveComplaints });
        return (db, tenantId, participant.Id, draft);
    }

    /// <summary>A snapshot of the draft holding this wording; with a signature unless told otherwise.</summary>
    private static async Task SnapshotAsync(OdipDbContext db, ServiceAgreementDraft draft, Guid tenantId, Guid participantId, string? responsibilities, string? complaints, bool signed = true, int? version = null)
    {
        var snapshot = db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, DraftId = draft.Id, DraftVersion = version ?? draft.Version,
            DocumentJson = ElectronicSigningEvidenceService.BuildDocument(draft, responsibilities, complaints), DocumentHash = "h",
        }).Entity;
        if (signed) db.ElectronicSigningEvidence.Add(new ElectronicSigningEvidence { Id = Guid.NewGuid(), TenantId = tenantId, SnapshotId = snapshot.Id, IdempotencyKey = "k", SignerName = "Ada", SignerCapacity = "Participant" });
        await db.SaveChangesAsync();
    }

    private static async Task<string> PrintedAsync(OdipDbContext db, Guid tenantId, Guid participantId, Guid draftId)
    {
        var (pdf, error) = await new ServiceAgreementDraftService(db).RenderPdfAsync(tenantId, participantId, draftId, CancellationToken.None);
        Assert.Null(error);
        return PlanPricing.DraftSigningAndPdfTests.TextOf(pdf!.Content);
    }

    [Fact]
    public async Task A_signed_agreement_prints_the_wording_it_was_signed_with_not_the_wording_saved_since()
    {
        var (db, tenantId, participantId, draft) = Setup("Wording-BRAVO-live", "Complaints-BRAVO-live"); using (db)
        {
            await SnapshotAsync(db, draft, tenantId, participantId, "Wording-ALPHA-signed", "Complaints-ALPHA-signed");
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk("Wording-ALPHA-signed"), text); Assert.Contains(Sk("Complaints-ALPHA-signed"), text);
            Assert.DoesNotContain("BRAVO", text);
        }
    }

    [Fact]
    public async Task A_signed_agreement_keeps_its_wording_when_the_live_wording_is_cleared()
    {
        var (db, tenantId, participantId, draft) = Setup(null, null); using (db)
        {
            await SnapshotAsync(db, draft, tenantId, participantId, "Wording-ALPHA-signed", "Complaints-ALPHA-signed");
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk("Wording-ALPHA-signed"), text); Assert.DoesNotContain(Sk(Standard), text);
        }
    }

    [Fact]
    public async Task A_prepared_but_unsigned_snapshot_does_not_pin_the_wording()
    {
        var (db, tenantId, participantId, draft) = Setup("Wording-BRAVO-live", null); using (db)
        {
            await SnapshotAsync(db, draft, tenantId, participantId, "Wording-ALPHA-signed", null, signed: false);
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk("Wording-BRAVO-live"), text); Assert.DoesNotContain("ALPHA", text);
        }
    }

    [Fact]
    public async Task An_agreement_signed_on_the_standard_text_keeps_the_standard_text_when_custom_wording_is_saved_since()
    {
        var (db, tenantId, participantId, draft) = Setup("Wording-BRAVO-live", "Complaints-BRAVO-live"); using (db)
        {
            await SnapshotAsync(db, draft, tenantId, participantId, null, null);
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk(Standard), text); Assert.DoesNotContain("BRAVO", text);
        }
    }

    [Fact]
    public async Task A_signature_on_an_earlier_version_does_not_pin_a_later_version()
    {
        var (db, tenantId, participantId, draft) = Setup("Wording-BRAVO-live", null); using (db)
        {
            await SnapshotAsync(db, draft, tenantId, participantId, "Wording-ALPHA-signed", null, version: draft.Version - 1);
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk("Wording-BRAVO-live"), text); Assert.DoesNotContain("ALPHA", text);
        }
    }

    [Fact]
    public async Task Another_tenants_signed_snapshot_of_the_same_draft_id_is_never_read()
    {
        var (db, tenantId, participantId, draft) = Setup("Wording-BRAVO-live", null); using (db)
        {
            await SnapshotAsync(db, draft, Guid.NewGuid(), participantId, "Wording-ALPHA-signed", null);
            var text = await PrintedAsync(db, tenantId, participantId, draft.Id);
            Assert.Contains(Sk("Wording-BRAVO-live"), text); Assert.DoesNotContain("ALPHA", text);
        }
    }

    [Fact]
    public void The_reader_gives_nulls_for_a_document_without_the_wording_properties()
    {
        Assert.Equal((null, null), ElectronicSigningEvidenceService.WordingIn("{\"Id\":1}"));
        Assert.Equal((null, null), ElectronicSigningEvidenceService.WordingIn("{\"ResponsibilitiesTerms\":null,\"ComplaintsTerms\":null}"));
        Assert.Equal(("A", "B"), ElectronicSigningEvidenceService.WordingIn("{\"ResponsibilitiesTerms\":\"A\",\"ComplaintsTerms\":\"B\"}"));
    }
}
