using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// The only setting is the qualification warning window, a number every office role's Qualifications, Staff and Dashboard figures
/// depend on. ReadOnly may read it (it used to get 403 and silently count with a 30-day default); only Admin and SuperAdmin may change it, and SupportWorker reads neither.
/// </summary>
public class SettingsControllerAuthorizationTests
{
    // Every [Authorize(Roles = ...)] on the class and on the action must admit the role (ASP.NET Core requires all of them).
    private static bool Admits(string action, string role)
    {
        var type = typeof(SettingsController);
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
    [InlineData("Coordinator", true)]
    [InlineData("ReadOnly", true)]
    [InlineData("SupportWorker", false)]
    public void Get_admits_the_office_roles_including_ReadOnly(string role, bool admitted)
        => Assert.Equal(admitted, Admits(nameof(SettingsController.Get), role));

    // The qualification window is an organisation setting: only an Admin (or a SuperAdmin acting for the organisation) changes it.
    // A Coordinator reads it in Settings with the section locked (settings redesign PR 1); it could write it until then.
    [Theory]
    [InlineData("SuperAdmin", true)]
    [InlineData("Admin", true)]
    [InlineData("Coordinator", false)]
    [InlineData("ReadOnly", false)]
    [InlineData("SupportWorker", false)]
    public void Update_is_Admin_and_SuperAdmin_only(string role, bool admitted)
        => Assert.Equal(admitted, Admits(nameof(SettingsController.Update), role));
}
