namespace Odip.Application.DTOs;

public record AuthResponseDto
{
    /// <summary>
    /// The signed-in user's own id. Post staff/user unification this is the frontend's
    /// self-exclusion source (spec §5) — e.g. excluding yourself from a witness/picker — now
    /// that there is no separate StaffId concept to serve that role.
    /// </summary>
    public Guid Id { get; init; }
    public string Token { get; init; } = string.Empty;
    public DateTime ExpiresAt { get; init; }
    public string Username { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public string Role { get; init; } = string.Empty;
    public string? TenantName { get; init; }
    public Guid? TenantId { get; init; }
}

// NOTE: ExchangeTokenDto (the Firebase-token-exchange request DTO this record sits next to per
// spec) actually lives in its own file, Odip.Application/DTOs/ExchangeTokenDto.cs — this record
// is placed here instead, next to its response counterpart AuthResponseDto above.
public record DevLoginDto
{
    public string? Username { get; init; }
}
