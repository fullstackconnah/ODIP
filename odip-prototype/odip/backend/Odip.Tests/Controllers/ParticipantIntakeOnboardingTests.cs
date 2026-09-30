using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Completing Intake (CompleteIntake=true on a participant create or update) puts the participant
/// on the onboarding worklist: it guarantees exactly one tenant-scoped <see cref="ParticipantOnboarding"/>
/// row, created in the same save as the completion stamp and its immutable snapshot. A participant
/// created through the Intake wizard used to have no such row (only an inquiry conversion created
/// one), so it never showed in the Onboarding table. Draft saves must not create one.
/// Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as ParticipantIntakeControllerTests.
/// </summary>
public class ParticipantIntakeOnboardingTests
{
    /// <summary>One authenticated caller: a tenant-scoped (or SuperAdmin) context over a named InMemory store.</summary>
    private sealed class Caller : IDisposable
    {
        public OdipDbContext Db { get; }
        public ICurrentTenant Tenant { get; }

        public Caller(string store, Guid? tenantId, bool superAdmin = false)
        {
            var tenant = new Mock<ICurrentTenant>();
            tenant.SetupGet(x => x.TenantId).Returns(tenantId);
            tenant.SetupGet(x => x.IsSuperAdmin).Returns(superAdmin);
            Tenant = tenant.Object;
            Db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(store).Options, Tenant);
        }

        public ParticipantsController Participants =>
            new(Db, new StaffCompatibilityLinkService(Db), new ParticipantDocumentService(Db), new SafetyNoteSyncService(Db));

        public ParticipantInquiriesController Inquiries => new(Db, Tenant);

        public void Dispose() => Db.Dispose();
    }

    private static CreateParticipantDto CreateDto(string first = "Ada", string last = "Lovelace") => new()
    {
        FirstName = first, LastName = last, PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
    };

    private static UpdateParticipantDto UpdateDto(string first = "Ada", string last = "Lovelace") => new()
    {
        FirstName = first, LastName = last, PlanType = PlanType.SelfManaged,
        OvernightSupport = OvernightSupportType.None, OvernightRatio = SupportRatio.OneToOne, SupportRatio = SupportRatio.OneToOne,
        IsDraft = true,
    };

    private static async Task<Guid> SeedDraftAsync(OdipDbContext db, Guid tenantId, string first = "Grace", string last = "Hopper")
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = last, IsActive = false, IsDraft = true };
        db.Participants.Add(participant);
        await db.SaveChangesAsync();
        return participant.Id;
    }

    private static async Task<Guid> CreatedIdAsync(Task<ActionResult<ApiResponse<ParticipantDetailDto>>> create)
    {
        var created = Assert.IsType<CreatedAtActionResult>((await create).Result);
        return Assert.IsType<ApiResponse<ParticipantDetailDto>>(created.Value).Data!.Id;
    }

    private static async Task<List<ParticipantOnboardingWorklistDto>> WorklistAsync(Caller caller)
    {
        var result = await caller.Inquiries.GetOnboardingWorklist(CancellationToken.None);
        return Assert.IsType<ApiResponse<List<ParticipantOnboardingWorklistDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    // ── Create ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_CompleteIntake_CreatesExactlyOneOnboardingRow_InTheCallersTenant()
    {
        var tenantId = Guid.NewGuid();
        using var caller = new Caller(Guid.NewGuid().ToString(), tenantId);

        var id = await CreatedIdAsync(caller.Participants.Create(CreateDto() with { IsDraft = true, CompleteIntake = true, CompletionRequestId = "create-1" }, CancellationToken.None));

        var onboarding = Assert.Single(caller.Db.ParticipantOnboardings);
        Assert.Equal(id, onboarding.ParticipantId);
        Assert.Equal(tenantId, onboarding.TenantId);
        Assert.False(onboarding.ProfileComplete);
        Assert.False(onboarding.ServiceTypeConfirmed);
        Assert.False(onboarding.ServiceAgreementSigned);
        Assert.Equal(tenantId, (await caller.Db.Participants.SingleAsync()).TenantId);
        // The immutable evidence saved in the same call belongs to the same tenant, so the tenant's own
        // snapshot list/download (which the tenant query filter scopes) can see it.
        Assert.Equal(tenantId, Assert.Single(caller.Db.ParticipantIntakeSnapshots).TenantId);
    }

    [Fact]
    public async Task Create_CompleteIntake_PutsTheParticipantOnTheWorklist_AsOnboardingIncomplete()
    {
        using var caller = new Caller(Guid.NewGuid().ToString(), Guid.NewGuid());

        var id = await CreatedIdAsync(caller.Participants.Create(CreateDto("Ada", "Lovelace") with { IsDraft = true, CompleteIntake = true }, CancellationToken.None));

        var row = Assert.Single(await WorklistAsync(caller));
        Assert.Equal(id, row.ParticipantId);
        Assert.Equal("Ada Lovelace", row.FullName);
        // Intake is done, so the stage is not "Intake incomplete"; the next gate is profile validation.
        Assert.Equal("Onboarding incomplete", row.Stage);
        Assert.Equal("Validate profile essentials", row.NextAction);
        Assert.Equal(1, row.CompletedSteps);
    }

    [Fact]
    public async Task Create_DraftSave_CreatesNoOnboardingRow_AndIsNotOnTheWorklist()
    {
        using var caller = new Caller(Guid.NewGuid().ToString(), Guid.NewGuid());

        await CreatedIdAsync(caller.Participants.Create(CreateDto() with { IsDraft = true, CompleteIntake = false }, CancellationToken.None));

        Assert.Single(caller.Db.Participants);
        Assert.Empty(caller.Db.ParticipantOnboardings);
        Assert.Empty(await WorklistAsync(caller));
    }

    // ── Update (resuming an Intake draft) ────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_CompleteIntake_OnADraftWithoutOnboarding_CreatesExactlyOneRow()
    {
        var tenantId = Guid.NewGuid();
        using var caller = new Caller(Guid.NewGuid().ToString(), tenantId);
        var id = await SeedDraftAsync(caller.Db, tenantId);

        Assert.IsType<OkObjectResult>((await caller.Participants.Update(id, UpdateDto() with { CompleteIntake = true, CompletionRequestId = "resume-1" }, CancellationToken.None)).Result);

        var onboarding = Assert.Single(caller.Db.ParticipantOnboardings);
        Assert.Equal(id, onboarding.ParticipantId);
        Assert.Equal(tenantId, onboarding.TenantId);
        var row = Assert.Single(await WorklistAsync(caller));
        Assert.Equal(id, row.ParticipantId);
        Assert.Equal("Onboarding incomplete", row.Stage);
    }

    [Fact]
    public async Task Update_CompleteIntake_Repeated_NeverCreatesASecondRow()
    {
        var tenantId = Guid.NewGuid();
        using var caller = new Caller(Guid.NewGuid().ToString(), tenantId);
        var id = await SeedDraftAsync(caller.Db, tenantId);

        // The same completion request retried, then a deliberate later completion with a new key
        // (which legitimately adds a second immutable snapshot but still only one onboarding row).
        foreach (var requestId in new[] { "resume-1", "resume-1", "resume-2" })
        {
            Assert.IsType<OkObjectResult>((await caller.Participants.Update(id, UpdateDto() with { CompleteIntake = true, CompletionRequestId = requestId }, CancellationToken.None)).Result);
            Assert.Single(caller.Db.ParticipantOnboardings);
        }

        Assert.Equal(2, await caller.Db.ParticipantIntakeSnapshots.CountAsync());
        Assert.Single(await WorklistAsync(caller));
    }

    [Fact]
    public async Task Update_CompleteIntake_KeepsAnOnboardingRowThatInquiryConversionAlreadyCreated()
    {
        var tenantId = Guid.NewGuid();
        using var caller = new Caller(Guid.NewGuid().ToString(), tenantId);
        var id = await SeedDraftAsync(caller.Db, tenantId);
        var existing = new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = id };
        caller.Db.ParticipantOnboardings.Add(existing);
        await caller.Db.SaveChangesAsync();

        await caller.Participants.Update(id, UpdateDto() with { CompleteIntake = true }, CancellationToken.None);

        Assert.Equal(existing.Id, Assert.Single(caller.Db.ParticipantOnboardings).Id);
    }

    [Fact]
    public async Task Update_DraftSave_WithoutCompleteIntake_CreatesNoOnboardingRow()
    {
        var tenantId = Guid.NewGuid();
        using var caller = new Caller(Guid.NewGuid().ToString(), tenantId);
        var id = await SeedDraftAsync(caller.Db, tenantId);

        Assert.IsType<OkObjectResult>((await caller.Participants.Update(id, UpdateDto("Grace", "Corrected") with { CompleteIntake = false }, CancellationToken.None)).Result);

        Assert.Empty(caller.Db.ParticipantOnboardings);
        Assert.Empty(await WorklistAsync(caller));
        Assert.Equal("Corrected", (await caller.Db.Participants.SingleAsync()).LastName);
    }

    // ── Tenant isolation ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task CompletedIntake_IsOnlyOnTheCompletingTenantsWorklist()
    {
        var store = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        using var a = new Caller(store, tenantA);
        using var b = new Caller(store, tenantB);

        var id = await CreatedIdAsync(a.Participants.Create(CreateDto() with { IsDraft = true, CompleteIntake = true }, CancellationToken.None));
        // Tenant B completes its own intake too, so the other side of the boundary is non-empty.
        var idB = await CreatedIdAsync(b.Participants.Create(CreateDto("Bea", "Other") with { IsDraft = true, CompleteIntake = true }, CancellationToken.None));

        Assert.Equal(id, Assert.Single(await WorklistAsync(a)).ParticipantId);
        Assert.Equal(idB, Assert.Single(await WorklistAsync(b)).ParticipantId);
        Assert.Equal(tenantA, Assert.Single(a.Db.ParticipantOnboardings).TenantId);
        Assert.Equal(tenantB, Assert.Single(b.Db.ParticipantOnboardings).TenantId);
    }

    [Fact]
    public async Task Update_CompleteIntake_ForAnotherTenantsParticipant_IsNotFound_AndCreatesNoRow()
    {
        var store = Guid.NewGuid().ToString();
        var tenantA = Guid.NewGuid();
        var tenantB = Guid.NewGuid();
        using var a = new Caller(store, tenantA);
        using var b = new Caller(store, tenantB);
        var foreignId = await SeedDraftAsync(b.Db, tenantB);

        var result = await a.Participants.Update(foreignId, UpdateDto() with { CompleteIntake = true }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(await a.Db.ParticipantOnboardings.IgnoreQueryFilters().ToListAsync());
        Assert.Null((await b.Db.Participants.SingleAsync()).IntakeCompletedAt);
    }

    [Fact]
    public async Task Update_CompleteIntake_BySuperAdmin_StampsTheParticipantsOwnTenantOnTheRow()
    {
        var store = Guid.NewGuid().ToString();
        var participantTenant = Guid.NewGuid();
        using var superAdmin = new Caller(store, tenantId: null, superAdmin: true);
        var id = await SeedDraftAsync(superAdmin.Db, participantTenant);

        Assert.IsType<OkObjectResult>((await superAdmin.Participants.Update(id, UpdateDto() with { CompleteIntake = true }, CancellationToken.None)).Result);

        var onboarding = Assert.Single(await superAdmin.Db.ParticipantOnboardings.ToListAsync());
        Assert.Equal(participantTenant, onboarding.TenantId);
        Assert.NotEqual(Guid.Empty, onboarding.TenantId);
        Assert.Equal(id, onboarding.ParticipantId);
    }
}
