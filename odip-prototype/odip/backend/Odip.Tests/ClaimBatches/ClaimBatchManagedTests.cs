using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.ClaimBatches;

/// <summary>The Plan- and self-managed tab pages every claim of those participants, not the newest 200 of all.</summary>
public class ClaimBatchManagedTests
{
    private static readonly PlanType[] Both = [PlanType.PlanManaged, PlanType.SelfManaged];

    [Fact]
    public async Task Managed_returns_an_old_plan_claim_behind_200_newer_ndia_claims()
    {
        using var f = new BatchFixture();
        var (old, _, _) = f.AddClaim(plan: PlanType.PlanManaged);
        old.CreatedAt = BatchFixture.Now.AddDays(-400);
        for (var i = 0; i < 201; i++) f.AddClaim().Claim.CreatedAt = BatchFixture.Now.AddMinutes(-i);
        f.Db.SaveChanges();

        var page = await f.Service.ManagedAsync(f.TenantId, Both, 1, 50, default);

        Assert.Equal(1, page.TotalCount);
        Assert.Equal(old.Id, Assert.Single(page.Items).ClaimId);
    }

    [Fact]
    public async Task Managed_pages_stably_newest_first_with_the_id_breaking_ties()
    {
        using var f = new BatchFixture();
        var made = Enumerable.Range(0, 5).Select(_ => f.AddClaim(plan: PlanType.PlanManaged).Claim).ToList();
        foreach (var c in made) c.CreatedAt = BatchFixture.Now; // all tied
        f.Db.SaveChanges();

        var pages = new List<Odip.Application.Common.PagedResult<ManagedClaimDto>>();
        foreach (var p in new[] { 1, 2, 3 }) pages.Add(await f.Service.ManagedAsync(f.TenantId, Both, p, 2, default));

        Assert.Equal([2, 2, 1], pages.Select(p => p.Items.Count));
        Assert.All(pages, p => Assert.Equal(5, p.TotalCount));
        var ids = pages.SelectMany(p => p.Items).Select(i => i.ClaimId).ToList();
        Assert.Equal(made.Select(c => c.Id).OrderByDescending(i => i), ids);
    }

    [Fact]
    public async Task Managed_filters_funding_tenant_and_cancelled()
    {
        using var f = new BatchFixture();
        var (plan, _, _) = f.AddClaim(plan: PlanType.PlanManaged);
        var (self, _, _) = f.AddClaim(plan: PlanType.SelfManaged);
        f.AddClaim(plan: PlanType.PlanManaged, status: TripClaimStatus.Cancelled);
        f.AddClaim(plan: PlanType.PlanManaged, tenant: f.OtherTenantId);

        var onlySelf = await f.Service.ManagedAsync(f.TenantId, [PlanType.SelfManaged], 1, 50, default);
        var all = await f.Service.ManagedAsync(f.TenantId, Both, 1, 50, default);

        Assert.Equal(self.Id, Assert.Single(onlySelf.Items).ClaimId);
        Assert.Equal("self", onlySelf.Items[0].FundingType);
        Assert.Equal(new[] { plan.Id, self.Id }.Order(), all.Items.Select(i => i.ClaimId).Order());
        Assert.Equal(2, all.TotalCount);
    }

    [Fact]
    public async Task Managed_follows_the_booking_override()
    {
        using var f = new BatchFixture();
        var (plain, _, _) = f.AddClaim(plan: PlanType.PlanManaged);
        var (_, aLines, _) = f.AddClaim(plan: PlanType.PlanManaged);
        var (b, bLines, _) = f.AddClaim(plan: PlanType.AgencyManaged);
        f.Db.ParticipantBookings.Single(x => x.Id == aLines[0].ParticipantBookingId).PlanTypeOverride = PlanType.AgencyManaged;
        f.Db.ParticipantBookings.Single(x => x.Id == bLines[0].ParticipantBookingId).PlanTypeOverride = PlanType.SelfManaged;
        f.Db.SaveChanges();

        var page = await f.Service.ManagedAsync(f.TenantId, Both, 1, 50, default);

        // The plain claim (no override) and b (override to self) come back; a (overridden to agency) does not.
        Assert.Equal(new[] { plain.Id, b.Id }.Order(), page.Items.Select(i => i.ClaimId).Order());
        var back = Assert.Single(page.Items, i => i.ClaimId == b.Id);
        Assert.Equal("self", back.FundingType);
        Assert.DoesNotContain(page.Items, i => i.ClaimId == aLines[0].TripClaimId);
    }
}

/// <summary>The new GET sits behind the class's role list and refuses a funding value it does not know. There is no generic role suite, so this is the guard.</summary>
public class ClaimBatchManagedControllerTests
{
    private static readonly MethodInfo Action = typeof(ClaimBatchesController).GetMethod(nameof(ClaimBatchesController.Managed))!;

    [Fact]
    public void Managed_is_get_claim_hub_managed_and_not_anonymous()
    {
        Assert.Equal("claim-hub/managed", Action.GetCustomAttribute<HttpGetAttribute>()!.Template);
        Assert.Null(Action.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(typeof(ClaimBatchesController).GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("Admin,Coordinator,SuperAdmin", typeof(ClaimBatchesController).GetCustomAttribute<AuthorizeAttribute>()!.Roles);
    }

    [Fact]
    public async Task An_unknown_funding_value_is_a_400()
    {
        using var f = new BatchFixture();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(f.TenantId);
        var result = await new ClaimBatchesController(f.Service, tenant.Object).Managed("x");
        Assert.IsType<BadRequestObjectResult>(result);
    }
}
