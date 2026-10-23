using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>The Payroll page admits Coordinators to read; only an Admin (or SuperAdmin) may queue. No action is anonymous.</summary>
public class EmploymentHeroPayrollControllerAuthorizationTests
{
    private static readonly Type Type = typeof(EmploymentHeroPayrollController);

    // Every [Authorize(Roles = ...)] on the class and on the action must admit the role (ASP.NET Core requires all of them).
    private static bool Admits(string action, string role)
    {
        var attrs = Type.GetCustomAttributes<AuthorizeAttribute>(true)
            .Concat(Type.GetMethod(action)!.GetCustomAttributes<AuthorizeAttribute>(true))
            .Where(a => a.Roles != null).ToList();
        Assert.NotEmpty(attrs);
        return attrs.All(a => a.Roles!.Split(',').Select(r => r.Trim()).Contains(role));
    }

    [Theory]
    [InlineData("SuperAdmin", true, true)]
    [InlineData("Admin", true, true)]
    [InlineData("Coordinator", true, false)]
    [InlineData("SupportWorker", false, false)]
    [InlineData("ReadOnly", false, false)]
    public void Reading_admits_Coordinators_and_Send_missing_does_not(string role, bool reads, bool queues)
    {
        Assert.Equal(reads, Admits(nameof(EmploymentHeroPayrollController.Periods), role));
        Assert.Equal(reads, Admits(nameof(EmploymentHeroPayrollController.Check), role));
        Assert.Equal(queues, Admits(nameof(EmploymentHeroPayrollController.SendMissing), role));
    }

    [Fact]
    public void Nothing_on_the_controller_allows_anonymous_callers()
    {
        Assert.Empty(Type.GetCustomAttributes<AllowAnonymousAttribute>(true));
        Assert.All(Type.GetMethods(), m => Assert.Empty(m.GetCustomAttributes<AllowAnonymousAttribute>(true)));
    }
}
