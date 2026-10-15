using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Odip.Application.Common;
using Odip.Domain.Interfaces;

namespace Odip.Api.RateLimiting;

/// <summary>
/// One data export at a time per organisation. An export holds a database connection and a repeatable-read transaction for as long as the client takes to download it,
/// so several at once (two Admins, a script, a stolen token) would pile up connections and old snapshots for every tenant. A second start while one runs is refused with
/// a 429, never queued.
/// It reuses <see cref="PlanQuoteConcurrencyLimiter"/> with one permit, registered as a keyed singleton under <see cref="LimiterKey"/> so the quote keeps its own two. It is
/// a resource filter for the same reason as the quote's (<see cref="PlanQuoteConcurrencyFilter"/>): the rate limiter runs before authentication, where the organisation
/// isn't known. The lease covers the whole streamed download, because the action writes the ZIP before it returns, and is released when it finishes, fails or is aborted.
/// </summary>
public sealed class DataExportConcurrencyFilter : IAsyncResourceFilter
{
    public const string LimiterKey = "data-export";
    public const int PermitsPerOrganisation = 1;
    public const string BusyMessage = "An export for this organisation is already running. Try again when it finishes.";

    private readonly PlanQuoteConcurrencyLimiter _limiter;
    private readonly ICurrentTenant _tenant;

    public DataExportConcurrencyFilter([FromKeyedServices(LimiterKey)] PlanQuoteConcurrencyLimiter limiter, ICurrentTenant tenant)
    {
        _limiter = limiter;
        _tenant = tenant;
    }

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        // The organisation as DataExportController sees it. With none, the action answers 400 or 403, so this steps aside.
        if (_tenant.IsSuperAdmin || _tenant.TenantId is not { } organisation)
        {
            await next();
            return;
        }

        using var lease = _limiter.TryEnter("tenant:" + organisation.ToString("N"));
        if (!lease.IsAcquired)
        {
            context.Result = new ObjectResult(ApiResponse<bool>.Fail(BusyMessage)) { StatusCode = StatusCodes.Status429TooManyRequests };
            return;
        }

        await next();
    }
}
