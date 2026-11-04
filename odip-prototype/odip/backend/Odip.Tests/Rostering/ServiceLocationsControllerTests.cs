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

namespace Odip.Tests.Rostering;

/// <summary>Settings > Organisation > Service locations: saved places with a pin, a radius and an optional time zone. Per organisation, hidden rather than deleted. The roles' 403 is in <see cref="ServiceLocationsHttpTests"/>.</summary>
public class ServiceLocationsControllerTests
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
    private ServiceLocationsController Controller(Guid? tenantId, bool superAdmin = false)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(tenantId);
        tenant.SetupGet(t => t.IsSuperAdmin).Returns(superAdmin);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Admin")], "test");
        return new ServiceLocationsController(Db(tenantId, superAdmin), tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private ServiceLocation Seed(Guid tenantId, string name, bool active = true)
    {
        using var db = Db();
        var row = new ServiceLocation { Id = Guid.NewGuid(), TenantId = tenantId, Name = name, IsActive = active, Latitude = -33.8688m, Longitude = 151.2093m };
        db.ServiceLocations.Add(row);
        db.SaveChanges();
        return row;
    }

    private static SaveServiceLocationDto Valid(string name = "Southside Library") => new() { Name = name, Address = "1 High St", Latitude = -33.868820m, Longitude = 151.209290m, RadiusMetres = 200 };

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static string Refusal<T>(ObjectResult result) => Assert.Single(Assert.IsType<ApiResponse<T>>(result.Value).Errors!);

    [Fact]
    public async Task GetAll_returns_only_this_tenants_places_active_first_then_by_name()
    {
        Seed(_tenantId, "Hub"); Seed(_tenantId, "Annex"); Seed(_tenantId, "Closed centre", active: false); Seed(_otherTenantId, "Other tenant's place");

        var rows = Data<List<ServiceLocationDto>>((await Controller(_tenantId).GetAll(CancellationToken.None)).Result);

        Assert.Equal(["Annex", "Hub", "Closed centre"], rows.Select(r => r.Name));
        Assert.Equal([true, true, false], rows.Select(r => r.IsActive));
    }

    [Fact]
    public async Task GetAll_for_a_SuperAdmin_viewing_as_one_tenant_still_returns_only_that_tenant()
    {
        Seed(_tenantId, "Hub"); Seed(_otherTenantId, "Other tenant's place");

        var rows = Data<List<ServiceLocationDto>>((await Controller(_tenantId, superAdmin: true).GetAll(CancellationToken.None)).Result);

        Assert.Equal(["Hub"], rows.Select(r => r.Name));
    }

    [Fact]
    public async Task Create_saves_a_trimmed_place_for_the_callers_tenant()
    {
        var dto = Valid("  Southside Library  ") with { TimeZoneId = "Australia/Perth", RadiusMetres = 350 };

        var saved = Data<ServiceLocationDto>((await Controller(_tenantId).Create(dto, CancellationToken.None)).Result);

        Assert.Equal("Southside Library", saved.Name);
        Assert.True(saved.IsActive);
        var row = await Db().ServiceLocations.SingleAsync();
        Assert.Equal(_tenantId, row.TenantId);
        Assert.Equal((-33.868820m, 151.209290m, 350, "Australia/Perth"), (row.Latitude, row.Longitude, row.RadiusMetres, row.TimeZoneId));
    }

    [Fact]
    public async Task Create_treats_a_blank_address_and_zone_as_none()
    {
        var saved = Data<ServiceLocationDto>((await Controller(_tenantId).Create(Valid() with { Address = "  ", TimeZoneId = "" }, CancellationToken.None)).Result);

        Assert.Null(saved.Address);
        Assert.Null(saved.TimeZoneId);
    }

    [Theory]
    [InlineData("", 0, 0, 200, null, "Enter a name.")]
    [InlineData("Hub", 90.5, 0, 200, null, "Latitude must be between -90 and 90.")]
    [InlineData("Hub", -90.5, 0, 200, null, "Latitude must be between -90 and 90.")]
    [InlineData("Hub", 0, 180.5, 200, null, "Longitude must be between -180 and 180.")]
    [InlineData("Hub", 0, 0, 49, null, "Use a check-in distance from 50 to 2000 metres.")]
    [InlineData("Hub", 0, 0, 2001, null, "Use a check-in distance from 50 to 2000 metres.")]
    [InlineData("Hub", 0, 0, 200, "Europe/London", "Pick one of the Australian time zones.")]
    public async Task Create_refuses_a_bad_field_with_a_400_and_writes_nothing(string name, double lat, double lon, int radius, string? zone, string message)
    {
        var dto = new SaveServiceLocationDto { Name = name, Latitude = (decimal)lat, Longitude = (decimal)lon, RadiusMetres = radius, TimeZoneId = zone };

        var result = Assert.IsType<BadRequestObjectResult>((await Controller(_tenantId).Create(dto, CancellationToken.None)).Result);

        Assert.Equal(message, Refusal<ServiceLocationDto>(result));
        Assert.Empty(await Db().ServiceLocations.ToListAsync());
    }

    [Fact]
    public async Task Create_and_update_refuse_a_body_without_a_pin_instead_of_saving_0_0()
    {
        var noPin = Valid() with { Latitude = null, Longitude = null };
        var created = Assert.IsType<BadRequestObjectResult>((await Controller(_tenantId).Create(noPin, CancellationToken.None)).Result);
        Assert.Equal("Pick the place on the map.", Refusal<ServiceLocationDto>(created));
        Assert.Empty(await Db().ServiceLocations.ToListAsync());

        var row = Seed(_tenantId, "Hub");
        Assert.IsType<BadRequestObjectResult>((await Controller(_tenantId).Update(row.Id, Valid("Hub") with { Longitude = null }, CancellationToken.None)).Result);
        Assert.Equal(-33.8688m, (await Db().ServiceLocations.SingleAsync()).Latitude);
    }

    [Fact]
    public async Task Create_refuses_a_name_over_100_characters_and_an_address_over_300()
    {
        Assert.IsType<BadRequestObjectResult>((await Controller(_tenantId).Create(Valid(new string('a', 101)), CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await Controller(_tenantId).Create(Valid() with { Address = new string('a', 301) }, CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Create_without_an_organisation_is_a_400()
    {
        Assert.IsType<BadRequestObjectResult>((await Controller(null, superAdmin: true).Create(Valid(), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Create_refuses_a_name_an_active_place_already_has_ignoring_case_but_allows_an_archived_ones_name()
    {
        Seed(_tenantId, "Hub"); Seed(_tenantId, "Old annex", active: false); Seed(_otherTenantId, "Elsewhere");

        Assert.IsType<ConflictObjectResult>((await Controller(_tenantId).Create(Valid("  hUB "), CancellationToken.None)).Result);
        Data<ServiceLocationDto>((await Controller(_tenantId).Create(Valid("Old annex"), CancellationToken.None)).Result);
        Data<ServiceLocationDto>((await Controller(_tenantId).Create(Valid("Elsewhere"), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Update_replaces_every_field_of_this_tenants_place()
    {
        var row = Seed(_tenantId, "Hub");

        var saved = Data<ServiceLocationDto>((await Controller(_tenantId).Update(row.Id, Valid("Hub north") with { TimeZoneId = "Australia/Darwin", RadiusMetres = 500 }, CancellationToken.None)).Result);

        Assert.Equal(("Hub north", 500, "Australia/Darwin"), (saved.Name, saved.RadiusMetres, saved.TimeZoneId));
    }

    [Fact]
    public async Task Update_keeping_its_own_name_is_not_a_duplicate()
    {
        var row = Seed(_tenantId, "Hub");

        Data<ServiceLocationDto>((await Controller(_tenantId).Update(row.Id, Valid("hub"), CancellationToken.None)).Result);
    }

    [Fact]
    public async Task Update_and_archive_of_another_tenants_place_are_404_even_for_a_SuperAdmin_viewing_as_the_caller_tenant()
    {
        var foreign = Seed(_otherTenantId, "Elsewhere");

        Assert.IsType<NotFoundObjectResult>((await Controller(_tenantId, superAdmin: true).Update(foreign.Id, Valid(), CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await Controller(_tenantId, superAdmin: true).Archive(foreign.Id, CancellationToken.None)).Result);
        Assert.True((await Db().ServiceLocations.SingleAsync()).IsActive);
    }

    [Fact]
    public async Task Archive_hides_the_place_without_deleting_it()
    {
        var row = Seed(_tenantId, "Hub");

        var saved = Data<ServiceLocationDto>((await Controller(_tenantId).Archive(row.Id, CancellationToken.None)).Result);

        Assert.False(saved.IsActive);
        Assert.False((await Db().ServiceLocations.SingleAsync()).IsActive);
    }
}
