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
/// (Settings › Alpha sign-ups), and an hourly job deletes each one 12 months after it was first sent, an hour early
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

    /// <summary>Repeat sign-ups whose answers differed from the ones above, oldest first; at most 10, plus the first over-limit one. See <see cref="EarlyAccessLaterSubmission"/>.</summary>
    public List<EarlyAccessLaterSubmission> LaterSubmissions { get; set; } = [];

    /// <summary>
    /// Distinct repeats sent after the 10 later submissions were full. Only the first is kept, in one <see cref="EarlyAccessLaterSubmission"/>
    /// row with <c>IsOverLimit</c> that no later repeat replaces, so an anonymous repeat cannot erase it and a lost email notice loses nothing;
    /// the others only add to this count and move <see cref="LastOverLimitAtUtc"/>.
    /// </summary>
    public int OverLimitCount { get; set; }

    /// <summary>When the most recent over-limit repeat arrived; null until there is one.</summary>
    public DateTime? LastOverLimitAtUtc { get; set; }

    /// <summary>
    /// True from the first over-limit repeat until a SuperAdmin marks the sign-up followed up. Set by EVERY distinct over-limit repeat, and
    /// no public submission ever clears it: only the first such repeat is shown, so a later one (a removal request, say) must never be
    /// taken as handled while nobody has looked. A new over-limit repeat after it was cleared sets it again.
    /// </summary>
    public bool FollowUpNeeded { get; set; }

    /// <summary>When a SuperAdmin last marked the over-limit repeats followed up; null if never. Kept after a new repeat sets <see cref="FollowUpNeeded"/> again.</summary>
    public DateTime? FollowUpClearedAtUtc { get; set; }
}
