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

namespace Odip.Tests.Controllers;

/// <summary>H5-2: a changed ABN is digits and spaces. An unchanged echo of a stored value saves whatever it is, because every settings section sends the whole row.</summary>
public class ProviderSettingsAbnTests
{
    private static readonly Guid TenantA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private const string Refusal = "Enter the ABN as numbers only, like 12 345 678 901.";

    private static (OdipDbContext db, ProviderSettingsController controller) Create(string? storedAbn)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        if (storedAbn != null)
        {
            db.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = TenantA, RegistrationNumber = "REG", ABN = storedAbn, OrganisationName = "Org", Address = "1 St", State = "NSW" });
            db.SaveChanges();
        }
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, "Admin")], "Test"));
        return (db, new ProviderSettingsController(db, tenant.Object) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = principal } } });
    }

    private static UpsertProviderSettingsDto Dto(string abn) => new() { RegistrationNumber = "REG", ABN = abn, OrganisationName = "Org", Address = "1 St", State = "NSW" };

    private static Task<string> StoredAbn(OdipDbContext db) => db.ProviderSettings.IgnoreQueryFilters().Where(s => s.TenantId == TenantA).Select(s => s.ABN).SingleAsync();

    [Theory]
    [InlineData("ABC")]
    [InlineData("12-345-678-901")]
    [InlineData("=1+1")]
    [InlineData("12 345 678 90a")]
    [InlineData("12\n345")]
    public async Task A_changed_ABN_with_other_characters_is_400_and_nothing_is_written(string abn)
    {
        var (db, controller) = Create("12345678901");
        using var _ = db;

        var result = await controller.Upsert(Dto(abn), CancellationToken.None);

        Assert.Equal(Refusal, Assert.IsType<ApiResponse<bool>>(Assert.IsType<BadRequestObjectResult>(result.Result).Value).Errors![0]);
        Assert.Equal("12345678901", await StoredAbn(db));
    }

    [Theory]
    [InlineData("12 345 678 901")]
    [InlineData("12345678901")]
    public async Task A_changed_ABN_of_digits_and_spaces_is_saved_as_typed(string abn)
    {
        var (db, controller) = Create("98765432109");
        using var _ = db;

        await controller.Upsert(Dto(abn), CancellationToken.None);

        Assert.Equal(abn, await StoredAbn(db));
    }

    [Fact]
    public async Task A_new_row_checks_the_typed_ABN()
    {
        var (db, controller) = Create(null);
        using var _ = db;

        var result = await controller.Upsert(Dto("ABC"), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task A_stored_ABN_that_fails_the_rule_still_saves_when_echoed_unchanged()
    {
        var (db, controller) = Create("ABC");
        using var _ = db;

        await controller.Upsert(Dto("ABC"), CancellationToken.None);

        Assert.Equal("ABC", await StoredAbn(db));
    }

    [Fact]
    public async Task A_stored_ABN_that_fails_the_rule_cannot_change_to_another_bad_value()
    {
        var (db, controller) = Create("ABC");
        using var _ = db;

        var result = await controller.Upsert(Dto("XYZ"), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("ABC", await StoredAbn(db));
    }
}
