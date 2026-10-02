using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// StaffController takes ICurrentTenant as an OPTIONAL constructor parameter (so the many tests that build it directly need not pass one), and the
/// refusal of another organisation's address depends on it: with none, every tenant's own domain would look foreign and every staff create at it would
/// be refused. Production gets it from the container, which is what these tests pin: the controller is activated the way MVC activates it
/// (<see cref="ActivatorUtilities"/>), from the registrations Program.cs makes (the REAL <see cref="CurrentTenant"/> reading the caller's tenant claim),
/// and the caller's own tenant is the one it uses. The one registration that differs from Program.cs is IFirebaseUserService, which Program.cs leaves
/// out on purpose and this test replaces with a mock so nothing reaches Firebase.
/// </summary>
public class StaffControllerActivationTests
{
    private const string OwnDomain = "acme.example.com";
    private const string OtherDomain = "other.example.org";

    private sealed class Host : IAsyncDisposable
    {
        public required ServiceProvider Provider { get; init; }
        public required IServiceScope Scope { get; init; }
        public required Guid OwnTenantId { get; init; }
        public required StaffController Controller { get; init; }
        public OdipDbContext Db => Scope.ServiceProvider.GetRequiredService<OdipDbContext>();

        public async ValueTask DisposeAsync()
        {
            Scope.Dispose();
            await Provider.DisposeAsync();
        }
    }

    private static async Task<Host> ActivatedForACoordinatorOfAcme()
    {
        var ownTenantId = Guid.NewGuid();
        var http = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim("tenant_id", ownTenantId.ToString()), new Claim(ClaimTypes.Role, "Coordinator"), new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())], "Test")),
        };
        var databaseName = Guid.NewGuid().ToString();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHttpContextAccessor>(new HttpContextAccessor { HttpContext = http });
        services.AddScoped<ICurrentTenant, CurrentTenant>();
        services.AddDbContext<OdipDbContext>(options => options.UseInMemoryDatabase(databaseName));
        services.AddScoped<IStaffAvailabilityItemsQuery, StaffAvailabilityItemsQuery>();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().Build());
        services.AddSingleton(new Mock<IFirebaseUserService>().Object);
        var provider = services.BuildServiceProvider();
        var scope = provider.CreateScope();

        var db = scope.ServiceProvider.GetRequiredService<OdipDbContext>();
        db.Tenants.AddRange(
            new Tenant { Id = ownTenantId, Name = "Acme Support", EmailDomain = OwnDomain, IsActive = true, CreatedAt = DateTime.UtcNow },
            new Tenant { Id = Guid.NewGuid(), Name = "Other Care", EmailDomain = OtherDomain, IsActive = true, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();

        var controller = ActivatorUtilities.CreateInstance<StaffController>(scope.ServiceProvider);
        controller.ControllerContext = new ControllerContext { HttpContext = http };
        return new Host { Provider = provider, Scope = scope, OwnTenantId = ownTenantId, Controller = controller };
    }

    private static CreateStaffDto StaffAt(string email) => new()
    {
        FirstName = "Sam", LastName = "Staff", Email = email, Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    };

    [Fact]
    public async Task The_container_gives_the_controller_the_callers_tenant_so_staff_at_their_own_domain_are_created_in_that_tenant()
    {
        await using var host = await ActivatedForACoordinatorOfAcme();

        var result = await host.Controller.Create(StaffAt($"new.hire@{OwnDomain}"), CancellationToken.None);

        Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(host.OwnTenantId, (await host.Db.Users.SingleAsync()).TenantId);
    }

    [Fact]
    public async Task The_container_gives_it_the_same_tenant_for_the_refusal_of_another_organisations_domain()
    {
        await using var host = await ActivatedForACoordinatorOfAcme();

        var result = await host.Controller.Create(StaffAt($"new.hire@{OtherDomain}"), CancellationToken.None);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal("That address belongs to another organisation on ODIP.", Assert.Single(Assert.IsType<ApiResponse<StaffDetailDto>>(badRequest.Value).Errors!));
        Assert.Empty(await host.Db.Users.ToListAsync());
    }
}
