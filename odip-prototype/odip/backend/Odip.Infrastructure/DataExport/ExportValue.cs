using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace Odip.Infrastructure.DataExport;

/// <summary>
/// One value as a CSV cell, by its kind (DESIGN.md "Time on the wire"):
/// - an instant is UTC with a trailing Z;
/// - a wall-clock DateTime (provider-local digits) is written as stored, with no zone, and never converted;
/// - a DateOnly is yyyy-MM-dd, and a TimeOnly is HH:mm:ss, local time;
/// - numbers are invariant, an enum is its name, and a list of text is a JSON array.
/// Only text a person could type (a string, or a list of them) gets the formula guard, so a negative amount stays a number.
/// </summary>
public static class ExportValue
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly JsonSerializerOptions Json = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }; // "Café", not "Caf\u00e9"

    public static string Cell(object? value, bool wallClock) => value switch
    {
        null => "",
        string s => CsvCell.Text(s),
        DateTime d when wallClock => d.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF", Inv),
        DateTime d => AsUtc(d).ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", Inv),
        DateTimeOffset o => o.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", Inv),
        DateOnly d => d.ToString("yyyy-MM-dd", Inv),
        TimeOnly t => t.ToString("HH:mm:ss", Inv),
        bool b => b ? "true" : "false",
        Enum e => CsvCell.Quote(e.ToString()),
        IEnumerable<string> list => CsvCell.Text(JsonSerializer.Serialize(list, Json)),
        IFormattable f => f.ToString(null, Inv),
        _ => throw new NotSupportedException($"The data export has no format for {value.GetType().Name}."),
    };

    /// <summary>
    /// The UtcInstantDateTimeConverter rule: Utc stays; Local converts (a timestamp with time zone column reads back Local under the legacy
    /// switch); Unspecified is UTC by convention, because every instant is stored from DateTime.UtcNow.
    /// </summary>
    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}
