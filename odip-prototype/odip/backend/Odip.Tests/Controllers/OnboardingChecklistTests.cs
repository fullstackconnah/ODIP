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
using Odip.Infrastructure.Data;
using Xunit;
using Odip.Infrastructure.Services;

namespace Odip.Tests.Controllers;

/// <summary>
/// The onboarding checklist (owner decision 2026-10-13): exactly four items, all derived from data except the agreement record, which is the one
/// thing recorded by hand. Profile details (names, date of birth, the NDIS number for an NDIS-funded participant; NOT gender), service needs (a
/// valid newest agreement draft with priced lines), signed agreement (a signed date or a reason there is none), funding (NDIS-funded only).
/// </summary>
public class OnboardingChecklistTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    // 01:00 UTC on 13 October 2026 is 12:00 in Sydney: the provider's date is 2026-10-13.
    private static readonly FakeClock Clock = new(new DateTimeOffset(2026, 10, 13, 1, 0, 0, TimeSpan.Zero));

    private sealed class FakeClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static OdipDbContext Db()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
    }

    private static ParticipantInquiriesController Controller(OdipDbContext db, TimeProvider? clock = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(Tenant);
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "coordinator-1")], "Test")) };
        return new ParticipantInquiriesController(db, tenant.Object, clock ?? Clock) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private static Participant InOnboarding(OdipDbContext db, Action<Participant>? change = null)
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), TenantId = Tenant, FirstName = "Synthetic", LastName = "Person", DateOfBirth = new DateOnly(1990, 1, 2),
            FundingSource = ParticipantFundingSource.Ndis, NdisNumber = "431000012", Gender = null,
            IsActive = false, IsDraft = true, IntakeCompletedAt = DateTime.UtcNow.AddDays(-2),
        };
        change?.Invoke(p);
        db.Participants.Add(p);
        db.ParticipantOnboardings.Add(new ParticipantOnboarding { Id = Guid.NewGuid(), TenantId = p.TenantId, ParticipantId = p.Id });
        db.SaveChanges();
        return p;
    }

    private static void ValidDraft(OdipDbContext db, Participant p, int version = 1, bool priced = true) =>
        db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = p.Id, Version = version,
            PlanStartDate = new DateOnly(2026, 7, 1), PlanEndDate = new DateOnly(2027, 6, 30),
            AgreementStartDate = new DateOnly(2026, 10, 1), AgreementEndDate = new DateOnly(2027, 3, 31),
            Lines = { new ServiceAgreementDraftLine { Id = Guid.NewGuid(), ServiceType = "Community access", Hours = 10, ItemCode = "04_104_0125_6_1", CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1), UnitPrice = priced ? 70m : 0m } },
        });

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static async Task<ParticipantOnboardingDto> Checklist(OdipDbContext db, Participant p) =>
        Ok(await Controller(db).GetOnboarding(p.Id, CancellationToken.None));

    [Fact]
    public async Task AnNdisParticipant_HasSixItems_InOrder_AndGenderIsNotAskedFor()
    {
        using var db = Db();
        var p = InOnboarding(db);

        var d = await Checklist(db, p);

        Assert.Equal(["profile", "serviceNeeds", "agreement", "complaints", "rights", "funding"], d.Items.Select(i => i.Key));
        Assert.Equal(["Profile details", "Service needs", "Signed agreement", "Told how to make a complaint", "Rights explained", "Funding"], d.Items.Select(i => i.Label));
        Assert.Equal([true, false, false, false, false, false], d.Items.Select(i => i.Done));
        Assert.Null(d.Items[0].Missing);
        Assert.All(d.Items.Skip(1), i => Assert.False(string.IsNullOrWhiteSpace(i.Missing)));
        Assert.False(d.IsReady);
    }

    [Fact]
    public async Task AParticipantFundedAnotherWay_HasFiveItems_AndNeedsNoNdisNumber()
    {
        using var db = Db();
        var p = InOnboarding(db, x => { x.FundingSource = ParticipantFundingSource.Other; x.NdisNumber = null; });

        var d = await Checklist(db, p);

        Assert.Equal(["profile", "serviceNeeds", "agreement", "complaints", "rights"], d.Items.Select(i => i.Key));
        Assert.True(d.Items[0].Done);
    }

    [Fact]
    public async Task ProfileDetails_SaysWhatIsMissing_InOneLine()
    {
        using var db = Db();
        var p = InOnboarding(db, x => { x.DateOfBirth = null; x.NdisNumber = " "; });

        var profile = (await Checklist(db, p)).Items[0];

        Assert.False(profile.Done);
        Assert.Equal("Missing: date of birth, NDIS number.", profile.Missing);
    }

    [Fact]
    public async Task ServiceNeeds_FollowTheNewestDraft_ADraftWithAnUnpricedLineIsNotEnough()
    {
        using var db = Db();
        var p = InOnboarding(db);
        ValidDraft(db, p, version: 1);
        db.SaveChanges();
        Assert.True((await Checklist(db, p)).Items[1].Done);

        ValidDraft(db, p, version: 2, priced: false);
        db.SaveChanges();

        Assert.False((await Checklist(db, p)).Items[1].Done);
    }

    [Fact]
    public async Task EverythingDone_IsReady()
    {
        using var db = Db();
        var p = InOnboarding(db);
        ValidDraft(db, p);
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = p.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.SaveChanges();
        Ok(await Controller(db).RecordAgreement(p.Id, new RecordOnboardingAgreementDto { SignedOn = new DateOnly(2026, 10, 2) }, CancellationToken.None));
        Ok(await Controller(db).RecordExplained(p.Id, new RecordOnboardingExplainedDto { ComplaintsExplainedOn = new DateOnly(2026, 10, 3), RightsExplainedOn = new DateOnly(2026, 10, 3) }, CancellationToken.None));

        var d = await Checklist(db, p);

        Assert.All(d.Items, i => Assert.True(i.Done));
        Assert.True(d.IsReady);
        Assert.Equal(new DateOnly(2026, 10, 2), d.AgreementSignedOn);
    }

    [Fact]
    public async Task AgreementRecord_AReasonInsteadOfASignedDate_CompletesTheItem_AndReplacesAnEarlierDate()
    {
        using var db = Db();
        var p = InOnboarding(db);
        var controller = Controller(db);
        Ok(await controller.RecordAgreement(p.Id, new RecordOnboardingAgreementDto { SignedOn = new DateOnly(2026, 10, 2) }, CancellationToken.None));

        var d = Ok(await controller.RecordAgreement(p.Id, new RecordOnboardingAgreementDto { NoAgreementReason = "  Participant chose not to have a written agreement.  " }, CancellationToken.None));

        Assert.True(d.Items.Single(i => i.Key == "agreement").Done);
        Assert.Null(d.AgreementSignedOn);
        Assert.Equal("Participant chose not to have a written agreement.", d.NoAgreementReason);
        var row = await db.ParticipantOnboardings.SingleAsync();
        Assert.Equal("coordinator-1", row.AgreementRecordedBy);
        Assert.NotNull(row.AgreementRecordedAt);
    }

    public static TheoryData<RecordOnboardingAgreementDto, string> Invalid => new()
    {
        { new RecordOnboardingAgreementDto(), "signedOn" },
        { new RecordOnboardingAgreementDto { NoAgreementReason = "   " }, "signedOn" },
        { new RecordOnboardingAgreementDto { SignedOn = new DateOnly(2026, 10, 1), NoAgreementReason = "Both" }, "noAgreementReason" },
        { new RecordOnboardingAgreementDto { SignedOn = new DateOnly(2026, 10, 14) }, "signedOn" },
        { new RecordOnboardingAgreementDto { SignedOn = new DateOnly(1989, 12, 31) }, "signedOn" },
        { new RecordOnboardingAgreementDto { NoAgreementReason = new string('x', 501) }, "noAgreementReason" },
    };

    [Theory]
    [MemberData(nameof(Invalid))]
    public async Task AgreementRecord_NeedsExactlyOneValidAnswer_AndSaysWhichFieldIsWrong(RecordOnboardingAgreementDto dto, string field)
    {
        using var db = Db();
        var p = InOnboarding(db);

        var result = await Controller(db).RecordAgreement(p.Id, dto, CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Contains(field, problem.Errors.Keys);
        var row = await db.ParticipantOnboardings.SingleAsync();
        Assert.Null(row.AgreementSignedOn);
        Assert.Null(row.NoAgreementReason);
    }

    [Fact]
    public async Task AgreementRecord_ForAnotherTenantsParticipant_Is404()
    {
        using var db = Db();
        var p = InOnboarding(db, x => x.TenantId = Guid.NewGuid());

        var result = await Controller(db).RecordAgreement(p.Id, new RecordOnboardingAgreementDto { SignedOn = new DateOnly(2026, 10, 2) }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    private static Task<ActionResult<ApiResponse<ParticipantOnboardingDto>>> Explained(OdipDbContext db, Participant p, DateOnly? complaints, DateOnly? rights) =>
        Controller(db).RecordExplained(p.Id, new RecordOnboardingExplainedDto { ComplaintsExplainedOn = complaints, RightsExplainedOn = rights }, CancellationToken.None);

    [Fact]
    public async Task ExplainedRecord_ChecksTheFutureAgainstTheProvidersToday_NotUtc()
    {
        using var db = Db();
        var p = InOnboarding(db);
        // 14:30 UTC on 31 October is 01:30 on 1 November in Sydney: 1 November is the provider's today, so it is not in the future.
        var clock = new FakeClock(new DateTimeOffset(2026, 10, 31, 14, 30, 0, TimeSpan.Zero));

        var d = Ok(await Controller(db, clock).RecordExplained(p.Id, new RecordOnboardingExplainedDto { ComplaintsExplainedOn = new DateOnly(2026, 11, 1) }, CancellationToken.None));

        Assert.Equal(new DateOnly(2026, 11, 1), d.ComplaintsExplainedOn);
    }

    [Fact]
    public async Task ExplainedRecord_FlipsItsItemsToDone_AndASecondCallReplacesTheFirst_ANullClearingThatItem()
    {
        using var db = Db();
        var p = InOnboarding(db);

        var d = Ok(await Explained(db, p, new DateOnly(2026, 10, 2), new DateOnly(2026, 10, 3)));

        Assert.True(d.Items.Single(i => i.Key == "complaints").Done);
        Assert.True(d.Items.Single(i => i.Key == "rights").Done);
        Assert.Equal((new DateOnly(2026, 10, 2), new DateOnly(2026, 10, 3)), (d.ComplaintsExplainedOn, d.RightsExplainedOn));

        d = Ok(await Explained(db, p, null, new DateOnly(2026, 10, 13)));

        Assert.False(d.Items.Single(i => i.Key == "complaints").Done);
        Assert.NotNull(d.Items.Single(i => i.Key == "complaints").Missing);
        Assert.True(d.Items.Single(i => i.Key == "rights").Done);
        Assert.Null(d.ComplaintsExplainedOn);
        Assert.Equal(new DateOnly(2026, 10, 13), d.RightsExplainedOn);
        var row = await db.ParticipantOnboardings.SingleAsync();
        Assert.Equal("coordinator-1", row.ExplainedRecordedBy);
        Assert.NotNull(row.ExplainedRecordedAt);
    }

    public static TheoryData<string, string> InvalidExplained => new()
    {
        { "both null", "complaintsExplainedOn" },
        { "future complaints", "complaintsExplainedOn" },
        { "future rights", "rightsExplainedOn" },
        { "old complaints", "complaintsExplainedOn" },
        { "old rights", "rightsExplainedOn" },
    };

    [Theory]
    [MemberData(nameof(InvalidExplained))]
    public async Task ExplainedRecord_RejectsNoDate_AFutureDate_AndABefore1990Date_NamingTheField(string which, string field)
    {
        using var db = Db();
        var p = InOnboarding(db);
        DateOnly? future = new DateOnly(2026, 10, 14), old = new DateOnly(1989, 12, 31), ok = new DateOnly(2026, 10, 2);

        var result = which switch
        {
            "both null" => await Explained(db, p, null, null),
            "future complaints" => await Explained(db, p, future, ok),
            "future rights" => await Explained(db, p, ok, future),
            "old complaints" => await Explained(db, p, old, ok),
            _ => await Explained(db, p, ok, old),
        };

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<BadRequestObjectResult>(result.Result).Value);
        Assert.Contains(field, problem.Errors.Keys);
        var row = await db.ParticipantOnboardings.SingleAsync();
        Assert.Null(row.ComplaintsExplainedOn);
        Assert.Null(row.RightsExplainedOn);
    }

    [Fact]
    public async Task ExplainedRecord_ForAnotherTenantsParticipant_Is404()
    {
        using var db = Db();
        var p = InOnboarding(db, x => x.TenantId = Guid.NewGuid());

        var result = await Explained(db, p, new DateOnly(2026, 10, 2), null);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public void ExplainedRecord_IsForAdminCoordinatorAndSuperAdminOnly_SoASupportWorkerGets403()
    {
        var auth = typeof(ParticipantInquiriesController).GetMethod(nameof(ParticipantInquiriesController.RecordExplained))!
            .GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), false)
            .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>().Single();

        Assert.Equal(["Admin", "Coordinator", "SuperAdmin"], auth.Roles!.Split(',').Order());
        Assert.DoesNotContain("SupportWorker", auth.Roles);
    }

    [Fact]
    public async Task Worklist_ShowsNOfM_TheFirstMissingItem_AndServicesStarted_AndKeepsAParticipantWhoseItemsAreAllDone()
    {
        using var db = Db();
        var open = InOnboarding(db, x => x.ServicesStartedAt = new DateTime(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc));
        var done = InOnboarding(db, x => { x.FundingSource = ParticipantFundingSource.Other; x.NdisNumber = null; });
        ValidDraft(db, done);
        db.SaveChanges();
        Ok(await Controller(db).RecordAgreement(done.Id, new RecordOnboardingAgreementDto { NoAgreementReason = "Not practicable" }, CancellationToken.None));
        Ok(await Controller(db).RecordExplained(done.Id, new RecordOnboardingExplainedDto { ComplaintsExplainedOn = new DateOnly(2026, 10, 3), RightsExplainedOn = new DateOnly(2026, 10, 3) }, CancellationToken.None));

        var rows = Ok(await Controller(db).GetOnboardingWorklist(CancellationToken.None));

        var openRow = rows.Single(r => r.ParticipantId == open.Id);
        Assert.Equal((1, 6, "Service needs"), (openRow.CompletedSteps, openRow.TotalSteps, openRow.FirstMissing));
        Assert.Equal(open.ServicesStartedAt, openRow.ServicesStartedAt);
        var doneRow = rows.Single(r => r.ParticipantId == done.Id);
        Assert.Equal((5, 5, (string?)null), (doneRow.CompletedSteps, doneRow.TotalSteps, doneRow.FirstMissing));
    }

    [Fact]
    public async Task Worklist_RowsEqualTheSingleParticipantChecklist_AndAnotherTenantsPlanDoesNotLeak()
    {
        using var db = Db();
        var current = InOnboarding(db);
        var ended = InOnboarding(db);
        var noPlan = InOnboarding(db);
        var other = InOnboarding(db, x => { x.FundingSource = ParticipantFundingSource.Other; x.NdisNumber = null; });
        ValidDraft(db, current);
        ValidDraft(db, ended);
        ValidDraft(db, other);
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = current.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = Tenant, ParticipantId = ended.Id, PlanStart = new DateOnly(2025, 7, 1), PlanEnd = new DateOnly(2026, 6, 30) });
        // Another tenant's participant with a current plan, and a plan of theirs pointing at our no-plan participant: neither may reach our facts.
        var stranger = InOnboarding(db, x => x.TenantId = Guid.NewGuid());
        var otherTenant = Guid.NewGuid();
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = otherTenant, ParticipantId = stranger.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = otherTenant, ParticipantId = noPlan.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30) });
        db.SaveChanges();

        var rows = Ok(await Controller(db).GetOnboardingWorklist(CancellationToken.None));

        Assert.Equal(4, rows.Count);
        Assert.DoesNotContain(rows, r => r.ParticipantId == stranger.Id);
        foreach (var p in new[] { current, ended, noPlan, other })
        {
            var row = rows.Single(r => r.ParticipantId == p.Id);
            var detail = await Checklist(db, p);
            Assert.Equal((detail.Items.Count(i => i.Done), detail.Items.Count, detail.Items.FirstOrDefault(i => !i.Done)?.Label),
                (row.CompletedSteps, row.TotalSteps, row.FirstMissing));
        }
        // Absolute: profile and service needs done, the agreement not signed, the ended plan not counting as funding (a swap of the two fact sets would show here).
        var endedRow = rows.Single(r => r.ParticipantId == ended.Id);
        Assert.Equal((2, 6, "Signed agreement"), (endedRow.CompletedSteps, endedRow.TotalSteps, endedRow.FirstMissing));
        Assert.Equal("The plan budget has ended: record the new plan.", (await Checklist(db, ended)).Items.Single(i => i.Key == "funding").Missing);
        Assert.Equal("No plan budget recorded.", (await Checklist(db, noPlan)).Items.Single(i => i.Key == "funding").Missing);
        Assert.True((await Checklist(db, current)).Items.Single(i => i.Key == "funding").Done);
    }

    [Fact]
    public async Task RosterIssues_FollowTheDerivedChecks_NotTheOldStoredFlags()
    {
        using var db = Db();
        var p = InOnboarding(db, x => x.DateOfBirth = null);
        var row = await db.ParticipantOnboardings.SingleAsync();
        row.ProfileComplete = true; row.ProfileCompletedAt = DateTime.UtcNow;
        row.ServiceTypeConfirmed = true; row.ServiceTypeConfirmedAt = DateTime.UtcNow;
        db.SaveChanges();

        var issues = (await ParticipantReadiness.IssuesAsync(db, [p.Id], CancellationToken.None))[p.Id];

        Assert.Contains(ParticipantReadiness.OnboardingProfileNotComplete, issues);
        Assert.Contains(ParticipantReadiness.OnboardingServiceTypeNotComplete, issues);

        p.DateOfBirth = new DateOnly(1990, 1, 2);
        ValidDraft(db, p);
        db.SaveChanges();
        issues = (await ParticipantReadiness.IssuesAsync(db, [p.Id], CancellationToken.None))[p.Id];
        Assert.DoesNotContain(ParticipantReadiness.OnboardingProfileNotComplete, issues);
        Assert.DoesNotContain(ParticipantReadiness.OnboardingServiceTypeNotComplete, issues);
    }
}
