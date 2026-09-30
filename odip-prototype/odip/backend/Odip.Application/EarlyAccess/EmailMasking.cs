namespace Odip.Application.EarlyAccess;

/// <summary>
/// Masks an email address for log lines: keeps the first character of the local part and the whole
/// domain (<c>jane.doe@example.com</c> becomes <c>j***@example.com</c>). Enough to correlate a log
/// line with a row while an operator has the table open; not enough to harvest addresses from logs.
/// </summary>
public static class EmailMasking
{
    public static string Mask(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return "(none)";

        var at = email.LastIndexOf('@');
        if (at <= 0)
            return "***";

        // Keep a whole character: a surrogate pair must not be cut in half.
        var keep = char.IsHighSurrogate(email[0]) && at > 1 ? 2 : 1;
        return string.Concat(email.AsSpan(0, keep), "***", email.AsSpan(at));
    }
}
