namespace Odip.Api.Services;

public static class EnumInput
{
    /// <summary>A single defined enum name or number. <c>Enum.TryParse</c> also takes "A,B" and ORs the values, which can land on a defined value, so a comma is refused.</summary>
    public static bool TryParseDefined<T>(string? text, out T value) where T : struct, Enum
    {
        value = default;
        return text is not null && !text.Contains(',') && Enum.TryParse(text, true, out value) && Enum.IsDefined(value);
    }
}
