using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>Signing snapshot and evidence writes are coordinator actions: SupportWorker and ReadOnly must get 403.</summary>
public class ServiceAgreementDraftsControllerRoleTests
{
    private static readonly string[] Writers = ["Admin", "Coordinator", "SuperAdmin"];

    public static TheoryData<string> SigningWriteActions => new()
    {
        nameof(ServiceAgreementDraftsController.CreateSigningSnapshot),
        nameof(ServiceAgreementDraftsController.SubmitSigningEvidence),
    };

    private static bool Allows(string action, string role)
    {
        var attr = typeof(ServiceAgreementDraftsController).GetMethod(action)!
            .GetCustomAttributes(typeof(AuthorizeAttribute), false).Cast<AuthorizeAttribute>().Single();
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        return attr.Roles!.Split(',').Any(r => principal.IsInRole(r.Trim()));
    }

    [Theory, MemberData(nameof(SigningWriteActions))]
    public void SigningWrites_AreRestrictedToAdminCoordinatorSuperAdmin(string action)
    {
        foreach (var role in Writers) Assert.True(Allows(action, role), role);
        Assert.False(Allows(action, "SupportWorker"));
        Assert.False(Allows(action, "ReadOnly"));
    }

    [Theory]
    [InlineData("/api/v1/participants/11111111-1111-1111-1111-111111111111/service-agreement-drafts/signing-snapshots")]
    [InlineData("/api/v1/participants/11111111-1111-1111-1111-111111111111/service-agreement-drafts/signing-snapshots/22222222-2222-2222-2222-222222222222/evidence")]
    public async Task ReadOnlyUser_PostingToSigningEndpoints_Gets403(string path)
    {
        var reached = false;
        var middleware = new ReadOnlyMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "ReadOnly")], "test"))
        };
        context.Request.Method = "POST"; context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        await middleware.InvokeAsync(context);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }
}
