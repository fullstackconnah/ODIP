using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Odip.Api.Telemetry;

/// <summary>Feeds the odip.health.status gauge from the periodic health report (default every 30 s).</summary>
public sealed class HealthStatusPublisher : IHealthCheckPublisher
{
    public Task PublishAsync(HealthReport report, CancellationToken cancellationToken)
    {
        OdipMetrics.SetHealthy(report.Status == HealthStatus.Healthy);
        return Task.CompletedTask;
    }
}
