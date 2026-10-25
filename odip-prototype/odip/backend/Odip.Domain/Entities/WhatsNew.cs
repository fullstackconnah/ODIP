namespace Odip.Domain.Entities;

/// <summary>Who an entry is for. Stored as an int; a SuperAdmin sees every entry whatever it holds.</summary>
[Flags]
public enum WhatsNewAudience
{
    None = 0,
    Admin = 1,
    Coordinator = 2,
    SupportWorker = 4,
    ReadOnly = 8,
    All = 15,
}

/// <summary>
/// One release note shown in the What's new panel (<c>GET api/v1/whats-new</c>). Published or archived is
/// <see cref="ArchivedAtUtc"/> null or not.
///
/// Deliberately NOT an <see cref="Interfaces.ITenantEntity"/>: the same entries are read by every organisation, so the
/// table has no <c>TenantId</c>, is never stamped by <c>OdipDbContext.SaveChangesAsync</c> and has no global query
/// filter. Only a SuperAdmin writes it (Settings › What's new); entries that ship in code are inserted once by
/// <c>WhatsNewSeed</c>, keyed on <see cref="Key"/>, and are the admins' to edit after that.
/// </summary>
public class WhatsNewEntry
{
    public Guid Id { get; set; }

    /// <summary>Unique and permanent. Seeded entries use the month and a slug; entries added by a SuperAdmin use <c>admin-</c> and 8 hex characters.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>1 to 80 characters.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>1 to 600 characters of plain text; a blank line starts a new paragraph.</summary>
    public string Body { get; set; } = string.Empty;

    public WhatsNewAudience Roles { get; set; }

    /// <summary>Shows once as a pop-up on each person's next visit.</summary>
    public bool Important { get; set; }

    /// <summary>What "unread" is measured against. Editing an entry never moves it.</summary>
    public DateTime PublishedAtUtc { get; set; }

    public DateTime? ArchivedAtUtc { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// When one person last opened What's new and last dismissed its pop-up. Keyed on the user, not the tenant, and
/// read and written only for the signed-in user. NOT an <see cref="Interfaces.ITenantEntity"/> and not audited
/// (an open would flood AuditLog).
/// </summary>
public class WhatsNewUserState
{
    public Guid Id { get; set; }

    public Guid UserId { get; set; }

    public DateTime? LastSeenAtUtc { get; set; }

    public DateTime? PopupSeenThroughUtc { get; set; }
}
