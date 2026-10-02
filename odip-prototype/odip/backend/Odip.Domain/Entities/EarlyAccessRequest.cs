namespace Odip.Domain.Entities;

/// <summary>
/// One row per distinct email address that has asked for early access through the public
/// landing page (<c>POST /api/public/early-access</c>).
///
/// Deliberately NOT an <see cref="Interfaces.ITenantEntity"/>: the submitter is an anonymous
/// visitor who belongs to no tenant, so the table has no <c>TenantId</c>, is never stamped by
/// <c>OdipDbContext.SaveChangesAsync</c>, and has no global query filter. A tenant claim or a
/// SuperAdmin <c>X-View-As-Tenant</c>/<c>X-View-As-User</c> header can therefore neither scope
/// nor hide these rows. Reads are an operator concern (direct database access) — there is no
/// API that lists them.
///
/// Personal data kept is the minimum the form asks for. No IP address or user agent is stored.
/// </summary>
public class EarlyAccessRequest
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string Organisation { get; set; } = string.Empty;

    /// <summary>
    /// Trimmed and lower-cased (invariant culture) before it is stored, so the unique index
    /// treats <c>Jane@Example.com</c> and <c>jane@example.com</c> as the same person.
    /// </summary>
    public string Email { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; }

    /// <summary>When the same address last submitted the form (equals <see cref="CreatedAtUtc"/> for a single submission).</summary>
    public DateTime LastRequestedAtUtc { get; set; }

    /// <summary>How many times this address has submitted the form; starts at 1.</summary>
    public int RequestCount { get; set; }
}
