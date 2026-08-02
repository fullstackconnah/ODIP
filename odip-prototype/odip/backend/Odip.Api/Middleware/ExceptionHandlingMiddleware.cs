using System.Net;
using System.Text.Json;
using Odip.Application.Common;

namespace Odip.Api.Middleware;

/// <summary>
/// Global exception handling middleware returning consistent ApiResponse error shapes.
/// Does not leak internal exception details to clients.
/// </summary>
public class ExceptionHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionHandlingMiddleware> _logger;

    public ExceptionHandlingMiddleware(RequestDelegate next, ILogger<ExceptionHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "An unhandled exception occurred.");
            await HandleExceptionAsync(context, ex);
        }
    }

    private static async Task HandleExceptionAsync(HttpContext context, Exception exception)
    {
        context.Response.ContentType = "application/json";

        // Map exception types to status codes and safe client messages
        var (statusCode, clientMessage) = exception switch
        {
            ArgumentException => ((int)HttpStatusCode.BadRequest, "The request was invalid. Please check your input."),
            KeyNotFoundException => ((int)HttpStatusCode.NotFound, "The requested resource was not found."),
            UnauthorizedAccessException => ((int)HttpStatusCode.Unauthorized, "You are not authorized to perform this action."),
            InvalidOperationException => ((int)HttpStatusCode.BadRequest, "The operation could not be completed."),
            _ => ((int)HttpStatusCode.InternalServerError, "An unexpected error occurred. Please try again later.")
        };

        context.Response.StatusCode = statusCode;

        var response = ApiResponse<object>.Fail(clientMessage);
        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        await context.Response.WriteAsync(json);
    }
}
