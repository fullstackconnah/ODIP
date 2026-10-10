using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Security;

/// <summary>
/// The activity library is one table for every organisation (it has no organisation column), so writing it changes every organisation's activity picker. Until it becomes per organisation,
/// only a SuperAdmin may write it; reading it stays open to every signed-in user.
/// </summary>
public class ActivityLibraryRoleTests
{
    public static TheoryData<string> WriteActions => new()
    {
        nameof(ActivitiesController.Create),
        nameof(ActivitiesController.Update),
    };

    private static bool Allows(string action, string role)
    {
        var attr = typeof(ActivitiesController).GetMethod(action)!
            .GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>().Single();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        return attr.Roles!.Split(',').Any(r => principal.IsInRole(r.Trim()));
    }

    [Theory, MemberData(nameof(WriteActions))]
    public void Writes_AreRestrictedToSuperAdmin(string action)
    {
        Assert.True(Allows(action, "SuperAdmin"));
        foreach (var role in new[] { "Admin", "Coordinator", "SupportWorker", "ReadOnly" })
            Assert.False(Allows(action, role), role);
    }

    [Fact]
    public void Reads_StayOpenToEverySignedInUser()
    {
        Assert.Empty(typeof(ActivitiesController).GetMethod(nameof(ActivitiesController.GetAll))!.GetCustomAttributes(typeof(AuthorizeAttribute), false));
        Assert.Single(typeof(ActivitiesController).GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>(), a => a.Roles is null);
    }
}
