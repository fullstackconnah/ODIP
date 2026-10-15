using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>Only an Admin, or a SuperAdmin (who must also be viewing as the organisation), reaches the Employment Hero card's API. No action is anonymous.</summary>
public class EmploymentHeroControllerAuthorizationTests
{
    private static readonly string[] Actions = typeof(EmploymentHeroController)
        .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => m.Name).ToArray();

    // Every [Authorize(Roles = ...)] on the class and on the action must admit the role (ASP.NET Core requires all of them).
    private static bool Admits(string action, string role)
    {
        var type = typeof(EmploymentHeroController);
        var attrs = type.GetCustomAttributes<AuthorizeAttribute>(true)
            .Concat(type.GetMethod(action)!.GetCustomAttributes<AuthorizeAttribute>(true))
            .Where(a => a.Roles != null)
            .ToList();
        Assert.NotEmpty(attrs);
        return attrs.All(a => a.Roles!.Split(',').Select(r => r.Trim()).Contains(role));
    }

    [Theory]
    [InlineData("SuperAdmin", true)]
    [InlineData("Admin", true)]
    [InlineData("Coordinator", false)]
    [InlineData("SupportWorker", false)]
    [InlineData("ReadOnly", false)]
    public void Every_action_admits_only_Admin_and_SuperAdmin(string role, bool admitted)
    {
        Assert.NotEmpty(Actions);
        Assert.All(Actions, action => Assert.Equal(admitted, Admits(action, role)));
    }

    [Fact]
    public void Nothing_on_the_controller_allows_anonymous_callers()
    {
        var type = typeof(EmploymentHeroController);
        Assert.Empty(type.GetCustomAttributes<AllowAnonymousAttribute>(true));
        Assert.All(type.GetMethods(), m => Assert.Empty(m.GetCustomAttributes<AllowAnonymousAttribute>(true)));
    }
}
