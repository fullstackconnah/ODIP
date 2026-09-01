using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// DOC-01 — endpoint-level coverage for <see cref="ParticipantsController.DownloadIntakeFormPdf"/>
/// and <see cref="ParticipantsController.DownloadParticipantProfilePdf"/>: exercises the controller
/// with a real <see cref="ParticipantDocumentService"/> against EF InMemory, same
/// CreateDb/Moq&lt;ICurrentTenant&gt; pattern as <c>ParticipantsControllerTests</c>. Also proves the
/// existing ambient tenant query filter (not any new manual tenant check) correctly extends to the
/// new document endpoints, same convention as <c>SameTenantWritePathTests</c>.
/// </summary>
public class ParticipantDocumentEndpointTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedRepresentativeParticipant(OdipDbContext db, Guid? tenantId = null)
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(),
            FirstName = "Sophie",
            LastName = "Brown",
            NdisNumber = "123456789",
            IsActive = true,
            ServiceStreams = ServiceStreams.CommunityAccessDailyLiving,
            MobilityAidWalker = true,
            PensionCardNumber = "PEN-001",
            SignsHappyAndSettled = "Calm and settled",
        };
        if (tenantId.HasValue) participant.TenantId = tenantId.Value;
        db.Participants.Add(participant);

        var person = new Person { Id = Guid.NewGuid(), FirstName = "Nora", LastName = "Kin", Phone = "0400 000 000" };
        if (tenantId.HasValue) person.TenantId = tenantId.Value;
        db.People.Add(person);

        db.ParticipantContactRoles.Add(new ParticipantContactRole
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, PersonId = person.Id,
            RoleType = ContactRoleType.NextOfKin, IsPrimary = true, Status = ContactRoleStatus.Active,
            TenantId = tenantId ?? Guid.Empty,
        });

        db.ParticipantConsents.Add(new ParticipantConsent
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, ConsentType = ConsentType.PhotoVideo, Granted = true,
            TenantId = tenantId ?? Guid.Empty,
        });

        db.ParticipantHealthConditions.Add(new ParticipantHealthCondition
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, ConditionType = HealthConditionType.Epilepsy, Has = true,
            TenantId = tenantId ?? Guid.Empty,
        });

        db.ParticipantAdlAssessments.Add(new ParticipantAdlAssessment
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, AdlType = AdlType.Dressing, Level = AdlLevel.Supervision,
            TenantId = tenantId ?? Guid.Empty,
        });

        db.ParticipantChecklistItems.Add(new ParticipantChecklistItem
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, ItemType = ChecklistItemType.UsesWheelchair, Value = ChecklistItemValue.Yes,
            TenantId = tenantId ?? Guid.Empty,
        });

        db.ParticipantRiskEntries.Add(new ParticipantRiskEntry
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, AtRiskParty = AtRiskParty.Participant,
            Description = "Falls risk", IsActive = true, TenantId = tenantId ?? Guid.Empty,
        });

        db.SaveChanges();
        return participant;
    }

    [Fact]
    public async Task DownloadIntakeFormPdf_ReturnsNonTrivialPdf()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedRepresentativeParticipant(db);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.DownloadIntakeFormPdf(participant.Id, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.True(file.FileContents.Length > 500, $"Expected a non-trivial PDF, got {file.FileContents.Length} bytes.");
    }

    [Fact]
    public async Task DownloadParticipantProfilePdf_ReturnsNonTrivialPdf()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var participant = SeedRepresentativeParticipant(db);
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.DownloadParticipantProfilePdf(participant.Id, CancellationToken.None);

        var file = Assert.IsType<FileContentResult>(result);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.True(file.FileContents.Length > 500, $"Expected a non-trivial PDF, got {file.FileContents.Length} bytes.");
    }

    [Fact]
    public async Task DownloadIntakeFormPdf_UnknownParticipantId_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.DownloadIntakeFormPdf(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task DownloadParticipantProfilePdf_UnknownParticipantId_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var result = await controller.DownloadParticipantProfilePdf(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task DownloadIntakeFormPdf_ParticipantInDifferentTenant_ReturnsNotFound()
    {
        var tenantAId = Guid.NewGuid();
        var tenantBId = Guid.NewGuid();

        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantAId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        using var db = new OdipDbContext(options, tenant.Object);
        db.Tenants.AddRange(
            new Tenant { Id = tenantAId, Name = "Tenant A", EmailDomain = $"{Guid.NewGuid()}.example.com", IsActive = true },
            new Tenant { Id = tenantBId, Name = "Tenant B", EmailDomain = $"{Guid.NewGuid()}.example.com", IsActive = true });
        db.SaveChanges();

        // Seeded under Tenant B, while the ambient ICurrentTenant above is scoped to Tenant A.
        var participant = SeedRepresentativeParticipant(db, tenantBId);

        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

        var intakeResult = await controller.DownloadIntakeFormPdf(participant.Id, CancellationToken.None);
        var profileResult = await controller.DownloadParticipantProfilePdf(participant.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(intakeResult);
        Assert.IsType<NotFoundObjectResult>(profileResult);
    }
}
