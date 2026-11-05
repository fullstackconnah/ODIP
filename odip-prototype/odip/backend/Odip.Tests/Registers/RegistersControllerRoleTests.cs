using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Registers;

/// <summary>A register names people, so no route reaches SupportWorker or ReadOnly, and the complaints register narrows to Admin and SuperAdmin. Checked as the framework evaluates the role strings.</summary>
public class RegistersControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(RegistersController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt()
    {
        Assert.Equal(
            new[]
            {
                nameof(RegistersController.Complaints), nameof(RegistersController.Incidents), nameof(RegistersController.RestrictivePractices),
                nameof(RegistersController.Risks), nameof(RegistersController.StaffCredentials),
            },
            Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Theory]
    [InlineData(nameof(RegistersController.Incidents)), InlineData(nameof(RegistersController.RestrictivePractices))]
    [InlineData(nameof(RegistersController.Risks)), InlineData(nameof(RegistersController.StaffCredentials))]
    public void FourRegisters_AdmitAdminCoordinatorAndSuperAdminOnly(string name)
    {
        var action = typeof(RegistersController).GetMethod(name)!;
        foreach (var role in new[] { "SuperAdmin", "Admin", "Coordinator" }) Assert.True(Allows(action, role), role);
        foreach (var role in new[] { "SupportWorker", "ReadOnly" }) Assert.False(Allows(action, role), role);
    }

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", true), InlineData("Coordinator", false), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void Complaints_AdmitsAdminAndSuperAdminOnly(string role, bool allowed) =>
        Assert.Equal(allowed, Allows(typeof(RegistersController).GetMethod(nameof(RegistersController.Complaints))!, role));

    [Fact]
    public void TheClassCarriesTheRoles_AndOnlyComplaintsNarrowsThem()
    {
        Assert.Equal("Admin,Coordinator,SuperAdmin", Assert.Single(typeof(RegistersController).GetCustomAttributes<AuthorizeAttribute>()).Roles);
        Assert.All(Actions(), a => Assert.Empty(a.GetCustomAttributes<AllowAnonymousAttribute>()));
        var narrowed = Assert.Single(Actions(), a => a.GetCustomAttributes<AuthorizeAttribute>().Any());
        Assert.Equal(nameof(RegistersController.Complaints), narrowed.Name);
        Assert.Equal("Admin,SuperAdmin", Assert.Single(narrowed.GetCustomAttributes<AuthorizeAttribute>()).Roles);
    }
}
