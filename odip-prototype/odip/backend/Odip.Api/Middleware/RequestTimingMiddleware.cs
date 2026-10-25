using System.Data.Common;
using System.Diagnostics;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Odip.Api.Middleware;

/// <summary>Per-request count of EF commands; scoped, so it lives and dies with the request that owns the DbContext.</summary>
public sealed class RequestDbCommandCounter
{
    private int _count;
    public int Count => _count;
    public void Increment() => Interlocked.Increment(ref _count);
}

/// <summary>Bumps the request's <see cref="RequestDbCommandCounter"/> for every command EF creates (queries, saves, ExecuteUpdate).</summary>
public sealed class DbCommandCountInterceptor(RequestDbCommandCounter counter) : DbCommandInterceptor
{
    public override DbCommand CommandCreated(CommandEndEventData eventData, DbCommand result)
    {
        counter.Increment();
        return result;
    }
}

public static class RequestTimingExtensions
{
    public static IServiceCollection AddRequestTiming(this IServiceCollection services) => services
        .AddScoped<RequestDbCommandCounter>()
        .AddScoped<DbCommandCountInterceptor>();
}

/// <summary>
/// One Information line per /api/ request under the category "Odip.RequestTiming": method, route TEMPLATE, status, elapsed ms and DB
/// commands. The template (never the raw path or query string) keeps ids and personal data out of the log. Health probes are skipped
/// so their 10 s interval does not flood it.
/// </summary>
public class RequestTimingMiddleware(RequestDelegate next, ILoggerFactory loggerFactory)
{
    private readonly ILogger _logger = loggerFactory.CreateLogger("Odip.RequestTiming");

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;
        if (!path.StartsWithSegments("/api") || path.StartsWithSegments("/api/health"))
        {
            await next(context);
            return;
        }

        var start = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        finally
        {
            var route = (context.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(no route)";
            var db = context.RequestServices.GetRequiredService<RequestDbCommandCounter>().Count;
            _logger.LogInformation("{Method} {Route} {Status} {ElapsedMs:F1}ms db={DbCommands}",
                context.Request.Method, route, context.Response.StatusCode, Stopwatch.GetElapsedTime(start).TotalMilliseconds, db);
        }
    }
}
