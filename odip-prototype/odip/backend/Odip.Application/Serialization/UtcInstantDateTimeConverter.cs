using System.Text.Json;
using System.Text.Json.Serialization;

namespace Odip.Application.Serialization;

/// <summary>
/// The wire policy for every <see cref="DateTime"/> that is NOT marked <see cref="WallClockAttribute"/>: it is an INSTANT (a moment
/// that happened), it is UTC, and it is written with a trailing "Z".
///
/// Why it exists: 136 of the 138 timestamp columns are `timestamp without time zone` and Program.cs runs Npgsql's legacy timestamp
/// switch, so a UTC instant read back from the database has Kind Unspecified. System.Text.Json writes Unspecified with no suffix, and a
/// browser parses a zone-less ISO string as LOCAL time, so in Sydney every such instant read 10-11 hours wrong ("Last dose 10 hrs ago").
/// An Unspecified value in an instant field is UTC by convention (everything stores <c>DateTime.UtcNow</c>), so it is marked UTC here
/// rather than at each of the 100+ places that return one. Registered once, in <c>ApiJsonOptions.Configure</c>; it also serves
/// <c>DateTime?</c>, which System.Text.Json wraps around the converter for the underlying type.
///
/// Reading is the mirror: an instant the client sends ("...Z", an offset, or zone-less) comes in as Kind Utc, the same single rule
/// PortalController already applied to a manual shift start.
/// </summary>
public sealed class UtcInstantDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => AsUtc(reader.GetDateTime());

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) => writer.WriteStringValue(AsUtc(value));

    /// <summary>Utc stays; Local converts to its UTC instant; Unspecified is UTC by convention.</summary>
    internal static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };
}
