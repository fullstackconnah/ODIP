using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Odip.Application.Common;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Interfaces;

namespace Odip.Api.RateLimiting;

/// <summary>
/// How many plan quotes one organisation may have in flight at once: a few, and the rest are told to try again shortly. The quote is the one request that can be heavy
/// by design (the heaviest legal one is about 90,000 lines, a second or two of CPU and a hundred megabytes or more held until the answer is written), and the app's
/// "api" policy (100 a minute a client, a fixed window) says nothing about how many of those run at the same time, so one account could keep several cores and the
/// garbage collector busy for every tenant. Two at once is what the builder needs (one being worked out while the last edit's answer is still being written); a third
/// is refused at once, never queued.
///
/// It is not an ASP.NET rate limiter policy because those run before authentication in this app's pipeline (the order is fixed in Program.cs), where neither the
/// tenant nor the user is known and the only key left is the client address, which many people behind one office connection share. It is a resource filter instead
/// (<see cref="PlanQuoteConcurrencyFilter"/>), after authentication and before model binding, so the permit covers reading the body, pricing and writing the answer.
/// Counts are in-process, like the app's other limiters: a second API replica would have its own.
/// </summary>
public sealed class PlanQuoteConcurrencyLimiter : IDisposable
{
    /// <summary>The quotes one organisation may have in flight.</summary>
    public const int PermitsPerOrganisation = 2;

    private readonly PartitionedRateLimiter<string> _limiter;

    public PlanQuoteConcurrencyLimiter(int permits = PermitsPerOrganisation)
    {
        // A concurrency limiter with no queue: a request that finds every permit taken is refused at once. The framework drops a partition's limiter once it has been idle.
        _limiter = PartitionedRateLimiter.Create<string, string>(key =>
            RateLimitPartition.GetConcurrencyLimiter(key, _ => new ConcurrencyLimiterOptions { PermitLimit = permits, QueueLimit = 0 }));
    }

    /// <summary>A lease on one of the key's permits: dispose it when the request ends. <see cref="RateLimitLease.IsAcquired"/> is false when none is free.</summary>
    public RateLimitLease TryEnter(string key) => _limiter.AttemptAcquire(key);

    public void Dispose() => _limiter.Dispose();
}

/// <summary>
/// Limits the plan quote to <see cref="PlanQuoteConcurrencyLimiter.PermitsPerOrganisation"/> in flight per organisation. The key is the caller's tenant; when there is none (a
/// SuperAdmin who has not chosen an organisation to view as) it is the caller, and only if there is no caller either, the client. The refusal is a 429 with the app's own
/// response envelope, <c>Retry-After: 1</c> and a message that says to try again shortly.
/// </summary>
public sealed class PlanQuoteConcurrencyFilter : IAsyncResourceFilter
{
    public const string BusyMessage = "The pricing engine is already working on other quotes for your organisation. Try again shortly.";

    private readonly PlanQuoteConcurrencyLimiter _limiter;
    private readonly ICurrentTenant _tenant;

    public PlanQuoteConcurrencyFilter(PlanQuoteConcurrencyLimiter limiter, ICurrentTenant tenant)
    {
        _limiter = limiter;
        _tenant = tenant;
    }

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        // The lease is held until the request has finished, the answer included: the permit is disposed when next() returns or throws.
        using var lease = _limiter.TryEnter(KeyOf(context.HttpContext));
        if (!lease.IsAcquired)
        {
            context.HttpContext.Response.Headers.RetryAfter = "1";
            context.Result = new ObjectResult(ApiResponse<PlanQuote>.Fail(BusyMessage)) { StatusCode = StatusCodes.Status429TooManyRequests };
            return;
        }

        await next();
    }

    private string KeyOf(HttpContext context)
    {
        if (_tenant.TenantId is { } tenantId) return "tenant:" + tenantId.ToString("N");

        var user = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (!string.IsNullOrEmpty(user)) return "user:" + user;

        return "client:" + (context.Connection.RemoteIpAddress?.ToString() ?? context.TraceIdentifier);
    }
}
