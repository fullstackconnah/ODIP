using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

public class LogoutTests
{
    private static AuthController Controller(HttpContext http) => new(
        null!, new ConfigurationBuilder().Build(), new Mock<ILogger<AuthController>>().Object, new Mock<ILoginAttemptTracker>().Object,
        new Mock<Odip.Domain.Interfaces.ICurrentTenant>().Object, new Mock<IFirebaseTokenVerifier>().Object)
    { ControllerContext = new ControllerContext { HttpContext = http } };

    // M11: an expired session must still be able to clear its refresh cookie, so logout cannot require a valid odip_jwt.
    [Fact]
    public void Logout_IsAnonymous()
    {
        var m = typeof(AuthController).GetMethod(nameof(AuthController.Logout))!;
        Assert.NotNull(m.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Fact]
    public void Logout_DeletesBothCookies_WithTheirOwnPaths()
    {
        var http = new DefaultHttpContext();
        Controller(http).Logout();
        var set = http.Response.Headers.SetCookie.ToArray();
        Assert.Contains(set, c => c!.StartsWith("odip_jwt=;") && c.EndsWith("path=/api"));
        Assert.Contains(set, c => c!.StartsWith("odip_ms_refresh=;") && c.EndsWith("path=/api/v1/auth/microsoft"));
    }
}
