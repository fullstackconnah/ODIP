using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.Middleware;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Xunit;

namespace Odip.Tests.ClientErrors;

/// <summary>POST api/v1/client-errors: a browser crash reaches the API log, nothing is stored. Any signed-in role (ReadOnly included) may send one; no anonymous.</summary>
public class ClientErrorsControllerTests
{
    private static readonly Guid UserId = Guid.Parse("11111111-0000-4000-8000-000000000001");
    private static readonly Guid TenantId = Guid.Parse("aaaaaaaa-0000-4000-8000-000000000001");

    private sealed class Capture : ILogger<ClientErrorsController>
    {
        public List<(LogLevel Level, string Message, Dictionary<string, object?> Props)> Entries { get; } = new();
        private Dictionary<string, object?> _scope = new();
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull
        {
            _scope = ((IEnumerable<KeyValuePair<string, object?>>)state).ToDictionary(p => p.Key, p => p.Value);
            return null;
        }
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception), ((IEnumerable<KeyValuePair<string, object?>>)state!).Concat(_scope).ToDictionary(p => p.Key, p => p.Value)));
    }

    private static (ClientErrorsController Controller, Capture Log) Make()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(t => t.TenantId).Returns(TenantId);
        var log = new Capture();
        var controller = new ClientErrorsController(tenant.Object, log)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, UserId.ToString())], "test")) },
            },
        };
        return (controller, log);
    }

    [Fact]
    public void AValidReport_Gets204_AndOneWarningWithTheUserAndTenant()
    {
        var (controller, log) = Make();

        var result = controller.Report(new ClientErrorRequest("Cannot read x", "at a (b.js:1)", "in Foo", "/schedule", "boundary"));

        Assert.IsType<NoContentResult>(result);
        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Equal($"Client error boundary at /schedule: Cannot read x (user {UserId}, org {TenantId}) stack at a (b.js:1) component in Foo", entry.Message);
        Assert.Equal(UserId, entry.Props["UserId"]);
        Assert.Equal(TenantId, entry.Props["TenantId"]);
        Assert.Equal("at a (b.js:1)", entry.Props["Stack"]);
        Assert.Equal("in Foo", entry.Props["ComponentStack"]);
    }

    [Theory]
    [InlineData(null), InlineData(""), InlineData("   ")]
    public void ABlankMessage_Gets400_AndLogsNothing(string? message)
    {
        var (controller, log) = Make();

        var result = controller.Report(new ClientErrorRequest(message, null, null, "/x", "error"));

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(log.Entries);
    }

    [Fact]
    public void AnUnknownKind_Gets400()
    {
        var (controller, _) = Make();
        Assert.IsType<BadRequestObjectResult>(controller.Report(new ClientErrorRequest("m", null, null, "/x", "bogus")));
    }

    [Fact]
    public void LongValues_AreCutToTheirLimits()
    {
        var (controller, log) = Make();

        controller.Report(new ClientErrorRequest(new string('m', 900), new string('s', 9000), new string('c', 9000), "/" + new string('p', 400), "rejection"));

        var props = Assert.Single(log.Entries).Props;
        Assert.Equal(500, ((string)props["Message"]!).Length);
        Assert.Equal(4000, ((string)props["Stack"]!).Length);
        Assert.Equal(4000, ((string)props["ComponentStack"]!).Length);
        Assert.Equal(200, ((string)props["Path"]!).Length);
    }

    [Fact]
    public void CrAndLf_AreStrippedFromMessageAndPath_SoALogLineCannotBeForged()
    {
        var (controller, log) = Make();

        controller.Report(new ClientErrorRequest("bad\r\nFake line", null, null, "/a\nb", "error"));

        var entry = Assert.Single(log.Entries);
        Assert.DoesNotContain('\r', entry.Message);
        Assert.DoesNotContain('\n', entry.Message);
        Assert.StartsWith("Client error error at /ab: badFake line", entry.Message);
    }

    [Fact]
    public void AStackWithLineBreaks_StaysOnOneLine_AndTheIdsAndAFrameReachTheFormattedMessage()
    {
        var (controller, log) = Make();

        controller.Report(new ClientErrorRequest("boom", "Error: boom\r\n    at render (App.tsx:9)\n\nFAKE log line\u0007", "in A\nin B", "/x", "error"));

        var message = Assert.Single(log.Entries).Message;
        Assert.DoesNotContain('\n', message);
        Assert.DoesNotContain('\r', message);
        Assert.Contains(UserId.ToString(), message);
        Assert.Contains(TenantId.ToString(), message);
        Assert.Contains("at render (App.tsx:9)", message);
        Assert.Contains("in A | in B", message);
    }

    [Fact]
    public async Task AReadOnlyDelete_OnTheClientErrorsRoute_IsRefused()
    {
        var middleware = new ReadOnlyMiddleware(_ => Task.CompletedTask);
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "ReadOnly")], "test")) };
        context.Request.Method = "DELETE";
        context.Request.Path = "/api/v1/client-errors";
        context.Response.Body = new MemoryStream();
        await middleware.InvokeAsync(context);
        Assert.Equal(403, context.Response.StatusCode);
    }

    [Theory]
    [InlineData("SuperAdmin"), InlineData("Admin"), InlineData("Coordinator"), InlineData("SupportWorker"), InlineData("ReadOnly")]
    public void EveryRole_IsAdmitted_AndAnonymousIsNot(string role)
    {
        var action = typeof(ClientErrorsController).GetMethod(nameof(ClientErrorsController.Report))!;
        Assert.Contains(typeof(HttpPostAttribute), action.GetCustomAttributes().Select(a => a.GetType()));
        var principal = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        var attributes = typeof(ClientErrorsController).GetCustomAttributes<AuthorizeAttribute>(true).ToList();
        Assert.NotEmpty(attributes); // [Authorize] present, so anonymous gets 401
        Assert.All(attributes, a => Assert.True(string.IsNullOrWhiteSpace(a.Roles) || a.Roles.Split(',').Any(r => principal.IsInRole(r.Trim())), role));
        Assert.Empty(action.GetCustomAttributes<AllowAnonymousAttribute>());
    }

    [Fact]
    public async Task AReadOnlyUser_ReachesTheController()
    {
        var reached = false;
        var middleware = new ReadOnlyMiddleware(_ => { reached = true; return Task.CompletedTask; });
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "ReadOnly")], "test")) };
        context.Request.Method = "POST";
        context.Request.Path = "/api/v1/client-errors";
        context.Response.Body = new MemoryStream();
        await middleware.InvokeAsync(context);
        Assert.True(reached);
    }
}
