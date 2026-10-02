using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Moq;
using Odip.Api.Middleware;
using Odip.Application.Common;
using Xunit;

namespace Odip.Tests.Middleware;

public class ExceptionHandlingMiddlewareTests
{
    private readonly Mock<ILogger<ExceptionHandlingMiddleware>> _logger = new();

    private (ExceptionHandlingMiddleware middleware, DefaultHttpContext context) CreateMiddleware(
        RequestDelegate next)
    {
        var middleware = new ExceptionHandlingMiddleware(next, _logger.Object);
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        return (middleware, context);
    }

    private async Task<(int statusCode, ApiResponse<object>? body)> InvokeWithException(Exception ex)
    {
        var (middleware, context) = CreateMiddleware(_ => throw ex);
        await middleware.InvokeAsync(context);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var json = await new StreamReader(context.Response.Body).ReadToEndAsync();
        var response = JsonSerializer.Deserialize<ApiResponse<object>>(json,
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        return (context.Response.StatusCode, response);
    }

    [Fact]
    public async Task ArgumentException_Returns400()
    {
        var (statusCode, body) = await InvokeWithException(new ArgumentException("bad arg"));

        Assert.Equal((int)HttpStatusCode.BadRequest, statusCode);
        Assert.NotNull(body);
        Assert.False(body!.Success);
        Assert.Contains("invalid", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task KeyNotFoundException_Returns404()
    {
        var (statusCode, body) = await InvokeWithException(new KeyNotFoundException("not found"));

        Assert.Equal((int)HttpStatusCode.NotFound, statusCode);
        Assert.False(body!.Success);
        Assert.Contains("not found", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task UnauthorizedAccessException_Returns401()
    {
        var (statusCode, body) = await InvokeWithException(new UnauthorizedAccessException("denied"));

        Assert.Equal((int)HttpStatusCode.Unauthorized, statusCode);
        Assert.False(body!.Success);
        Assert.Contains("not authorized", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task InvalidOperationException_Returns400()
    {
        var (statusCode, body) = await InvokeWithException(new InvalidOperationException("invalid op"));

        Assert.Equal((int)HttpStatusCode.BadRequest, statusCode);
        Assert.False(body!.Success);
    }

    [Fact]
    public async Task GenericException_Returns500()
    {
        var (statusCode, body) = await InvokeWithException(new Exception("kaboom"));

        Assert.Equal((int)HttpStatusCode.InternalServerError, statusCode);
        Assert.False(body!.Success);
        Assert.Contains("unexpected error", body.Errors![0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task GenericException_DoesNotLeakExceptionDetails()
    {
        var (_, body) = await InvokeWithException(new Exception("secret internal details"));

        Assert.DoesNotContain("secret internal details", body!.Errors![0]);
    }

    // Kestrel throws BadHttpRequestException for client errors (a body over [RequestSizeLimit] is 413). They are
    // the caller's fault: the status must be honoured, not flattened into a 500, and nothing about the framework's
    // message may reach the client.
    [Theory]
    [InlineData(413)]
    [InlineData(400)]
    [InlineData(408)]
    [InlineData(431)]
    public async Task BadHttpRequestException_KeepsItsClientErrorStatus(int status)
    {
        var (statusCode, body) = await InvokeWithException(
            new BadHttpRequestException("Request body too large. The max request body size is 4096 bytes.", status));

        Assert.Equal(status, statusCode);
        Assert.False(body!.Success);
        Assert.DoesNotContain("4096", body.Errors![0]);
        Assert.DoesNotContain("max request body size", body.Errors[0], StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task BadHttpRequestException_IsLoggedAsAWarning_NotAnError()
    {
        var (middleware, context) = CreateMiddleware(_ => throw new BadHttpRequestException("too large", 413));

        await middleware.InvokeAsync(context);

        _logger.Verify(l => l.Log(
            LogLevel.Warning, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), null, It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
        _logger.Verify(l => l.Log(
            LogLevel.Error, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(), It.IsAny<Exception?>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Never);
    }

    [Fact]
    public async Task ResponseContentType_IsJson()
    {
        var (middleware, context) = CreateMiddleware(_ => throw new Exception("test"));

        await middleware.InvokeAsync(context);

        Assert.Equal("application/json", context.Response.ContentType);
    }

    [Fact]
    public async Task ResponseBody_MatchesApiResponseShape()
    {
        var (middleware, context) = CreateMiddleware(_ => throw new ArgumentException("test"));
        await middleware.InvokeAsync(context);

        context.Response.Body.Seek(0, SeekOrigin.Begin);
        var json = await new StreamReader(context.Response.Body).ReadToEndAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        // ApiResponse has success, errors properties (camelCase)
        Assert.True(root.TryGetProperty("success", out var success));
        Assert.False(success.GetBoolean());
        Assert.True(root.TryGetProperty("errors", out var errors));
        Assert.True(errors.GetArrayLength() > 0);
    }

    [Fact]
    public async Task NoException_PassesThrough()
    {
        var called = false;
        var (middleware, context) = CreateMiddleware(_ =>
        {
            called = true;
            return Task.CompletedTask;
        });

        await middleware.InvokeAsync(context);

        Assert.True(called);
        Assert.Equal(200, context.Response.StatusCode); // default
    }
}
