using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.DataRetention;

/// <summary>A purge is permanent, so only an organisation Admin may list or confirm one. SuperAdmin is refused too. Checked as the framework evaluates the role strings.</summary>
public class DataRetentionRoleTests
{
    private static readonly string[] Refused = ["SuperAdmin", "Coordinator", "SupportWorker", "ReadOnly"];

    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    private static IEnumerable<MethodInfo> Actions() =>
        typeof(DataRetentionController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    public static TheoryData<string, string, bool> Matrix
    {
        get
        {
            var data = new TheoryData<string, string, bool>();
            foreach (var action in Actions())
            {
                data.Add(action.Name, "Admin", true);
                foreach (var role in Refused) data.Add(action.Name, role, false);
            }
            return data;
        }
    }

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt() =>
        Assert.Equal(new[] { nameof(DataRetentionController.Due), nameof(DataRetentionController.Purge) }, Actions().Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));

    [Theory, MemberData(nameof(Matrix))]
    public void EveryAction_IsAdmittedToAnAdminOnly(string name, string role, bool allowed) =>
        Assert.Equal(allowed, Allows(typeof(DataRetentionController).GetMethod(name)!, role));

    [Fact]
    public void TheClassCarriesTheRole_AndNoActionWidensIt()
    {
        Assert.Equal("Admin", Assert.Single(typeof(DataRetentionController).GetCustomAttributes<AuthorizeAttribute>()).Roles);
        Assert.All(Actions(), a =>
        {
            Assert.Empty(a.GetCustomAttributes<AllowAnonymousAttribute>());
            Assert.Empty(a.GetCustomAttributes<AuthorizeAttribute>());
        });
    }
}
