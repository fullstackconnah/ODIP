using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>Public holidays are shared across organisations, so writing them (add, delete, sync) is SuperAdmin only. Checked as the framework evaluates the role strings.</summary>
public class PublicHolidaysRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static List<MethodInfo> Writes() => typeof(PublicHolidaysController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
        .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any(a => a.HttpMethods.Any(h => h != "GET"))).ToList();

    [Fact]
    public void ThereAreExactlyThreeWrites_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt() => Assert.Equal(3, Writes().Count);

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", false), InlineData("Coordinator", false), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void TheWrites_AdmitSuperAdminOnly(string role, bool allowed) => Assert.All(Writes(), m => Assert.Equal(allowed, Allows(m, role)));
}
