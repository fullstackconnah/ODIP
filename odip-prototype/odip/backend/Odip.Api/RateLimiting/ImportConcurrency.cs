using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Odip.Application.Common;
using Odip.Domain.Interfaces;

namespace Odip.Api.RateLimiting;

/// <summary>
/// Two imports at a time per organisation, preview and commit counted together. Each parses a file of up to 6 MB in memory and a commit writes many rows, so several at once
/// (staff, a script, a stolen token) would take CPU and database connections from every tenant. A third start while two run is refused with a 429, never queued.
/// The same pattern as <see cref="DataExportConcurrencyFilter"/>: a resource filter (the rate limiter runs before authentication, where the organisation isn't known) over
/// <see cref="PlanQuoteConcurrencyLimiter"/>, registered as a keyed singleton under <see cref="LimiterKey"/>.
/// </summary>
public sealed class ImportConcurrencyFilter : IAsyncResourceFilter
{
    public const string LimiterKey = "imports";
    public const int PermitsPerOrganisation = 2;
    public const string BusyMessage = "Another import for this organisation is still running. Try again in a moment.";

    private readonly PlanQuoteConcurrencyLimiter _limiter;
    private readonly ICurrentTenant _tenant;

    public ImportConcurrencyFilter([FromKeyedServices(LimiterKey)] PlanQuoteConcurrencyLimiter limiter, ICurrentTenant tenant)
    {
        _limiter = limiter;
        _tenant = tenant;
    }

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        // The organisation as ImportsController sees it. With none, the service answers its own 400 or 403, so this steps aside.
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
