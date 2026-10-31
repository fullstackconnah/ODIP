using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Complaints;

/// <summary>A complaint names people, so no route of the register (reads included) reaches SupportWorker or ReadOnly. Checked as the framework evaluates the role strings.</summary>
public class ComplaintsRoleTests
{
    private static readonly string[] Staff = ["SuperAdmin", "Admin", "Coordinator"];
    private static readonly string[] Others = ["SupportWorker", "ReadOnly"];

    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(ComplaintsController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    public static TheoryData<string, string, bool> Matrix
    {
        get
        {
            var data = new TheoryData<string, string, bool>();
            foreach (var action in Actions())
            {
                foreach (var role in Staff) data.Add(action.Name, role, true);
                foreach (var role in Others) data.Add(action.Name, role, false);
            }
            return data;
        }
    }

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt()
    {
        Assert.Equal(
            new[]
            {
                nameof(ComplaintsController.Archive), nameof(ComplaintsController.Create), nameof(ComplaintsController.Get),
                nameof(ComplaintsController.List), nameof(ComplaintsController.Restore), nameof(ComplaintsController.Update),
            },
            Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Theory, MemberData(nameof(Matrix))]
    public void EveryAction_IsAdmittedToTheOfficeRolesOnly(string name, string role, bool allowed) =>
        Assert.Equal(allowed, Allows(typeof(ComplaintsController).GetMethod(name)!, role));

    [Fact]
    public void TheClassCarriesTheRoles_AndNoActionWidensThem()
    {
        Assert.Equal("Admin,Coordinator,SuperAdmin", Assert.Single(typeof(ComplaintsController).GetCustomAttributes<AuthorizeAttribute>()).Roles);
        Assert.All(Actions(), a =>
        {
            Assert.Empty(a.GetCustomAttributes<AllowAnonymousAttribute>());
            Assert.Empty(a.GetCustomAttributes<AuthorizeAttribute>());
        });
    }
}
