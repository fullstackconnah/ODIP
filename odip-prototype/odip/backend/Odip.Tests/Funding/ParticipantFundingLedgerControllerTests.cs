using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// <c>GET api/v1/participants/{id}/funding/ledger</c>: money is on it, so it is admitted to SuperAdmin, Admin and Coordinator only (reads included), a SuperAdmin must have chosen an organisation,
/// another organisation's participant is "not found", and the claim detail's budget block is worked out through the tenant's own participants.
/// </summary>
public class ParticipantFundingLedgerControllerTests
{
    private static readonly string[] Staff = ["SuperAdmin", "Admin", "Coordinator"];
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static ParticipantFundingLedgerController ControllerFor(LedgerKit kit, Guid? tenantId) =>
        new(TenantOf(tenantId), kit.Ledger);

    private static ICurrentTenant TenantOf(Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        return tenant.Object;
    }

    private static LedgerKit Arrange(out Participant person)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        return kit;
    }

    private static T Ok<T>(ActionResult<ApiResponse<T>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<T>>(ok.Value);
        Assert.True(response.Success);
        return response.Data!;
    }

    // ── What it answers ─────────────────────────────────────────────────────

    [Fact]
    public async Task AnswersWithTheParticipantsLedger()
    {
        using var kit = Arrange(out var person);

        var dto = Ok(await ControllerFor(kit, kit.TenantId).Ledger(person.Id, Ct));

        Assert.NotNull(dto.PlanId);
        Assert.Equal(480m, dto.Pools.Single().Periods[1].Pending);
        Assert.Equal(new DateOnly(2026, 10, 4), dto.AsOf);
    }

    [Fact]
    public async Task AnswersWithNoPlanAndNoPoolsForAParticipantWhoseBudgetIsNotRecorded_NeverAnAllClear()
    {
        using var kit = Arrange(out _);
        var bare = kit.SeedParticipant(last: "Bare");

        var dto = Ok(await ControllerFor(kit, kit.TenantId).Ledger(bare.Id, Ct));

        Assert.Null(dto.PlanId);
        Assert.Empty(dto.Pools);
    }

    [Fact]
    public async Task AnotherOrganisationsParticipantIsNotFound_AndASuperAdminWithNoOrganisationChosenIsToldToChooseOne()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(TenantA, database);
        using var b = LedgerKit.Create(TenantB, database);
        a.SeedProvider("NSW", TenantA);
        var theirs = b.SeedParticipant(tenantId: TenantB);
        var mine = a.SeedParticipant();

        Assert.IsType<NotFoundObjectResult>((await ControllerFor(a, TenantA).Ledger(theirs.Id, Ct)).Result);
        Assert.IsType<NotFoundObjectResult>((await ControllerFor(a, TenantA).Rows(theirs.Id, Guid.NewGuid(), Guid.NewGuid(), Ct)).Result);
        var needsOrganisation = Assert.IsType<BadRequestObjectResult>((await ControllerFor(a, null).Ledger(mine.Id, Ct)).Result);
        Assert.Equal(ParticipantFundingController.ChooseOrganisation, Assert.Single(Assert.IsType<ApiResponse<ParticipantLedgerDto>>(needsOrganisation.Value).Errors!));
    }

    [Fact]
    public async Task RowsServeAnotherPageOfAPeriod_AndANotFoundForAPeriodThatIsNotInThePlan()
    {
        using var kit = Arrange(out var person);
        var dto = Ok(await ControllerFor(kit, kit.TenantId).Ledger(person.Id, Ct));
        var pool = dto.Pools.Single();

        var page = Ok(await ControllerFor(kit, kit.TenantId).Rows(person.Id, pool.Id, pool.Periods[1].Id, Ct, skip: 0, take: 10));

        Assert.Equal(1, page.Total);
        Assert.Equal(LedgerRowKind.CompletedShift, Assert.Single(page.Rows).Kind);
        Assert.IsType<NotFoundObjectResult>((await ControllerFor(kit, kit.TenantId).Rows(person.Id, pool.Id, Guid.NewGuid(), Ct)).Result);
    }

    // ── The claim detail's budget block ─────────────────────────────────────

    private static ClaimsController ClaimsControllerFor(LedgerKit kit, ICurrentTenant tenant) =>
        new(kit.Db, new ClaimGenerationService(kit.Db), new ShiftClaimGenerationService(kit.Db), new BprCsvService(kit.Db), new InvoiceService(kit.Db), kit.Ledger, tenant);

    private static TripClaimDetailDto Detail(ActionResult<ApiResponse<TripClaimDetailDto>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<TripClaimDetailDto>>(ok.Value).Data!;
    }

    [Fact]
    public async Task TheClaimDetailCarriesTheBudgetBlockForTheClaimsParticipant_AsOfNow()
    {
        using var kit = Arrange(out var person);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 600m, kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        var detail = Detail(await ClaimsControllerFor(kit, TenantOf(kit.TenantId)).GetClaim(claim.Id, Ct));

        var participant = Assert.Single(detail.Budget!.Participants);
        Assert.Equal(person.Id, participant.ParticipantId);
        var row = Assert.Single(participant.Rows);
        Assert.Equal("Core (flexible)", row.PoolName);
        Assert.Equal(480m, row.UsedBefore);        // the completed shift of 1 Oct, which has no claim
        Assert.Equal(600m, row.ThisClaim);
        Assert.Equal(1080m, row.UsedAfter);
        Assert.Equal(4000m - 1080m, row.LeftAfter);   // 2,000 + 2,000 carried from Q1
    }

    [Fact]
    public async Task TheClaimDetailOfAnotherOrganisationsClaimShowsNoBudgetAtAll_EvenWhenReachedByItsId()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(TenantA, database);
        using var b = LedgerKit.Create(TenantB, database);
        b.SeedProvider("NSW", TenantB);
        b.SeedCommunityAccessCatalogue();
        var theirs = b.SeedParticipant(tenantId: TenantB);
        b.SeedPlan(theirs, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        var claim = b.SeedShiftClaim(theirs, TripClaimStatus.Draft, 600m, b.SeedShift(theirs, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        var seenFromB = Detail(await ClaimsControllerFor(b, TenantOf(TenantB)).GetClaim(claim.Id, Ct));
        var seenFromA = await ClaimsControllerFor(a, TenantOf(TenantA)).GetClaim(claim.Id, Ct);

        Assert.NotNull(seenFromB.Budget);
        // The claim record itself has no tenant filter (a standing ruling), so it may be found by id; what this feature adds must not widen that: no figure of the other organisation.
        if (seenFromA.Result is OkObjectResult) Assert.Null(Detail(seenFromA).Budget);
    }

    [Fact]
    public async Task ASuperAdminWhoHasNotChosenAnOrganisationGetsNoBudgetBlock()
    {
        using var kit = Arrange(out var person);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 600m, kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        var detail = Detail(await ClaimsControllerFor(kit, TenantOf(null)).GetClaim(claim.Id, Ct));

        Assert.Null(detail.Budget);
    }

    // ── Who may ask ─────────────────────────────────────────────────────────

    /// <summary>The framework's rule: every [Authorize] on the class and on the action must admit the role.</summary>
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(ParticipantFundingLedgerController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_AllReads_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt()
    {
        Assert.Equal(
            new[] { nameof(ParticipantFundingLedgerController.Ledger), nameof(ParticipantFundingLedgerController.Rows) },
            Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));
        Assert.All(Actions(), action => Assert.NotEmpty(action.GetCustomAttributes<HttpGetAttribute>()));
    }

    [Fact]
    public void EveryLedgerActionIsAdmittedToSuperAdminAdminAndCoordinatorOnly_ReadsIncluded()
    {
        foreach (var action in Actions())
        {
            foreach (var role in Staff) Assert.True(Allows(action, role), $"{action.Name} {role}");
            Assert.False(Allows(action, "SupportWorker"), action.Name);
            Assert.False(Allows(action, "ReadOnly"), action.Name);
        }
        var attribute = Assert.Single(typeof(ParticipantFundingLedgerController).GetCustomAttributes<AuthorizeAttribute>(false));
        Assert.Equal("SuperAdmin,Admin,Coordinator", attribute.Roles);   // the class itself carries them, so an action added without an attribute is still closed
    }

    /// <summary>
    /// Both GETs are rate limited on the shared "api" policy, the one every other endpoint that carries a figure uses: an attribute is only a declaration, so it is
    /// read off the compiled action and compared with the policy name itself, so a renamed or missing policy fails here rather than silently limiting nothing.
    /// </summary>
    [Fact]
    public void BothLedgerActionsAreRateLimitedOnTheSharedApiPolicy_SoAManyFigureEndpointCannotBeHammered()
    {
        var actions = Actions().ToList();

        Assert.Equal(2, actions.Count);
        foreach (var action in actions)
        {
            var policy = Assert.Single(action.GetCustomAttributes<EnableRateLimitingAttribute>());
            Assert.Equal("api", policy.PolicyName);   // the policy Program.cs registers: a typo here would leave the endpoint unlimited
        }
    }

    [Fact]
    public void ItSharesTheFundingRoutePrefix_SoTheLedgerIsAtFundingLedger()
    {
        var prefix = typeof(ParticipantFundingLedgerController).GetCustomAttribute<RouteAttribute>()!.Template;

        Assert.Equal("api/v1/participants/{participantId:guid}/funding", prefix);
        Assert.Equal("ledger", typeof(ParticipantFundingLedgerController).GetMethod(nameof(ParticipantFundingLedgerController.Ledger))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Equal("ledger/rows", typeof(ParticipantFundingLedgerController).GetMethod(nameof(ParticipantFundingLedgerController.Rows))!.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }
}
