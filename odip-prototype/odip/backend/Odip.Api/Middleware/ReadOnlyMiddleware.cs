using System.Text.Json;

namespace Odip.Api.Middleware;

public class ReadOnlyMiddleware
{
    private static readonly HashSet<string> WriteMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "POST", "PUT", "PATCH", "DELETE"
    };

    private readonly RequestDelegate _next;

    public ReadOnlyMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated == true
            && context.User.IsInRole("ReadOnly")
            && WriteMethods.Contains(context.Request.Method))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            var response = new { message = "Your account is read-only. Changes are not permitted." };
            await context.Response.WriteAsync(JsonSerializer.Serialize(response));
            return;
        }

        await _next(context);
    }
}
