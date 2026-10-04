using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// Signing snapshot and evidence writes are coordinator actions: SupportWorker and ReadOnly must get 403. So are the reads: an agreement draft carries money (unit prices, totals, the pricing answer, the
/// PDF's figures), and money is never visible to SupportWorker or ReadOnly (Claims and Billing refuse them for every request, reads included).
/// </summary>
public class ServiceAgreementDraftsControllerRoleTests
{
    private static readonly string[] Writers = ["Admin", "Coordinator", "SuperAdmin"];

    public static TheoryData<string> SigningWriteActions => new()
    {
        nameof(ServiceAgreementDraftsController.CreateSigningSnapshot),
        nameof(ServiceAgreementDraftsController.SubmitSigningEvidence),
    };

    private static readonly string[] PriceReads =
    [
        nameof(ServiceAgreementDraftsController.List),
        nameof(ServiceAgreementDraftsController.Get),
        nameof(ServiceAgreementDraftsController.Pdf),
        // The preview of approving a revision (phase D): its reasons repeat what the stored pricing flagged and its counts say what the plan makes, for the roles that may approve.
        nameof(ServiceAgreementDraftsController.ApprovalPreview),
    ];

    public static TheoryData<string> PriceReadActions
    {
        get
        {
            var data = new TheoryData<string>();
            foreach (var name in PriceReads) data.Add(name);
            return data;
        }
    }

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

    [Theory, MemberData(nameof(PriceReadActions))]
    public void ReadsOfPrices_AreRestrictedToAdminCoordinatorSuperAdmin(string action)
    {
        foreach (var role in Writers) Assert.True(Allows(action, role), role);
        Assert.False(Allows(action, "SupportWorker"));
        Assert.False(Allows(action, "ReadOnly"));
    }

    [Fact]
    public void NoGetOnTheController_IsLeftOpenToEveryRole_SoANewReadOfPricesCannotBeAddedOpen()
    {
        var gets = typeof(ServiceAgreementDraftsController).GetMethods()
            .Where(m => m.GetCustomAttributes(typeof(HttpGetAttribute), false).Length > 0).Select(m => m.Name).OrderBy(name => name).ToList();

        // The four above are all of them: a new GET fails here until somebody has decided who may read what it returns.
        Assert.Equal(PriceReads.OrderBy(name => name), gets);
        foreach (var name in gets) Assert.False(Allows(name, "SupportWorker") || Allows(name, "ReadOnly"), name);
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
