using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>M2: a ReadOnly user must still be able to sign out and to keep a Microsoft session alive; every other write stays 403.</summary>
public class ReadOnlyMicrosoftAllowListTests
{
    private static async Task<(bool Reached, int Status)> SendAsReadOnly(string method, string path)
    {
        var reached = false;
        var middleware = new ReadOnlyMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "ReadOnly")], "test")) };
        context.Request.Method = method;
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        await middleware.InvokeAsync(context);
        return (reached, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("POST", "/api/v1/auth/logout")]
    [InlineData("POST", "/API/V1/Auth/Logout")]
    [InlineData("POST", "/api/v1/auth/microsoft/refresh")]
    public async Task LogoutAndMicrosoftRefresh_ReachTheController(string method, string path) =>
        Assert.True((await SendAsReadOnly(method, path)).Reached);

    [Theory]
    [InlineData("PUT", "/api/v1/auth/logout")]
    [InlineData("POST", "/api/v1/auth/logout/extra")]
    [InlineData("DELETE", "/api/v1/auth/microsoft/refresh")]
    [InlineData("POST", "/api/v1/auth/microsoft/refresh/extra")]
    [InlineData("PUT", "/api/v1/auth/microsoft/link")]
    [InlineData("DELETE", "/api/v1/auth/microsoft/account")]
    [InlineData("POST", "/api/v1/auth/exchange")]
    public async Task EveryOtherAuthWriteFromReadOnly_IsStill403(string method, string path)
    {
        var (reached, status) = await SendAsReadOnly(method, path);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
    }
}
