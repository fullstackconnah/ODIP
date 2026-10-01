using System.Text.Json;
using System.Text.Json.Serialization;

namespace Odip.Application.Serialization;

/// <summary>
/// The wire policy for a <see cref="DateTime"/> marked <see cref="WallClockAttribute"/>: a provider-local clock reading (a dose slot, an
/// incident time somebody typed into a datetime-local input) or a calendar date held in a DateTime. Its digits ARE the answer, so it is
/// written with NO zone ("2026-10-03T08:00:00") whatever Kind it carries, and read back as exactly the digits it was given. A client
/// reads such a value as local time without conversion; it must never be turned into an instant.
///
/// Reading ignores any zone the text carries ("...Z", "+10:00"): the clock reading is what a person typed, and a zone parsed here would
/// shift it by the server's own offset (a Sydney dev machine and a UTC container would then store different values).
/// </summary>
public sealed class WallClockDateTimeConverter : JsonConverter<DateTime>
{
    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (!reader.TryGetDateTimeOffset(out var parsed))
            throw new JsonException("The value is not a valid ISO 8601 date and time.");
        return DateTime.SpecifyKind(parsed.DateTime, DateTimeKind.Unspecified);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(DateTime.SpecifyKind(value, DateTimeKind.Unspecified));
}

/// <summary>
/// Marks a <see cref="DateTime"/> / <see cref="DateTime"/>? DTO member as a provider-local WALL-CLOCK value or a calendar date, not an
/// instant: it is written with no zone and never shifted (see <see cref="WallClockDateTimeConverter"/>). Every DateTime without this
/// attribute is a UTC instant and goes out with "Z" (<see cref="UtcInstantDateTimeConverter"/>). On a positional record parameter write
/// <c>[property: WallClock]</c>. The full list, with the reason for each, is DateTimeWireInventoryTests.WallClock, and a test fails if a
/// DateTime on the wire is neither.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field, AllowMultiple = false)]
public sealed class WallClockAttribute : JsonConverterAttribute
{
    public WallClockAttribute() : base(typeof(WallClockDateTimeConverter)) { }
}
