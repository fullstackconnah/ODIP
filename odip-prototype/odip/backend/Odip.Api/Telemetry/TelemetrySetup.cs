using Microsoft.Extensions.Diagnostics.HealthChecks;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;

namespace Odip.Api.Telemetry;

public static class TelemetrySetup
{
    /// <summary>
    /// Metrics and scrubbed Error logs over OTLP. Switched off by default: the exporters are registered only when
    /// OTEL_EXPORTER_OTLP_ENDPOINT is set, so with no endpoint nothing leaves the process. The per-signal variables (OTEL_EXPORTER_OTLP_LOGS_ENDPOINT,
    /// OTEL_EXPORTER_OTLP_METRICS_ENDPOINT) alone export nothing. The endpoint, protocol and
    /// resource come from the standard OTEL_* variables, never from code.
    /// </summary>
    public static WebApplicationBuilder AddOdipTelemetry(this WebApplicationBuilder builder)
    {
        var export = !string.IsNullOrWhiteSpace(builder.Configuration["OTEL_EXPORTER_OTLP_ENDPOINT"]);

        builder.Services.AddOpenTelemetry().WithMetrics(m =>
        {
            m.AddMeter("Microsoft.AspNetCore.Hosting", "System.Runtime", OdipMetrics.MeterName);
            if (export) m.AddOtlpExporter();
        });

        builder.Logging.AddOpenTelemetry(o =>
        {
            o.IncludeScopes = false; // scopes carry the raw request path
            o.IncludeFormattedMessage = false;
            o.AddProcessor(new ErrorLogProcessor()); // before the exporter below, so every exporter sees scrubbed records
            if (export) o.AddOtlpExporter();
        });
        builder.Logging.AddFilter<OpenTelemetryLoggerProvider>(null, LogLevel.Error);

        // The publisher runs the database check every 30 s, so only run it when its result is exported.
        if (export) builder.Services.AddSingleton<IHealthCheckPublisher, HealthStatusPublisher>();
        return builder;
    }
}
