using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Xunit;

namespace Odip.Tests.Readiness;

/// <summary>
/// "Funding recorded", the one readiness item of the budget feature: an NDIS-funded participant is ready when a plan budget is recorded that has not ended (provider
/// time). It belongs to ACTIVATION readiness only, which is the checklist the status endpoint's activation warnings, the Complete Profile path and the onboarding checklist
/// show, and the strict gate behind them in Enforce mode. It must never reach the roster: not the shifts' and rows' readiness issues, not the pickers, not the placement
/// checks, or every shift of every participant without a budget (the whole demo tenant) would carry it.
/// </summary>
public class FundingReadinessTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid TenantB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");
    private static readonly DateOnly Today = new(2026, 10, 4);

    /// <summary>12:00 UTC on 4 Oct 2026: 22:00 in Sydney, so the UTC date and the provider's date are both the 4th.</summary>
    private static FakeClock NoonUtc => FakeClock.AtUtc(2026, 10, 4, 12, 0);

    private static OdipDbContext CreateDb(string? name = null, Guid? tenantId = null, bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name ?? Guid.NewGuid().ToString()).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static void SetProvider(OdipDbContext db, ParticipantReadinessMode mode = ParticipantReadinessMode.Warn, Guid? tenantId = null, string state = "NSW")
    {
        db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, ParticipantReadinessMode = mode, State = state });
        db.SaveChanges();
    }

    private static Participant SeedParticipant(OdipDbContext db, Guid? tenantId = null, ParticipantFundingSource funding = ParticipantFundingSource.Ndis, bool active = true,
        bool draft = false, bool intakeDone = true, string first = "Amy", string last = "Ng")
    {
        var participant = new Participant
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, FirstName = first, LastName = last, FundingSource = funding,
            IsActive = active, IsDraft = draft, IntakeCompletedAt = intakeDone ? DateTime.UtcNow.AddMonths(-3) : null,
        };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static FundingPlan SeedPlan(OdipDbContext db, Participant participant, DateOnly end, Guid? tenantId = null)
    {
        var plan = new FundingPlan
        {
            Id = Guid.NewGuid(), TenantId = tenantId ?? participant.TenantId, ParticipantId = participant.Id, PlanStart = end.AddDays(-364), PlanEnd = end,
            Evidence = BudgetEvidenceSource.PlanCopy, Revision = 1, CreatedBy = "test", UpdatedBy = "test", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        db.FundingPlans.Add(plan);
        db.SaveChanges();
        return plan;
    }

    // ── The predicate ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(365, true)]    // runs another year
    [InlineData(1, true)]
    [InlineData(0, true)]      // its last day is today: still a current plan
    [InlineData(-1, false)]    // ended yesterday
    [InlineData(-400, false)]
    public async Task AnNdisParticipant_HasFundingRecorded_OnlyWithAPlanThatHasNotEnded(int endOffsetDays, bool recorded)
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        SeedPlan(db, participant, Today.AddDays(endOffsetDays));

        Assert.Equal(recorded, await ParticipantReadinessGate.HasFundingRecordedAsync(db, participant.Id, Today, default));
        Assert.Equal(recorded, await ParticipantReadinessGate.FundingRecordedParticipants(db, Today).AnyAsync(p => p.Id == participant.Id));
        Assert.Equal(!recorded, await ParticipantReadinessGate.FundingMissingParticipants(db, Today).AnyAsync(p => p.Id == participant.Id));
    }

    [Fact]
    public async Task AnNdisParticipantWithNoPlanAtAll_HasNoFundingRecorded()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);

        Assert.False(await ParticipantReadinessGate.HasFundingRecordedAsync(db, participant.Id, Today, default));
        Assert.True(await ParticipantReadinessGate.FundingMissingParticipants(db, Today).AnyAsync(p => p.Id == participant.Id));
    }

    [Fact]
    public async Task AParticipantWhoseFundingIsNotTheNdis_NeverNeedsAPlanBudget()
    {
        using var db = CreateDb();
        var other = SeedParticipant(db, funding: ParticipantFundingSource.Other);

        Assert.True(await ParticipantReadinessGate.HasFundingRecordedAsync(db, other.Id, Today, default));
        Assert.False(await ParticipantReadinessGate.FundingMissingParticipants(db, Today).AnyAsync(p => p.Id == other.Id));
    }

    [Fact]
    public async Task APlanOfAnotherParticipant_OrOfAnotherOrganisation_DoesNotCount()
    {
        using var db = CreateDb();
        var mine = SeedParticipant(db, first: "Mine");
        var someoneElse = SeedParticipant(db, first: "Other");
        SeedPlan(db, someoneElse, Today.AddDays(100));
        SeedPlan(db, mine, Today.AddDays(100), tenantId: TenantB);   // a row naming another organisation is not this participant's record

        Assert.False(await ParticipantReadinessGate.HasFundingRecordedAsync(db, mine.Id, Today, default));
        Assert.True(await ParticipantReadinessGate.HasFundingRecordedAsync(db, someoneElse.Id, Today, default));
    }

    // ── The activation checklist ────────────────────────────────────────────

    [Fact]
    public async Task ActivationIssues_ListFundingNotRecorded_AfterTheOperationalIssues_AndTheOperationalIssuesNeverDo()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db, intakeDone: false);

        var operational = (await ParticipantReadiness.IssuesAsync(db, new[] { participant.Id }, default))[participant.Id];
        var activation = (await ParticipantReadiness.ActivationIssuesAsync(db, new[] { participant.Id }, NoonUtc, default))[participant.Id];

        Assert.Equal(new[] { "Intake not complete", "No signed service agreement" }, operational);
        Assert.Equal(new[] { "Intake not complete", "No signed service agreement", "Funding not recorded" }, activation);
        Assert.Equal("Funding not recorded", ParticipantReadiness.FundingNotRecorded);
    }

    [Fact]
    public async Task ActivationIssues_DropFunding_OnceACurrentPlanIsRecorded_AndForAParticipantWhoseFundingIsNotTheNdis()
    {
        using var db = CreateDb();
        SetProvider(db);
        var funded = SeedParticipant(db, first: "Funded");
        SeedPlan(db, funded, Today.AddDays(200));
        var expired = SeedParticipant(db, first: "Expired");
        SeedPlan(db, expired, Today.AddDays(-10));
        var other = SeedParticipant(db, funding: ParticipantFundingSource.Other, first: "Other");

        var issues = await ParticipantReadiness.ActivationIssuesAsync(db, new[] { funded.Id, expired.Id, other.Id }, NoonUtc, default);

        Assert.DoesNotContain(ParticipantReadiness.FundingNotRecorded, issues[funded.Id]);
        Assert.Contains(ParticipantReadiness.FundingNotRecorded, issues[expired.Id]);
        Assert.DoesNotContain(ParticipantReadiness.FundingNotRecorded, issues[other.Id]);
    }

    [Fact]
    public async Task TheProvidersCalendarDate_NotTheUtcDate_DecidesWhetherAPlanHasEnded()
    {
        using var db = CreateDb();
        SetProvider(db, state: "NSW");
        var participant = SeedParticipant(db);
        SeedPlan(db, participant, new DateOnly(2026, 10, 3));   // the plan's last day is Saturday 3 Oct

        // 15:30 UTC on 3 Oct is 01:30 on 4 Oct in Sydney (daylight saving starts at 02:00): the plan has ended for the provider although the UTC date is still the 3rd.
        var afterMidnightInSydney = await ParticipantReadiness.ActivationIssuesAsync(db, new[] { participant.Id }, FakeClock.AtUtc(2026, 10, 3, 15, 30), default);
        var stillTheLastDay = await ParticipantReadiness.ActivationIssuesAsync(db, new[] { participant.Id }, FakeClock.AtUtc(2026, 10, 3, 12, 0), default);

        Assert.Contains(ParticipantReadiness.FundingNotRecorded, afterMidnightInSydney[participant.Id]);
        Assert.DoesNotContain(ParticipantReadiness.FundingNotRecorded, stillTheLastDay[participant.Id]);
    }

    // ── Activation: Warn lists it, Enforce refuses with it ──────────────────

    [Theory]
    [InlineData(false, false, false, ActivationBlock.None)]
    [InlineData(false, true, true, ActivationBlock.None)]
    [InlineData(true, false, false, ActivationBlock.EvidenceRequired)]
    [InlineData(true, false, true, ActivationBlock.EvidenceRequired)]    // the evidence message comes first
    [InlineData(true, true, false, ActivationBlock.FundingNotRecorded)]  // Enforce waits for the plan budget even when the evidence is there
    [InlineData(true, true, true, ActivationBlock.None)]
    public void Decide_IsWarnNeverBlocking_AndEnforceNeedsTheEvidenceAndThePlanBudget(bool enforced, bool evidence, bool fundingRecorded, ActivationBlock expected)
    {
        Assert.Equal(expected, ParticipantReadiness.Decide(enforced, evidence, fundingRecorded));
    }

    [Fact]
    public async Task Enforce_WhileTheAgreementSourceIsUnapproved_StillRefusesEveryActivation_WithTheEvidenceBlock()
    {
        using var db = CreateDb();
        SetProvider(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db, active: false);
        SeedPlan(db, participant, Today.AddDays(100));

        Assert.Equal(ActivationBlock.EvidenceRequired, await ParticipantReadiness.ActivationBlockAsync(db, participant, NoonUtc, default));
        Assert.False(await ParticipantReadiness.MayActivateAsync(db, participant, NoonUtc, default));
    }

    [Fact]
    public async Task Warn_NeverBlocksAnActivation_WhateverTheFunding()
    {
        using var db = CreateDb();
        SetProvider(db, ParticipantReadinessMode.Warn);
        var participant = SeedParticipant(db, active: false);

        Assert.Equal(ActivationBlock.None, await ParticipantReadiness.ActivationBlockAsync(db, participant, NoonUtc, default));
        Assert.True(await ParticipantReadiness.MayActivateAsync(db, participant, NoonUtc, default));
    }

    [Theory]
    [InlineData("none", false)]
    [InlineData("current-plan", true)]
    [InlineData("ended-plan", false)]
    [InlineData("other-funding", true)]
    public async Task TheRosterGate_NeedsOnlyTheEvidence_WhileTheFundingClauseIsAnActivationRequirementOfItsOwn(string scenario, bool expectFundingRecorded)
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db, funding: scenario == "other-funding" ? ParticipantFundingSource.Other : ParticipantFundingSource.Ndis);
        db.ParticipantOnboardings.Add(new ParticipantOnboarding
        {
            Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participant.Id,
            ProfileComplete = true, ProfileCompletedAt = DateTime.UtcNow, ServiceTypeConfirmed = true, ServiceTypeConfirmedAt = DateTime.UtcNow,
        });
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participant.Id, Version = 1, State = "Approved", ParticipantNameSnapshot = participant.FullName,
            PlanStartDate = new(2026, 1, 1), PlanEndDate = new(2026, 12, 31), AgreementStartDate = new(2026, 1, 1), AgreementEndDate = new(2026, 12, 31),
        };
        var snapshot = new ElectronicSigningSnapshot { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participant.Id, DraftId = draft.Id, DraftVersion = 1, DocumentJson = "{}", DocumentHash = new string('a', 64) };
        db.AddRange(draft, snapshot, new ElectronicSigningEvidence
        {
            Id = Guid.NewGuid(), TenantId = TenantA, SnapshotId = snapshot.Id, IdempotencyKey = Guid.NewGuid().ToString(), SignerName = "Fixture", SignerCapacity = "Representative",
            IsAuthorisedRepresentative = true, ConsentToElectronicMethod = true, IntendsToSign = true, DocumentWasDisplayed = true,
            EvidenceHash = new string('b', 64), PreviousEvidenceHash = "GENESIS", Status = "Verified",
        });
        db.SaveChanges();
        if (scenario == "current-plan") SeedPlan(db, participant, Today.AddDays(100));
        if (scenario == "ended-plan") SeedPlan(db, participant, Today.AddDays(-1));

        var funding = await ParticipantReadinessGate.HasFundingRecordedAsync(db, participant.Id, Today, default);
        var evidence = await ParticipantReadinessGate.ActivationEvidenceParticipantsForApprovedSourceForTesting(db).AnyAsync(p => p.Id == participant.Id);

        Assert.Equal(expectFundingRecorded, funding);
        Assert.True(evidence);   // the evidence is all the roster's strict gate ever asks for, whatever the funding says
        // Enforce at activation: both. (The pure rule, case by case, is in Decide_IsWarnNeverBlocking_AndEnforceNeedsTheEvidenceAndThePlanBudget.)
        Assert.Equal(expectFundingRecorded ? ActivationBlock.None : ActivationBlock.FundingNotRecorded, ParticipantReadiness.Decide(enforced: true, evidencePresent: evidence, fundingRecorded: funding));
    }

    // ── The endpoints ───────────────────────────────────────────────────────

    private static ParticipantsController Participants(OdipDbContext db, TimeProvider clock) =>
        new(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db), clock: clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Coordinator")], "Test")),
                },
            },
        };

    [Fact]
    public async Task ActivatingAParticipant_InWarnMode_Succeeds_AndListsThePlanBudgetAsStillMissing()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db, active: false);

        var result = await Participants(db, NoonUtc).ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, default);

        var status = Assert.IsType<ApiResponse<ParticipantStatusResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.True(status.IsActive);
        Assert.Contains("Not yet fully ready: Funding not recorded.", status.Warnings);
        Assert.Contains(status.Warnings, w => w.Contains(ParticipantReadiness.NoSignedServiceAgreement, StringComparison.Ordinal));
    }

    [Fact]
    public async Task ActivatingAParticipant_WithACurrentPlanBudget_ListsNoFundingNote()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db, active: false);
        SeedPlan(db, participant, Today.AddDays(120));

        var result = await Participants(db, NoonUtc).ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, default);

        var status = Assert.IsType<ApiResponse<ParticipantStatusResultDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.DoesNotContain(status.Warnings, w => w.Contains("Funding", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ActivatingAParticipant_InEnforceMode_IsRefused_WhileTheAgreementSourceIsUnapproved()
    {
        using var db = CreateDb();
        SetProvider(db, ParticipantReadinessMode.Enforce);
        var participant = SeedParticipant(db, active: false);

        var result = await Participants(db, NoonUtc).ChangeStatus(participant.Id, new ChangeParticipantStatusDto { IsActive = true }, default);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains("signed service agreement evidence", Assert.Single(Assert.IsType<ApiResponse<ParticipantStatusResultDto>>(bad.Value).Errors!), StringComparison.Ordinal);
        Assert.False((await db.Participants.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task CompletingTheProfile_InWarnMode_ActivatesAnNdisParticipantWithNoPlanBudget()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db, active: false, draft: true);

        var result = await Participants(db, NoonUtc).CompleteProfile(participant.Id, default);

        var detail = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.True(detail.IsActive);
        Assert.False(detail.IsDraft);
    }

    // ── The roster and the pickers never carry it ───────────────────────────

    private static readonly DateOnly ServiceDate = new(2026, 10, 5);

    private static (User Staff, Shift Shift) SeedShift(OdipDbContext db, Participant participant)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, FirstName = "Ben", LastName = "Turner", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id, ServiceDate = ServiceDate, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft,
        };
        db.AddRange(staff, shift);
        db.SaveChanges();
        return (staff, shift);
    }

    private static RosteringController Rostering(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    [Fact]
    public async Task TheRosterBoard_NeverCarriesTheFundingIssue_NotOnARowNorOnAShift_InEitherGrouping()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db);   // NDIS-funded, no plan budget: exactly the participant the activation checklist lists
        var (staff, _) = SeedShift(db, participant);

        var byParticipant = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>((await Rostering(db).GetBoard(ServiceDate, "participant", default)).Result).Value).Data!;
        var byStaff = Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>((await Rostering(db).GetBoard(ServiceDate, "staff", default)).Result).Value).Data!;

        var row = byParticipant.ParticipantRows!.Single();
        Assert.Equal(new[] { ParticipantReadiness.NoSignedServiceAgreement }, row.ReadinessIssues);
        Assert.Equal(new[] { ParticipantReadiness.NoSignedServiceAgreement }, row.Shifts.Single().ReadinessIssues);
        Assert.Equal(new[] { ParticipantReadiness.NoSignedServiceAgreement }, byStaff.StaffRows!.Single(r => r.StaffId == staff.Id).Shifts.Single().ReadinessIssues);
    }

    [Fact]
    public async Task ACreatedShift_DoesNotCarryTheFundingIssue_AndIsNotRefusedForIt()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db);
        var staff = SeedShift(db, participant).Staff;
        var dto = new CreateShiftDto
        {
            ParticipantId = participant.Id, StaffId = staff.Id, ServiceDate = ServiceDate.AddDays(1), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None,
        };

        var result = await Rostering(db).CreateShift(dto, default);

        var shift = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.DoesNotContain(ParticipantReadiness.FundingNotRecorded, shift.ReadinessIssues ?? new List<string>());
    }

    [Fact]
    public async Task ThePlacementCheck_ForRosteringAndBooking_IsUnaffected_InWarnMode()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db);

        var check = await ParticipantReadiness.CheckAsync(db, participant.Id, default);

        Assert.True(check.Allowed);
        Assert.DoesNotContain(ParticipantReadiness.FundingNotRecorded, check.Issues);
    }

    [Fact]
    public async Task TheParticipantRecordAndList_CarryTheOperationalIssuesOnly()
    {
        using var db = CreateDb();
        SetProvider(db);
        var participant = SeedParticipant(db);
        var controller = Participants(db, NoonUtc);

        var detail = Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>((await controller.GetById(participant.Id, default)).Result).Value).Data!;
        var list = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetAll(null, null, null, null, null, null, 1, 50, default)).Result).Value).Data!;

        Assert.Equal(new[] { ParticipantReadiness.NoSignedServiceAgreement }, detail.ReadinessIssues);
        Assert.Equal(new[] { ParticipantReadiness.NoSignedServiceAgreement }, list.Items.Single().ReadinessIssues);
    }

    // ── The onboarding checklist ────────────────────────────────────────────

    private static ParticipantInquiriesController Inquiries(OdipDbContext db, TimeProvider clock, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new ParticipantInquiriesController(db, tenant.Object, clock)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")) },
            },
        };
    }

    private static Participant SeedOnboarding(OdipDbContext db, ParticipantFundingSource funding = ParticipantFundingSource.Ndis)
    {
        var participant = SeedParticipant(db, funding: funding, active: false, draft: true);
        db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = participant.Id });
        db.SaveChanges();
        return participant;
    }

    private static ParticipantOnboardingDto Detail(ActionResult<ApiResponse<ParticipantOnboardingDto>> result) =>
        Assert.IsType<ApiResponse<ParticipantOnboardingDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Fact]
    public async Task TheOnboardingChecklist_ListsFundingAsMissing_ForAnNdisParticipantWithNoPlanBudget_AndNotOnceItIsRecorded()
    {
        using var db = CreateDb(tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var participant = SeedOnboarding(db);
        var inquiries = Inquiries(db, NoonUtc, TenantA);

        var missing = Detail(await inquiries.GetOnboarding(participant.Id, default));
        Assert.False(missing.FundingRecorded);
        Assert.Contains(missing.Reasons, r => r.Contains("plan budget", StringComparison.OrdinalIgnoreCase) && r.Contains("Funding tab", StringComparison.Ordinal));

        SeedPlan(db, participant, Today.AddDays(120));
        var recorded = Detail(await inquiries.GetOnboarding(participant.Id, default));
        Assert.True(recorded.FundingRecorded);
        Assert.DoesNotContain(recorded.Reasons, r => r.Contains("plan budget", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task TheOnboardingChecklist_HasNoFundingStep_ForAParticipantWhoseFundingIsNotTheNdis()
    {
        using var db = CreateDb(tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var participant = SeedOnboarding(db, ParticipantFundingSource.Other);

        var detail = Detail(await Inquiries(db, NoonUtc, TenantA).GetOnboarding(participant.Id, default));

        Assert.Null(detail.FundingRecorded);
        Assert.DoesNotContain(detail.Reasons, r => r.Contains("plan budget", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task TheOnboardingWorklist_CountsTheFundingStep_OnlyForAnNdisParticipant()
    {
        using var db = CreateDb(tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var ndis = SeedOnboarding(db);
        var other = SeedOnboarding(db, ParticipantFundingSource.Other);
        var recorded = SeedOnboarding(db);
        SeedPlan(db, recorded, Today.AddDays(90));

        var result = await Inquiries(db, NoonUtc, TenantA).GetOnboardingWorklist(default);

        var rows = Assert.IsType<ApiResponse<List<ParticipantOnboardingWorklistDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(6, rows.Single(r => r.ParticipantId == ndis.Id).TotalSteps);
        Assert.Equal(5, rows.Single(r => r.ParticipantId == other.Id).TotalSteps);
        Assert.Equal(6, rows.Single(r => r.ParticipantId == recorded.Id).TotalSteps);
        Assert.Equal(rows.Single(r => r.ParticipantId == ndis.Id).CompletedSteps + 1, rows.Single(r => r.ParticipantId == recorded.Id).CompletedSteps);
    }

    // ── The schedule review is a step too, and the worklist counts it the way the checklist page does ──

    [Fact]
    public async Task TheOnboardingWorklist_CountsAnApprovedScheduleAsADoneStep_SoItSaysWhatTheChecklistPageSays()
    {
        using var db = CreateDb(tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var waiting = SeedOnboarding(db);
        var approved = SeedOnboarding(db);
        db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
        {
            Id = Guid.NewGuid(), TenantId = TenantA, DraftId = Guid.NewGuid(), ParticipantId = approved.Id, DraftVersion = 2, ApprovedAt = new DateTime(2026, 10, 3, 3, 0, 0, DateTimeKind.Utc), ApprovedByName = "Alex",
        });
        db.SaveChanges();
        var inquiries = Inquiries(db, NoonUtc, TenantA);

        var rows = Assert.IsType<ApiResponse<List<ParticipantOnboardingWorklistDto>>>(Assert.IsType<OkObjectResult>((await inquiries.GetOnboardingWorklist(default)).Result).Value).Data!;

        var waitingRow = rows.Single(r => r.ParticipantId == waiting.Id);
        var approvedRow = rows.Single(r => r.ParticipantId == approved.Id);
        Assert.Equal((6, 6), (waitingRow.TotalSteps, approvedRow.TotalSteps));                                // intake, profile, service needs, agreement evidence, funding, schedule review
        Assert.Equal(waitingRow.CompletedSteps + 1, approvedRow.CompletedSteps);                              // the approved revision is the one more step done
        Assert.Equal(2, Detail(await inquiries.GetOnboarding(approved.Id, default)).ScheduleApprovedVersion); // which the checklist page shows as its Schedule review gate being Complete
    }

    // ── An ended plan is not "not recorded" ─────────────────────────────────

    [Fact]
    public async Task TheOnboardingChecklist_SaysThePlanBudgetHasEnded_WhenTheOnlyPlansHave_AndNotRecordedWhenThereIsNone()
    {
        using var db = CreateDb(tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var none = SeedOnboarding(db);
        var ended = SeedOnboarding(db);
        SeedPlan(db, ended, Today.AddDays(-30));
        var inquiries = Inquiries(db, NoonUtc, TenantA);

        var withNone = Detail(await inquiries.GetOnboarding(none.Id, default));
        var withEnded = Detail(await inquiries.GetOnboarding(ended.Id, default));

        Assert.False(withNone.FundingRecorded);
        Assert.Contains("Funding is not recorded: add the plan budget on the participant's Funding tab.", withNone.Reasons);
        Assert.False(withEnded.FundingRecorded);   // an ended plan is still not a recorded budget for readiness
        Assert.Contains("The plan budget has ended: record the new plan on the participant's Funding tab.", withEnded.Reasons);
        Assert.DoesNotContain(withEnded.Reasons, r => r.Contains("not recorded", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task AnotherOrganisationsEndedPlan_DoesNotTurnNotRecordedIntoEnded()
    {
        var database = Guid.NewGuid().ToString();
        using var db = CreateDb(database, tenantId: TenantA, superAdmin: false);
        SetProvider(db);
        var mine = SeedOnboarding(db);
        using (var other = CreateDb(database))   // a SuperAdmin context writes a plan of the other organisation for the same participant id
            SeedPlan(other, mine, Today.AddDays(-30), tenantId: TenantB);

        var detail = Detail(await Inquiries(db, NoonUtc, TenantA).GetOnboarding(mine.Id, default));

        Assert.Contains("Funding is not recorded: add the plan budget on the participant's Funding tab.", detail.Reasons);
    }

    // ── The next action counts the funding gate ─────────────────────────────

    private static ParticipantOnboardingDto Gates(bool intake = true, bool profile = true, bool service = true, bool agreement = true, bool? funding = null, int? scheduleApprovedVersion = null) => new()
    {
        IntakeComplete = intake, ProfileComplete = profile, ServiceTypeConfirmed = service, ServiceAgreementSigned = agreement, FundingRecorded = funding, ScheduleApprovedVersion = scheduleApprovedVersion,
    };

    [Theory]
    [InlineData(false, true, true, true, null, "Complete intake")]
    [InlineData(true, false, true, true, false, "Validate profile essentials")]
    [InlineData(true, true, false, true, false, "Confirm service needs")]
    [InlineData(true, true, true, false, false, "Review agreement evidence")]    // the agreement evidence still comes first
    [InlineData(true, true, true, true, false, "Record plan budget")]            // an NDIS-funded participant whose only other open gate is the budget is told so
    [InlineData(true, true, true, true, true, "Approve the agreement for rostering")]      // nothing else open: the last step is the schedule review, named as the checklist page names it
    [InlineData(true, true, true, true, null, "Approve the agreement for rostering")]      // not NDIS-funded: no funding gate to name
    public void TheWorklistsNextAction_IsTheFirstOpenGate_InTheOrderTheChecklistListsThem(bool intake, bool profile, bool service, bool agreement, bool? funding, string expected)
    {
        Assert.Equal(expected, ParticipantInquiriesController.NextActionOf(Gates(intake, profile, service, agreement, funding)));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(null)]
    public void OnceARevisionHasBeenApprovedForRostering_TheWorklistsLastWordIsToCheckTheRoster_AndAnOpenGateBeforeItStillComesFirst(bool? funding)
    {
        Assert.Equal("Check the roster", ParticipantInquiriesController.NextActionOf(Gates(funding: funding, scheduleApprovedVersion: 2)));
        Assert.Equal("Review agreement evidence", ParticipantInquiriesController.NextActionOf(Gates(agreement: false, funding: funding, scheduleApprovedVersion: 2)));
    }
}
