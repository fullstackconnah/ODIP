namespace Odip.Domain.Entities;

/// <summary>
/// One row per distinct email address that has asked for early access through the public
/// landing page (<c>POST /api/public/early-access</c>).
///
/// Deliberately NOT an <see cref="Interfaces.ITenantEntity"/>: the submitter is an anonymous
/// visitor who belongs to no tenant, so the table has no <c>TenantId</c>, is never stamped by
/// <c>OdipDbContext.SaveChangesAsync</c>, and has no global query filter. A tenant claim or a
/// SuperAdmin <c>X-View-As-Tenant</c>/<c>X-View-As-User</c> header can therefore neither scope
/// nor hide these rows. A SuperAdmin lists and deletes them through <c>api/v1/admin/early-access</c>
/// (Settings › Alpha sign-ups), and a daily job deletes each one 12 months after it was first sent
/// (<c>EarlyAccessPurgeBackgroundService</c>).
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

    /// <summary>ASCII digits, spaces and + ( ) -, up to 30.</summary>
    public string? Phone { get; set; }

    /// <summary>Free text, up to 100.</summary>
    public string? Role { get; set; }

    /// <summary>One of EarlyAccessRequestValidator.OrganisationSizes, or null when not given (rows from the old form, which asked no size).</summary>
    public string? OrganisationSize { get; set; }

    /// <summary>
    /// "What would you most like it to help with?" Line breaks kept, control and bidi characters dropped. Requests to see,
    /// change or remove details arrive here too.
    /// </summary>
    public string? Message { get; set; }

    public DateTime CreatedAtUtc { get; set; }

    /// <summary>When the same address last submitted the form (equals <see cref="CreatedAtUtc"/> for a single submission).</summary>
    public DateTime LastRequestedAtUtc { get; set; }

    /// <summary>How many times this address has submitted the form; starts at 1.</summary>
    public int RequestCount { get; set; }
}
