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

namespace Odip.Tests.Controllers;

public class ParticipantIntakeControllerTests
{
    private static OdipDbContext CreateDb(string name, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(x => x.TenantId).Returns(tenantId);
        tenant.Setup(x => x.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(name).Options, tenant.Object);
    }

    private static ParticipantsController Controller(OdipDbContext db) => new(
        db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));

    private static SaveParticipantIntakeDto Intake(string first = "Ava", string last = "Synthetic") => new()
    {
        FirstName = first, LastName = last, PreferredName = "Av", Phone = "0400000000",
        Email = "ava.synthetic@example.test", AddressStreet = "1 Test Street", AddressSuburb = "Brisbane",
        AddressState = "QLD", AddressPostcode = "4000", PrimaryDiagnosis = "Test diagnosis",
        MedicalSummary = "Synthetic medical summary", MobilityNotes = "Synthetic mobility note",
        BehaviourRiskSummary = "Synthetic risk note", Notes = "Synthetic intake note"
    };

    [Fact]
    public async Task SaveIntake_UpdatesOnlyTheIntakeSubset_AndPreservesProfileFields()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Inquiry", LastName = "Prefill",
            Phone = "0411111111", Email = "inquiry@example.test", IsDraft = true, IsActive = false,
            NdisNumber = "431234567", PlanType = Domain.Enums.PlanType.PlanManaged,
            FundingOrganisation = "Profile-only fund", PreferredUserId = Guid.NewGuid(), ServiceStreams = Domain.Enums.ServiceStreams.Trip
        };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        var result = await Controller(db).SaveIntake(participant.Id, Intake(), CancellationToken.None);
        var body = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        var saved = await db.Participants.SingleAsync();

        Assert.Equal("Ava", body.Data!.FirstName);
        Assert.Equal("Ava", saved.FirstName);
        Assert.Equal("431234567", saved.NdisNumber);
        Assert.Equal(Domain.Enums.PlanType.PlanManaged, saved.PlanType);
        Assert.Equal("Profile-only fund", saved.FundingOrganisation);
        Assert.Equal(participant.PreferredUserId, saved.PreferredUserId);
        Assert.Equal(Domain.Enums.ServiceStreams.Trip, saved.ServiceStreams);
    }

    [Fact]
    public async Task SaveIntake_OnInquiryPrefilledDraft_PreservesDraftAndActivationState()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Inquiry", LastName = "Prefill", Phone = "0499999999", Email = "inquiry@example.test", IsDraft = true, IsActive = false };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();

        await Controller(db).SaveIntake(participant.Id, Intake("Inquiry", "Prefill"), CancellationToken.None);
        var saved = await db.Participants.SingleAsync();

        // The converted inquiry's existing draft is the intake record; save changes only fields
        // explicitly present in the small intake payload, without a replacement participant.
        Assert.Equal("0400000000", saved.Phone);
        Assert.Equal("ava.synthetic@example.test", saved.Email);
        Assert.True(saved.IsDraft);
        Assert.False(saved.IsActive);
        Assert.Null(saved.IntakeCompletedAt);
    }

    [Fact]
    public async Task SaveIntake_ExplicitNullClearsNdis_WhileOmissionPreservesIt_AndIdentityCorrectionInvalidatesProfileAttestation()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(Guid.NewGuid().ToString(), tenantId);
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ava", LastName = "Synthetic", NdisNumber = "431234567", IsDraft = true };
        var onboarding = new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ProfileCompletedBy = "tester" };
        db.AddRange(participant, onboarding);
        await db.SaveChangesAsync();

        await Controller(db).SaveIntake(participant.Id, Intake(), CancellationToken.None);
        Assert.Equal("431234567", participant.NdisNumber);
        Assert.True(onboarding.ProfileComplete);

        await Controller(db).SaveIntake(participant.Id, Intake() with { NdisNumber = null, FirstName = "Corrected" }, CancellationToken.None);
        Assert.Null(participant.NdisNumber);
        Assert.False(onboarding.ProfileComplete);
        Assert.Null(onboarding.ProfileCompletedAt);
    }

    [Fact]
    public async Task SaveIntake_ForeignTenantParticipant_ReturnsNotFoundAndDoesNotModifyRow()
    {
        var ownerTenant = Guid.NewGuid();
        var callerTenant = Guid.NewGuid();
        var databaseName = Guid.NewGuid().ToString();
        Guid participantId;
        using (var ownerDb = CreateDb(databaseName, ownerTenant))
        {
            var participant = new Participant { Id = Guid.NewGuid(), TenantId = ownerTenant, FirstName = "Owner", LastName = "Only", IsDraft = true };
            participantId = participant.Id;
            ownerDb.Participants.Add(participant);
            await ownerDb.SaveChangesAsync();
        }
        using var callerDb = CreateDb(databaseName, callerTenant);

        var result = await Controller(callerDb).SaveIntake(participantId, Intake(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        using var verifyOwnerDb = CreateDb(databaseName, ownerTenant);
        var owner = await verifyOwnerDb.Participants.SingleAsync();
        Assert.Equal("Owner", owner.FirstName);
    }
}
