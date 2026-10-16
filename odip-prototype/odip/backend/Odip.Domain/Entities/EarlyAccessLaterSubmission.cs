namespace Odip.Domain.Entities;

/// <summary>
/// A repeat sign-up whose answers differed from the ones stored on its <see cref="EarlyAccessRequest"/>. The stored row keeps the
/// answers it was first given for good (anyone who knows an email address can post to it, so a repeat must not overwrite or erase them);
/// what the repeat said is kept here for a person to read, and the landing page's "send the form again and say so" promise to see,
/// change or remove details is then acted on by hand. At most the first 10 per sign-up are kept. Deleted with its sign-up (cascade), by
/// the SuperAdmin's Delete and by the 12-month purge. Like its parent it is not tenant-scoped and not audited.
/// </summary>
public class EarlyAccessLaterSubmission
{
    public Guid Id { get; set; }

    public Guid EarlyAccessRequestId { get; set; }

    public EarlyAccessRequest? EarlyAccessRequest { get; set; }

    public DateTime ReceivedAtUtc { get; set; }

    // Same lengths as the parent's columns.
    public string Name { get; set; } = string.Empty;

    public string Organisation { get; set; } = string.Empty;

    public string? Role { get; set; }

    public string? Phone { get; set; }

    public string? OrganisationSize { get; set; }

    public string? Message { get; set; }
}
