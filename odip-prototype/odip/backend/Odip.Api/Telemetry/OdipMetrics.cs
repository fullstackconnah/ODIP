using System.Diagnostics.Metrics;

namespace Odip.Api.Telemetry;

/// <summary>The app's own instruments: an error counter by logger category and a database health gauge.</summary>
public static class OdipMetrics
{
    public const string MeterName = "Odip.Api";

    private static readonly Meter Meter = new(MeterName);
    private static int _healthy = 1;

    public static readonly Counter<long> Errors = Meter.CreateCounter<long>("odip.errors", description: "Error and Critical log records by logger category");

    private static readonly ObservableGauge<int> Health = Meter.CreateObservableGauge("odip.health.status", () => _healthy, description: "1 when the health checks pass, 0 when not");

    public static void SetHealthy(bool healthy) => _healthy = healthy ? 1 : 0;
}
