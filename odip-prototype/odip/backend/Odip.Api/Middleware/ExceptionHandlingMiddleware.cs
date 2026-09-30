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
            if (ex is BadHttpRequestException badRequest)
            {
                // Kestrel's own client-error signal (body over [RequestSizeLimit], malformed framing, ...):
                // the caller's fault, not ours, so no stack trace and no error-level noise.
                _logger.LogWarning("Rejected a bad request ({StatusCode}): {Message}", badRequest.StatusCode, badRequest.Message);
            }
            else
            {
                _logger.LogError(ex, "An unhandled exception occurred.");
            }
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
            // Honour the status Kestrel chose (413 for an over-limit body, 400/408/431 ...) instead of
            // turning a client error into a 500. BadHttpRequestException is an IOException, so it matches
            // none of the cases above.
            BadHttpRequestException bad => (bad.StatusCode, "The request could not be processed. Please check its size and format."),
            _ =>((int)HttpStatusCode.InternalServerError, "An unexpected error occurred. Please try again later.")
        };

        context.Response.StatusCode = statusCode;

        var response = ApiResponse<object>.Fail(clientMessage);
        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        await context.Response.WriteAsync(json);
    }
}
