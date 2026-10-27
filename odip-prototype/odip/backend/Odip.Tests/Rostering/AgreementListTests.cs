using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements page (PR A): GET service-agreements and GET price-lists. The approval fixture's day, Saturday 10 October 2026.</summary>
public class AgreementListTests
{
    internal static ICurrentTenant Tenant(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(superAdmin);
        return tenant.Object;
    }

    /// <summary>The controller with a signed-in caller: CanApprove and the approval read the claims.</summary>
    internal static ServiceAgreementsController Controller(OdipDbContext db, Fixture f, Guid? tenantId = null, string role = "Admin", bool superAdmin = false, ServiceAgreementApprovalService? approval = null)
    {
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, role),
        }, "Test");
        return new ServiceAgreementsController(db, Tenant(tenantId ?? TenantA, superAdmin), f.Clock, approval ?? f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    internal static async Task<Guid> ParticipantAsync(Fixture f, string firstName, Guid? tenantId = null, bool active = true, bool draftStage = false)
    {
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = tenantId ?? TenantA, FirstName = firstName, LastName = "Ng", IsActive = active, IsDraft = draftStage };
        f.Db.Participants.Add(participant);
        await f.Db.SaveChangesAsync();
        return participant.Id;
    }

    internal static async Task<ServiceAgreementDraft> RevisionAsync(Fixture f, Guid participantId, int version, DateOnly start, DateOnly end, bool approved, Guid? tenantId = null)
    {
        var draft = await AddRevisionAsync(f, version, new[] { WeekdayBlock() }, start: start, end: end, handTyped: true, tenantId: tenantId, participantId: participantId);
        if (approved) await MarkApprovedAsync(f.Db, draft);
        return draft;
    }

    private static async Task<AgreementListDto> ListAsync(ServiceAgreementsController controller) =>
        Assert.IsType<ApiResponse<AgreementListDto>>(Assert.IsType<OkObjectResult>((await controller.List(CancellationToken.None)).Result).Value).Data!;

    [Fact]
    public async Task Lists_one_row_per_participant_with_revisions_with_each_status()
    {
        await using var f = await SetUpAsync();                                              // Amy
        var amy = f.ParticipantId;
        await RevisionAsync(f, amy, 1, Today.AddDays(-100), Today.AddDays(200), approved: true);
        var ben = await ParticipantAsync(f, "Ben");
        await RevisionAsync(f, ben, 1, Today.AddDays(-100), Today.AddDays(10), approved: true);
        var cal = await ParticipantAsync(f, "Cal");
        await RevisionAsync(f, cal, 1, Today.AddDays(-100), Today.AddDays(-3), approved: true);
        var dee = await ParticipantAsync(f, "Dee");
        await RevisionAsync(f, dee, 1, Today.AddDays(-100), Today.AddDays(200), approved: true);
        await RevisionAsync(f, dee, 2, Today.AddDays(5), Today.AddDays(200), approved: false);
        var eve = await ParticipantAsync(f, "Eve");
        await RevisionAsync(f, eve, 1, Today, Today.AddDays(300), approved: false);
        var fay = await ParticipantAsync(f, "Fay");
        await RevisionAsync(f, fay, 1, Today.AddDays(-100), Today.AddDays(-3), approved: true);
        await RevisionAsync(f, fay, 2, Today.AddDays(-2), Today.AddDays(300), approved: false);
        var gus = await ParticipantAsync(f, "Gus", active: false);
        await RevisionAsync(f, gus, 1, Today.AddDays(-100), Today.AddDays(5), approved: true);
        await ParticipantAsync(f, "Hal");                                                    // no revision at all
        var ivy = await ParticipantAsync(f, "Ivy", draftStage: true);
        await RevisionAsync(f, ivy, 1, Today, Today.AddDays(300), approved: false);        // services not started: not listed

        var list = await ListAsync(Controller(f.Db, f));

        var rows = list.Rows.ToDictionary(r => r.ParticipantId);
        Assert.Equal(new[] { amy, ben, cal, dee, eve, fay }.OrderBy(id => rows[id].ParticipantName), list.Rows.Select(r => r.ParticipantId));
        Assert.Equal(("Active", "None", false, (int?)null), (rows[amy].Status, rows[amy].EndingState, rows[amy].HasWaitingDraft, rows[amy].DaysLeft));
        Assert.Equal(("Ending", "Ending", 10), (rows[ben].Status, rows[ben].EndingState, rows[ben].DaysLeft!.Value));
        Assert.Equal(("Ended", "Ended", -3), (rows[cal].Status, rows[cal].EndingState, rows[cal].DaysLeft!.Value));
        Assert.Equal(("DraftWaiting", true, 2), (rows[dee].Status, rows[dee].HasWaitingDraft, rows[dee].Waiting!.Version));
        Assert.Equal(1, rows[dee].Current!.Version);
        Assert.Equal(("NotApproved", true, 1), (rows[eve].Status, rows[eve].HasWaitingDraft, rows[eve].Waiting!.Version));
        Assert.Null(rows[eve].Current);
        Assert.Null(rows[eve].TermStart);
        // An ended agreement with a waiting renewal shows the draft, and still says it has ended.
        Assert.Equal(("DraftWaiting", "Ended", true), (rows[fay].Status, rows[fay].EndingState, rows[fay].Waiting is not null));
        Assert.True(list.CanApprove);
    }

    [Fact]
    public async Task A_coordinator_the_organisation_excludes_cannot_approve()
    {
        await using var f = await SetUpAsync();
        await RevisionAsync(f, f.ParticipantId, 1, Today.AddDays(-100), Today.AddDays(200), approved: true);
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        await f.Db.SaveChangesAsync();

        Assert.False((await ListAsync(Controller(f.Db, f, role: "Coordinator"))).CanApprove);
        Assert.True((await ListAsync(Controller(f.Db, f, role: "Admin"))).CanApprove);
    }

    [Fact]
    public async Task Term_start_is_the_earliest_approved_revision_ending_on_the_current_end()
    {
        await using var f = await SetUpAsync();
        var end = Today.AddDays(200);
        await RevisionAsync(f, f.ParticipantId, 1, Today.AddDays(-100), end, approved: true);
        await RevisionAsync(f, f.ParticipantId, 2, Today.AddDays(-30), end, approved: true);          // a mid-term reprice
        var single = await ParticipantAsync(f, "Ben");
        await RevisionAsync(f, single, 1, Today.AddDays(-50), end, approved: true);
        var renewed = await ParticipantAsync(f, "Cal");
        await RevisionAsync(f, renewed, 1, Today.AddDays(-400), Today.AddDays(-201), approved: true);
        await RevisionAsync(f, renewed, 2, Today.AddDays(-200), end, approved: true);                // the earlier term ends the day before

        var rows = (await ListAsync(Controller(f.Db, f))).Rows.ToDictionary(r => r.ParticipantId);

        Assert.Equal((Today.AddDays(-100), Today.AddDays(-30)), (rows[f.ParticipantId].TermStart!.Value, rows[f.ParticipantId].Current!.AgreementStartDate));
        Assert.Equal(2, rows[f.ParticipantId].Current!.Version);
        Assert.Equal(rows[single].Current!.AgreementStartDate, rows[single].TermStart);
        Assert.Equal(Today.AddDays(-200), rows[renewed].TermStart);                                   // no walk-back to the earlier term
    }

    [Fact]
    public async Task Totals_are_the_sum_of_line_totals_to_the_cent()
    {
        await using var f = await SetUpAsync();
        var current = await RevisionAsync(f, f.ParticipantId, 1, Today.AddDays(-100), Today.AddDays(200), approved: true);
        f.Db.ServiceAgreementDraftLines.Add(new ServiceAgreementDraftLine { Id = Guid.NewGuid(), DraftId = current.Id, Position = 1, ServiceType = "Engine", ItemCode = "X", Hours = 3m, UnitPrice = 50m, Total = 149.99m, CatalogueVersion = "2026-27", CatalogueEffectiveFrom = new DateOnly(2026, 7, 1) });
        var waiting = await RevisionAsync(f, f.ParticipantId, 2, Today.AddDays(201), Today.AddDays(500), approved: false);
        waiting.Lines.First().Hours = 1.333m;                                                         // hand-typed: floor(1.333 * 73.58 * 100) / 100
        await f.Db.SaveChangesAsync();

        var row = Assert.Single((await ListAsync(Controller(f.Db, f))).Rows);

        Assert.Equal(735.80m + 149.99m, row.Current!.Total);                                          // hand-typed 10 h at 73.58, plus the engine's own total
        Assert.Equal(Math.Floor(1.333m * 73.58m * 100m) / 100m, row.Waiting!.Total);
    }

    [Fact]
    public async Task Price_list_is_the_version_of_the_latest_line_and_a_newer_list_is_offered_only_up_to_the_end()
    {
        await using var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2025_26Trimmed);
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        var lists = await Odip.Infrastructure.Services.AgreementPriceLists.ListAsync(f.Db, CancellationToken.None);
        var (newest, older) = (lists[0], lists[1]);
        var runsPast = await RevisionAsync(f, f.ParticipantId, 1, older.Start, newest.Start.AddDays(30), approved: true);
        var endsFirst = await ParticipantAsync(f, "Ben");
        var endsBefore = await RevisionAsync(f, endsFirst, 1, older.Start, newest.Start.AddDays(-1), approved: true);
        foreach (var draft in new[] { runsPast, endsBefore }) foreach (var line in draft.Lines) { line.CatalogueVersion = older.Version; line.CatalogueEffectiveFrom = older.Start; }
        await f.Db.SaveChangesAsync();

        var rows = (await ListAsync(Controller(f.Db, f))).Rows.ToDictionary(r => r.ParticipantId);

        Assert.Equal(older.Version, rows[f.ParticipantId].PriceList!.Version);
        Assert.Equal(newest.Version, rows[f.ParticipantId].NewerPriceList!.Version);
        Assert.Null(rows[endsFirst].NewerPriceList);                                                  // the newer list starts the day after the end
    }

    [Fact]
    public async Task A_draft_stage_participant_with_an_agreement_draft_is_not_listed_until_services_start()
    {
        await using var f = await SetUpAsync();
        var ivy = await ParticipantAsync(f, "Ivy", draftStage: true);
        await RevisionAsync(f, ivy, 1, Today, Today.AddDays(300), approved: false);
        Assert.Empty((await ListAsync(Controller(f.Db, f))).Rows);

        var participant = await f.Db.Participants.FindAsync(ivy);
        participant!.ServicesStartedAt = DateTime.UtcNow;
        await f.Db.SaveChangesAsync();

        Assert.Equal(ivy, Assert.Single((await ListAsync(Controller(f.Db, f))).Rows).ParticipantId);
    }

    [Fact]
    public async Task The_list_never_includes_another_organisations_agreements()
    {
        await using var f = await SetUpAsync();
        await RevisionAsync(f, f.ParticipantId, 1, Today.AddDays(-100), Today.AddDays(200), approved: true);
        var other = await ParticipantAsync(f, "Other", TenantB);
        await RevisionAsync(f, other, 1, Today.AddDays(-100), Today.AddDays(5), approved: true, tenantId: TenantB);

        await using (var tenantA = TestDb.ForTenant(f.DbName, TenantA))
            Assert.Equal(new[] { f.ParticipantId }, (await ListAsync(Controller(tenantA, f))).Rows.Select(r => r.ParticipantId));
        await using (var tenantB = TestDb.ForTenant(f.DbName, TenantB))
            Assert.Equal(new[] { other }, (await ListAsync(Controller(tenantB, f, TenantB))).Rows.Select(r => r.ParticipantId));
        // A SuperAdmin's context has no filter: the controller names the organisation itself.
        Assert.Equal(new[] { f.ParticipantId }, (await ListAsync(Controller(f.Db, f, TenantA, "SuperAdmin", superAdmin: true))).Rows.Select(r => r.ParticipantId));
        Assert.Equal(new[] { other }, (await ListAsync(Controller(f.Db, f, TenantB, "SuperAdmin", superAdmin: true))).Rows.Select(r => r.ParticipantId));
    }

    [Fact]
    public async Task A_super_admin_must_choose_an_organisation()
    {
        await using var f = await SetUpAsync();
        var controller = new ServiceAgreementsController(f.Db, Tenant(null, superAdmin: true), f.Clock);

        Assert.IsType<BadRequestObjectResult>((await controller.List(CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await controller.PriceLists(CancellationToken.None)).Result);
    }

    [Fact]
    public void New_actions_are_admitted_to_admins_coordinators_and_superadmins_only()
    {
        Assert.Equal("Admin,Coordinator,SuperAdmin", typeof(ServiceAgreementsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        foreach (var name in new[] { "List", "PriceLists", "ApproveBatch" })
            Assert.Null(typeof(ServiceAgreementsController).GetMethod(name)!.GetCustomAttribute<AuthorizeAttribute>());   // none overrides the class
    }
}
