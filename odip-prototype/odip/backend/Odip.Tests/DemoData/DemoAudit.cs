using Odip.Domain.Entities;

namespace Odip.Tests.DemoData;

/// <summary>Reads what an audit entry says changed, as the audit interceptor writes it (a JSON list of field, old value, new value), for the history tests.</summary>
internal static class DemoAudit
{
    /// <summary>Whether the entry records this field going from <paramref name="old"/> to <paramref name="now"/> (null: no value).</summary>
    public static bool Says(AuditLog entry, string field, string? old, string? now)
    {
        static string Json(string? value) => value is null ? "null" : "\"" + value + "\"";
        return entry.Changes.Contains($"\"Field\":\"{field}\",\"Old\":{Json(old)},\"New\":{Json(now)}", StringComparison.Ordinal);
    }

    /// <summary>Whether the entry records any change to this field.</summary>
    public static bool Mentions(AuditLog entry, string field) => entry.Changes.Contains($"\"Field\":\"{field}\"", StringComparison.Ordinal);
}
