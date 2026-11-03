namespace Odip.Application.ProblemReports;

/// <summary>Keeps the page a user was on without anything that identifies a record: ids and numbers become placeholders, the query and hash go.</summary>
public static class ProblemReportPath
{
    public const int MaxLength = 200;

    public static string Sanitise(string? path)
    {
        var p = path ?? string.Empty;
        var end = p.IndexOfAny(new[] { '?', '#' });
        if (end >= 0) p = p[..end];

        var segments = p.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => Guid.TryParse(s, out _) ? ":id" : s.All(char.IsAsciiDigit) ? ":n" : s);
        var result = "/" + string.Join('/', segments);
        return result.Length <= MaxLength ? result : result[..MaxLength];
    }
}
