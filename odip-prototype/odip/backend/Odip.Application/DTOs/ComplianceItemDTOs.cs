using Odip.Domain.Enums;

namespace Odip.Application.DTOs;

/// <summary>One compliance date (GET /compliance-items). <see cref="DaysLeft"/> counts from the provider's own today, so the screen never works out a date itself; negative once it has passed.</summary>
public record ComplianceItemDto
{
    public Guid Id { get; init; }
    public ComplianceKind Kind { get; init; }
    public string Label { get; init; } = string.Empty;
    public DateOnly ExpiresOn { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
    public int DaysLeft { get; init; }
}

/// <summary>The body of POST and PUT /compliance-items: the whole date (a PUT replaces every field).</summary>
public record SaveComplianceItemDto
{
    public ComplianceKind Kind { get; init; }
    public string Label { get; init; } = string.Empty;
    public DateOnly ExpiresOn { get; init; }
    public string? Reference { get; init; }
    public string? Notes { get; init; }
}
