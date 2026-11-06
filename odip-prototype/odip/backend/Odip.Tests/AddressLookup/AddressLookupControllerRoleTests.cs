using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.AddressLookup;

/// <summary>The address proxy spends the organisation's Google quota and sends typed text abroad, so it is for the roles that write addresses and nobody else. Checked as the framework evaluates the role strings.</summary>
public class AddressLookupControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(AddressLookupController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt() =>
        Assert.Equal(new[] { nameof(AddressLookupController.Details), nameof(AddressLookupController.Suggest) }, Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", true), InlineData("Coordinator", true), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void BothActions_AdmitAdminCoordinatorAndSuperAdminOnly(string role, bool allowed) =>
        Assert.All(Actions(), a => Assert.Equal(allowed, Allows(a, role)));

    [Fact]
    public void NoActionIsAnonymous() => Assert.All(Actions(), a => Assert.Empty(a.GetCustomAttributes<AllowAnonymousAttribute>()));
}
