using Odip.Api.Middleware;
using OpenTelemetry;
using OpenTelemetry.Logs;

namespace Odip.Api.Telemetry;

/// <summary>
/// Counts Error records and strips each one down to an allowlist before any exporter sees it. Exception messages
/// (database errors carry row values), formatted messages, template values and scopes never leave the process.
/// Must be registered before the exporters, so it sees the record first.
/// </summary>
public sealed class ErrorLogProcessor : BaseProcessor<LogRecord>
{
    private const string OriginalFormat = "{OriginalFormat}";
    private static readonly string RequestErrorCategory = typeof(ExceptionHandlingMiddleware).FullName!;
    // Only this category logs route templates and a status; every other category's values may be personal data.
    private static readonly string[] RequestErrorKeys = ["Method", "Route", "Status"];

    public override void OnEnd(LogRecord record)
    {
        var category = record.CategoryName ?? "unknown";
        OdipMetrics.Errors.Add(1, new KeyValuePair<string, object?>("category", category));

        var source = record.Attributes ?? [];
        var kept = new List<KeyValuePair<string, object?>>();
        string? template = null;
        foreach (var attribute in source)
        {
            if (attribute.Key == OriginalFormat) template = attribute.Value as string;
            else if (category == RequestErrorCategory && Array.IndexOf(RequestErrorKeys, attribute.Key) >= 0) kept.Add(attribute);
        }

        if (record.Exception is { } ex)
        {
            kept.Add(new("exception.type", string.Join(",", Chain(ex).Select(e => e.GetType().FullName))));
            // StackTrace holds frames only, never a message.
            kept.Add(new("exception.stacktrace", ex.StackTrace ?? ""));
        }

        record.Attributes = kept;
        record.Body = template ?? "(no template)"; // never the formatted text
        record.FormattedMessage = null;
        record.Exception = null;
    }

    private static IEnumerable<Exception> Chain(Exception? e)
    {
        for (; e != null; e = e.InnerException) yield return e;
    }
}
