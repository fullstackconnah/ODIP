using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.RestrictivePractices;

/// <summary>Monthly reports are compliance records: Admin, Coordinator and SuperAdmin only, for the reads as well as the lodge and undo.</summary>
public class RestrictivePracticeReportsControllerRoleTests
{
    [Fact]
    public void Class_IsAdminCoordinatorSuperAdminOnly()
    {
        var type = typeof(RestrictivePracticeReportsController);
        Assert.Equal("Admin,Coordinator,SuperAdmin", type.GetCustomAttribute<AuthorizeAttribute>()!.Roles);
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
            Assert.Null(method.GetCustomAttribute<AuthorizeAttribute>());
        }
    }

    [Fact]
    public void NoGetOnTheController_IsLeftOpenToEveryRole()
    {
        var gets = typeof(RestrictivePracticeReportsController).GetMethods()
            .Where(m => m.GetCustomAttributes(typeof(HttpGetAttribute), false).Length > 0).Select(m => m.Name).OrderBy(name => name).ToList();

        // A new GET fails here until somebody has decided who may read what it returns.
        Assert.Equal(["GetCsv", "GetLines"], gets);
        var roles = typeof(RestrictivePracticeReportsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',');
        Assert.DoesNotContain("SupportWorker", roles);
        Assert.DoesNotContain("ReadOnly", roles);
    }

    [Theory]
    [InlineData("POST", "/api/v1/restrictive-practice-reports")]
    [InlineData("DELETE", "/api/v1/restrictive-practice-reports/11111111-1111-1111-1111-111111111111")]
    public async Task ReadOnlyUser_PostOrDelete_Gets403(string method, string path)
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
}
