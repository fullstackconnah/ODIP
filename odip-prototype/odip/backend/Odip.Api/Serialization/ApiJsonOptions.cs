using System.Text.Json;
using System.Text.Json.Serialization;

namespace Odip.Api.Serialization;

/// <summary>
/// The JSON policy the API applies to every MVC response (Program.cs calls <see cref="Configure"/>). It lives here so the wire-contract
/// tests serialise with the SAME options the server uses instead of a hand-copied approximation - a copy is how a contract promise
/// ("this field is an explicit null") drifts from what actually goes over the wire.
/// </summary>
public static class ApiJsonOptions
{
    /// <summary>
    /// Enums travel as strings, and a null member is OMITTED from the JSON (WhenWritingNull) unless its property says otherwise with
    /// <c>[JsonIgnore(Condition = JsonIgnoreCondition.Never)]</c> - which the shift-package DTOs do for every nullable member, because
    /// there "null" means "not recorded" and the client must see the key.
    /// </summary>
    public static void Configure(JsonSerializerOptions options)
    {
        options.Converters.Add(new JsonStringEnumConverter());
        options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    }
}
