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
            && WriteMethods.Contains(context.Request.Method)
            && !IsOwnReadMark(context.Request))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            var response = new { message = "Your account is read-only. Changes are not permitted." };
            await context.Response.WriteAsync(JsonSerializer.Serialize(response));
            return;
        }

        await _next(context);
    }

    private static readonly string[] InboxPrefix = { "api", "v1", "notifications", "inbox" };
    private static readonly string[] WhatsNewPrefix = { "api", "v1", "whats-new" };

    /// <summary>
    /// The bell's two read marks change only the caller's own read state (NotificationsController keys them on the JWT
    /// subject), so a ReadOnly user can clear their own badge (dashboard SHAPE call 9). Exactly
    /// POST api/v1/notifications/inbox/{guid}/read and POST api/v1/notifications/inbox/read-all, matched segment by segment.
    /// What's new works the same way: POST api/v1/whats-new/seen and POST api/v1/whats-new/popup-seen only change the caller's own read marks.
    /// </summary>
    private static bool IsOwnReadMark(HttpRequest request)
    {
        if (!HttpMethods.IsPost(request.Method)) return false;
        var segments = (request.Path.Value ?? string.Empty).Trim('/').Split('/');
        if (segments.Length == 4 && segments.Take(3).SequenceEqual(WhatsNewPrefix, StringComparer.OrdinalIgnoreCase))
            return string.Equals(segments[3], "seen", StringComparison.OrdinalIgnoreCase)
                || string.Equals(segments[3], "popup-seen", StringComparison.OrdinalIgnoreCase);
        if (segments.Length < 5 || !segments.Take(4).SequenceEqual(InboxPrefix, StringComparer.OrdinalIgnoreCase)) return false;
        return segments.Length == 5
            ? string.Equals(segments[4], "read-all", StringComparison.OrdinalIgnoreCase)
            : segments.Length == 6 && Guid.TryParse(segments[4], out _) && string.Equals(segments[5], "read", StringComparison.OrdinalIgnoreCase);
    }
}
