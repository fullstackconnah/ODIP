namespace Odip.Application.DTOs;

/// <summary>A browser crash. The user and organisation come from the request, never from the body.</summary>
public sealed record ClientErrorRequest(string? Message, string? Stack, string? ComponentStack, string? Path, string? Kind);
