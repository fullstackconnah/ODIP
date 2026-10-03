using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Application.DTOs;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// Money never reaches SupportWorker or ReadOnly: every endpoint of the plan budget controller is admitted to SuperAdmin, Admin and Coordinator, reads included, and
/// deleting a plan to SuperAdmin and Admin only. The role strings are checked as the framework evaluates them (the class's roles AND the action's), and ReadOnly's
/// writes are refused by the middleware before they reach a controller.
/// </summary>
public class FundingRoleTests
{
    private static readonly string[] Staff = ["SuperAdmin", "Admin", "Coordinator"];

    /// <summary>The framework's rule: every [Authorize] on the class and on the action must admit the role.</summary>
    private static bool Allows(MethodInfo action, string role)
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = action.DeclaringType!.GetCustomAttributes<AuthorizeAttribute>(true).Concat(action.GetCustomAttributes<AuthorizeAttribute>(true));
        return attributes.All(a => string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())));
    }

    /// <summary>The attribute keeps its limit in a private field.</summary>
    private static long LimitOf(RequestSizeLimitAttribute attribute) =>
        (long)typeof(RequestSizeLimitAttribute).GetField("_bytes", BindingFlags.Instance | BindingFlags.NonPublic)!.GetValue(attribute)!;

    private static IEnumerable<MethodInfo> Actions(Type controller) =>
        controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Where(m => m.GetCustomAttributes<HttpMethodAttribute>().Any());

    public static TheoryData<string> ParticipantFundingActions
    {
        get
        {
            var data = new TheoryData<string>();
            foreach (var action in Actions(typeof(ParticipantFundingController))) data.Add(action.Name);
            return data;
        }
    }

    [Fact]
    public void TheControllerHasExactlyTheDocumentedActions_SoANewOneFailsHereUntilSomebodyDecidesWhoMayCallIt()
    {
        Assert.Equal(
            new[]
            {
                nameof(ParticipantFundingController.ApplyDatesToProfile), nameof(ParticipantFundingController.BillingSourcesHint), nameof(ParticipantFundingController.CreatePlan),
                nameof(ParticipantFundingController.DeletePlan), nameof(ParticipantFundingController.Plans), nameof(ParticipantFundingController.UpdatePlan),
            },
            Actions(typeof(ParticipantFundingController)).Select(m => m.Name).OrderBy(n => n, StringComparer.Ordinal));
    }

    [Theory, MemberData(nameof(ParticipantFundingActions))]
    public void EveryPlanBudgetAction_IsAdmittedToSuperAdminAdminAndCoordinatorOnly_ReadsIncluded(string name)
    {
        var action = typeof(ParticipantFundingController).GetMethod(name)!;

        if (name == nameof(ParticipantFundingController.DeletePlan))
        {
            Assert.True(Allows(action, "SuperAdmin"));
            Assert.True(Allows(action, "Admin"));
            Assert.False(Allows(action, "Coordinator"));
        }
        else
        {
            foreach (var role in Staff) Assert.True(Allows(action, role), role);
        }

        Assert.False(Allows(action, "SupportWorker"));
        Assert.False(Allows(action, "ReadOnly"));
    }

    [Fact]
    public void TheClassItselfCarriesTheRoles_SoAnActionAddedWithoutAnAttributeIsStillClosed()
    {
        var attribute = Assert.Single(typeof(ParticipantFundingController).GetCustomAttributes<AuthorizeAttribute>(false));

        Assert.Equal("SuperAdmin,Admin,Coordinator", attribute.Roles);
    }

    [Fact]
    public void EveryWrite_IsRateLimitedOnTheApiPolicy_AndThePlanBodiesAreCappedAt256KiB()
    {
        foreach (var action in Actions(typeof(ParticipantFundingController)).Where(m => !m.GetCustomAttributes<HttpGetAttribute>().Any()))
        {
            Assert.Equal("api", Assert.Single(action.GetCustomAttributes<EnableRateLimitingAttribute>()).PolicyName);
        }

        foreach (var name in new[] { nameof(ParticipantFundingController.CreatePlan), nameof(ParticipantFundingController.UpdatePlan) })
        {
            Assert.Equal(262_144L, LimitOf(Assert.Single(typeof(ParticipantFundingController).GetMethod(name)!.GetCustomAttributes<RequestSizeLimitAttribute>())));
        }
    }

    [Fact]
    public void TheSupportCategoryList_IsOpenToEverySignedInRole_AndTheSettingsFollowTheProviderSettingsPattern()
    {
        var categories = typeof(FundingController).GetMethod(nameof(FundingController.PaceCategories))!;
        var read = typeof(FundingController).GetMethod(nameof(FundingController.GetSettings))!;
        var write = typeof(FundingController).GetMethod(nameof(FundingController.PutSettings))!;

        foreach (var role in new[] { "SuperAdmin", "Admin", "Coordinator", "SupportWorker", "ReadOnly" }) Assert.True(Allows(categories, role), role);
        Assert.NotEmpty(typeof(FundingController).GetCustomAttributes<AuthorizeAttribute>(false));   // anonymous callers are still refused

        foreach (var role in Staff) Assert.True(Allows(read, role), role);
        Assert.False(Allows(read, "SupportWorker"));
        Assert.False(Allows(read, "ReadOnly"));

        Assert.True(Allows(write, "SuperAdmin"));
        Assert.True(Allows(write, "Admin"));
        Assert.False(Allows(write, "Coordinator"));
        Assert.False(Allows(write, "SupportWorker"));
        Assert.False(Allows(write, "ReadOnly"));
    }

    [Theory]
    [InlineData("POST", "/api/v1/participants/11111111-1111-1111-1111-111111111111/funding/plans")]
    [InlineData("PUT", "/api/v1/participants/11111111-1111-1111-1111-111111111111/funding/plans/22222222-2222-2222-2222-222222222222")]
    [InlineData("DELETE", "/api/v1/participants/11111111-1111-1111-1111-111111111111/funding/plans/22222222-2222-2222-2222-222222222222")]
    [InlineData("POST", "/api/v1/participants/11111111-1111-1111-1111-111111111111/funding/plans/22222222-2222-2222-2222-222222222222/apply-dates-to-profile")]
    [InlineData("PUT", "/api/v1/funding/settings")]
    public async Task AReadOnlyUsersWrites_AreRefusedWith403_BeforeTheyReachTheController(string method, string path)
    {
        var reached = false;
        var middleware = new ReadOnlyMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "ReadOnly")], "test")) };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(context);

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, context.Response.StatusCode);
    }

    // ── Money is not on the participant ─────────────────────────────────────

    [Theory]
    [InlineData(typeof(ParticipantDetailDto))]
    [InlineData(typeof(ParticipantListDto))]
    [InlineData(typeof(PatchNdisPlanDto))]
    [InlineData(typeof(CreateParticipantDto))]
    [InlineData(typeof(UpdateParticipantDto))]
    public void TheParticipantDtosAndThePatchGroup_CarryNoBudgetFigureAndNoPlanRecord(Type dto)
    {
        // Patch groups are atomic: a figure inside one would be wiped by a stale client saving the group, and the participant DTO is read by every role.
        var offenders = dto.GetProperties()
            .Where(p => p.Name.Contains("Budget", StringComparison.OrdinalIgnoreCase) || p.Name.Contains("SetAside", StringComparison.OrdinalIgnoreCase)
                || p.Name.Contains("FundingPlan", StringComparison.OrdinalIgnoreCase) || p.Name.Contains("FundingPool", StringComparison.OrdinalIgnoreCase)
                || p.PropertyType.Name.StartsWith("FundingPlan", StringComparison.Ordinal) || p.PropertyType.Name.StartsWith("FundingPool", StringComparison.Ordinal))
            .Select(p => p.Name)
            .ToList();

        Assert.Empty(offenders);
    }
}
