using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Odip.Application.Common;

namespace Odip.Api.RateLimiting;

/// <summary>The address lookup's budget: <paramref name="Permits"/> calls per <paramref name="Window"/> for one user, suggest and details together. Tests register a smaller one.</summary>
public sealed record AddressLookupRateLimits(int Permits, TimeSpan Window)
{
    /// <summary>Typing "12 Example Street" with a 250 ms pause is about a dozen suggests, plus one details a pick: 60 a minute is several fields' worth and no script's.</summary>
    public static readonly AddressLookupRateLimits Default = new(60, TimeSpan.FromMinutes(1));
}

/// <summary>
/// Every lookup is a paid Google call, so one account must not be able to spend the quota. A fixed window per signed-in user (the address when there is none). Like
/// <see cref="PlanQuoteConcurrencyFilter"/> it is a resource filter, not a rate limiter policy, because the app's limiter runs before authentication and could only key on
/// the client address, which an office shares. In-process, like the app's other limiters.
/// </summary>
public sealed class AddressLookupRateLimiter : IDisposable
{
    private readonly PartitionedRateLimiter<string> _limiter;

    public AddressLookupRateLimiter(AddressLookupRateLimits limits) =>
        _limiter = PartitionedRateLimiter.Create<string, string>(key => RateLimitPartition.GetFixedWindowLimiter(key, _ =>
            new FixedWindowRateLimiterOptions { PermitLimit = limits.Permits, Window = limits.Window, QueueLimit = 0 }));

    public bool TryTake(string key)
    {
        using var lease = _limiter.AttemptAcquire(key);
        return lease.IsAcquired;
    }

    public void Dispose() => _limiter.Dispose();
}

/// <summary>Refuses the call over the budget with the app's 429 envelope, before the action runs (so before the missing-key 404 and the input checks).</summary>
public sealed class AddressLookupRateLimitFilter(AddressLookupRateLimiter limiter) : IAsyncResourceFilter
{
    public const string TooManyMessage = "Too many address lookups. Wait a minute and try again.";

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var http = context.HttpContext;
        var user = http.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        var key = !string.IsNullOrEmpty(user) ? "user:" + user : "client:" + (http.Connection.RemoteIpAddress?.ToString() ?? http.TraceIdentifier);
        if (!limiter.TryTake(key))
        {
            context.Result = new ObjectResult(ApiResponse<object>.Fail(TooManyMessage)) { StatusCode = StatusCodes.Status429TooManyRequests };
            return;
        }

        await next();
    }
}
