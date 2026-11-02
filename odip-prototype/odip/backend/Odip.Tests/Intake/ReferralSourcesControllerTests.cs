using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>The organisation's referral-source list (Settings > Content): who sends it enquiries. Per organisation, hidden rather than deleted. The roles' 403 is in <see cref="ReferralSourcesHttpTests"/>.</summary>
public class ReferralSourcesControllerTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _otherTenantId = Guid.NewGuid();
    private readonly string _dbName = Guid.NewGuid().ToString();

    private OdipDbContext Db(Guid? tenantId = null, bool superAdmin = true)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(_dbName).Options, tenant.Object);
    }

    // A SuperAdmin caller has no query filter, so the controller's own tenant checks are what the SuperAdmin cases prove.
    private ReferralSourcesController Controller(Guid? tenantId, bool superAdmin = false, string role = "Coordinator")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role)], "test");
        return new ReferralSourcesController(Db(tenantId, superAdmin), tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private ReferralSource Seed(Guid tenantId, string name, bool active = true)
    {
        using var db = Db();
        var row = new ReferralSource { Id = Guid.NewGuid(), TenantId = tenantId, Name = name, IsActive = active };
        db.ReferralSources.Add(row);
        db.SaveChanges();
        return row;
    }

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static string Refusal<T>(ObjectResult result) => Assert.Single(Assert.IsType<ApiResponse<T>>(result.Value).Errors!);

    [Fact]
    public async Task GetAll_returns_only_this_tenants_sources_active_first_then_by_name()
    {
        Seed(_tenantId, "Hospital"); Seed(_tenantId, "Another provider"); Seed(_tenantId, "Closed clinic", active: false); Seed(_otherTenantId, "Other tenant's source");

        var rows = Data<List<ReferralSourceDto>>((await Controller(_tenantId).GetAll(CancellationToken.None)).Result);

        Assert.Equal(["Another provider", "Hospital", "Closed clinic"], rows.Select(r => r.Name));
        Assert.Equal([true, true, false], rows.Select(r => r.IsActive));
    }

    [Fact]
    public async Task GetAll_for_a_SuperAdmin_viewing_as_one_tenant_still_returns_only_that_tenant()
    {
        Seed(_tenantId, "Hospital"); Seed(_otherTenantId, "Other tenant's source");

        var rows = Data<List<ReferralSourceDto>>((await Controller(_tenantId, superAdmin: true, role: "SuperAdmin").GetAll(CancellationToken.None)).Result);

        Assert.Equal("Hospital", Assert.Single(rows).Name);
    }

    [Fact]
    public async Task GetAll_with_no_tenant_is_400_and_never_every_organisations_sources()
    {
        Seed(_tenantId, "Hospital");

        var result = (await Controller(null, superAdmin: true, role: "SuperAdmin").GetAll(CancellationToken.None)).Result;

        Assert.Equal("Choose an organisation first.", Refusal<List<ReferralSourceDto>>(Assert.IsType<BadRequestObjectResult>(result)));
    }

    [Fact]
    public async Task Create_trims_and_saves()
    {
        var result = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = "  Church group  " }, CancellationToken.None);

        Assert.Equal("Church group", Data<ReferralSourceDto>(result.Result).Name);
        var stored = Assert.Single(Db().ReferralSources);
        Assert.Equal((_tenantId, "Church group", true), (stored.TenantId, stored.Name, stored.IsActive));
    }

    [Theory]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task Create_rejects_a_blank_name(string? name)
    {
        var result = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = name! }, CancellationToken.None);

        Assert.Equal("Enter a name.", Refusal<ReferralSourceDto>(Assert.IsType<BadRequestObjectResult>(result.Result)));
        Assert.Empty(Db().ReferralSources);
    }

    [Fact]
    public async Task Create_rejects_a_name_over_100_characters_and_accepts_exactly_100()
    {
        var over = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = new string('x', 101) }, CancellationToken.None);
        var exact = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = new string('y', 100) }, CancellationToken.None);

        Assert.Equal("Use 100 characters or fewer.", Refusal<ReferralSourceDto>(Assert.IsType<BadRequestObjectResult>(over.Result)));
        Assert.Equal(100, Data<ReferralSourceDto>(exact.Result).Name.Length);
    }

    [Fact]
    public async Task Create_rejects_a_case_insensitive_duplicate_with_409_but_allows_the_same_name_in_another_tenant()
    {
        Seed(_tenantId, "Hospital"); Seed(_otherTenantId, "GP");

        var dup = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = " hospital " }, CancellationToken.None);
        var fine = await Controller(_tenantId).Create(new CreateReferralSourceDto { Name = "GP" }, CancellationToken.None);

        Assert.Equal("That source is already on the list.", Refusal<ReferralSourceDto>(Assert.IsType<ConflictObjectResult>(dup.Result)));
        Assert.Equal("GP", Data<ReferralSourceDto>(fine.Result).Name);
    }

    [Fact]
    public async Task Create_without_tenant_context_is_400()
    {
        var result = await Controller(null, superAdmin: true, role: "SuperAdmin").Create(new CreateReferralSourceDto { Name = "Hospital" }, CancellationToken.None);

        Assert.Equal("A tenant context is required.", Refusal<ReferralSourceDto>(Assert.IsType<BadRequestObjectResult>(result.Result)));
        Assert.Empty(Db().ReferralSources);
    }

    [Fact]
    public async Task Update_renames_and_deactivates()
    {
        var row = Seed(_tenantId, "Hospital");

        var renamed = await Controller(_tenantId).Update(row.Id, new UpdateReferralSourceDto { Name = "Public hospital", IsActive = true }, CancellationToken.None);
        var hidden = await Controller(_tenantId).Update(row.Id, new UpdateReferralSourceDto { Name = "Public hospital", IsActive = false }, CancellationToken.None);

        Assert.Equal("Public hospital", Data<ReferralSourceDto>(renamed.Result).Name);
        Assert.False(Data<ReferralSourceDto>(hidden.Result).IsActive);
        Assert.False(Assert.Single(Db().ReferralSources).IsActive);
    }

    [Fact]
    public async Task Update_to_the_name_of_another_source_is_409_but_to_its_own_name_in_another_case_is_fine()
    {
        var row = Seed(_tenantId, "Hospital"); Seed(_tenantId, "GP");

        var clash = await Controller(_tenantId).Update(row.Id, new UpdateReferralSourceDto { Name = "gp", IsActive = true }, CancellationToken.None);
        var recase = await Controller(_tenantId).Update(row.Id, new UpdateReferralSourceDto { Name = "HOSPITAL", IsActive = true }, CancellationToken.None);

        Assert.IsType<ConflictObjectResult>(clash.Result);
        Assert.Equal("HOSPITAL", Data<ReferralSourceDto>(recase.Result).Name);
    }

    [Fact]
    public async Task Update_other_tenants_source_is_404_even_for_a_SuperAdmin_viewing_as_this_tenant()
    {
        var theirs = Seed(_otherTenantId, "Their source");

        var plain = await Controller(_tenantId).Update(theirs.Id, new UpdateReferralSourceDto { Name = "Mine now", IsActive = false }, CancellationToken.None);
        var superAdmin = await Controller(_tenantId, superAdmin: true, role: "SuperAdmin").Update(theirs.Id, new UpdateReferralSourceDto { Name = "Mine now", IsActive = false }, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(plain.Result);
        Assert.IsType<NotFoundObjectResult>(superAdmin.Result);
        var stored = Assert.Single(Db().ReferralSources);
        Assert.Equal(("Their source", true), (stored.Name, stored.IsActive));
    }

    [Fact]
    public async Task Update_without_tenant_context_is_400()
    {
        var row = Seed(_tenantId, "Hospital");

        var result = await Controller(null, superAdmin: true, role: "SuperAdmin").Update(row.Id, new UpdateReferralSourceDto { Name = "x", IsActive = true }, CancellationToken.None);

        Assert.Equal("A tenant context is required.", Refusal<ReferralSourceDto>(Assert.IsType<BadRequestObjectResult>(result.Result)));
    }
}
