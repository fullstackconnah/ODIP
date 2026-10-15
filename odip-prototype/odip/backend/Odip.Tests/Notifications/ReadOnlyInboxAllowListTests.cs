using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Odip.Api.Middleware;
using Xunit;

namespace Odip.Tests.Notifications;

/// <summary>SHAPE call 9: a ReadOnly user may mark their own bell items read, and every other write from ReadOnly is still 403.</summary>
public class ReadOnlyInboxAllowListTests
{
    private const string Id = "11111111-1111-1111-1111-111111111111";

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
    [InlineData("POST", "/api/v1/notifications/inbox/" + Id + "/read")]
    [InlineData("POST", "/api/v1/notifications/inbox/read-all")]
    [InlineData("POST", "/API/V1/Notifications/Inbox/Read-All")]
    public async Task AReadOnlyUsersOwnReadMarks_ReachTheController(string method, string path)
    {
        var (reached, _) = await SendAsReadOnly(method, path);
        Assert.True(reached);
    }

    [Theory]
    [InlineData("PUT", "/api/v1/notifications/preferences")]
    [InlineData("PUT", "/api/v1/notifications/inbox/read-all")]
    [InlineData("DELETE", "/api/v1/notifications/inbox/" + Id + "/read")]
    [InlineData("POST", "/api/v1/notifications/inbox/" + Id + "/readx")]
    [InlineData("POST", "/api/v1/notifications/inbox/not-a-guid/read")]
    [InlineData("POST", "/api/v1/notifications/inbox/" + Id + "/read/extra")]
    [InlineData("POST", "/api/v1/notifications/inbox")]
    [InlineData("POST", "/api/v1/notifications/inbox/read-all/extra")]
    [InlineData("POST", "/api/v1/admin/notifications/" + Id + "/retry")]
    [InlineData("POST", "/api/v1/leave/" + Id + "/approve")]
    public async Task EveryOtherWriteFromReadOnly_IsStill403(string method, string path)
    {
        var (reached, status) = await SendAsReadOnly(method, path);
        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, status);
    }
}
