namespace Odip.Infrastructure.Services;

/// <summary>
/// A refusal the person importing can act on. ImportsController answers with <see cref="StatusCode"/> and the message as it is, so the message
/// never holds a value from the file: row numbers, line numbers and field names only.
/// </summary>
public sealed class ImportException : Exception
{
    public int StatusCode { get; }

    public ImportException(string message, int statusCode = 400) : base(message) => StatusCode = statusCode;
}
