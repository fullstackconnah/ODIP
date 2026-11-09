using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.Routing;
using Odip.Api.Controllers;
using Xunit;

namespace Odip.Tests.Audit;

/// <summary>The audit endpoints show who changed what, including deleted clinical records, so they are for Admin and SuperAdmin only. Checked as the framework evaluates the role strings.</summary>
public class AuditControllerRoleTests
{
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt() =>
        Assert.Equal(
            new[] { nameof(AuditController.GetAuditHistory), nameof(AuditController.GetDeleted) }.OrderBy(n => n, StringComparer.Ordinal),
            typeof(AuditController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any()).Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));

    [Theory]
    [InlineData("SuperAdmin", true), InlineData("Admin", true), InlineData("Coordinator", false), InlineData("SupportWorker", false), InlineData("ReadOnly", false)]
    public void TheDeletedList_AdmitsAdminAndSuperAdminOnly(string role, bool allowed) =>
        Assert.Equal(allowed, Allows(typeof(AuditController).GetMethod(nameof(AuditController.GetDeleted))!, role));
}
