namespace Odip.Application.DTOs;

/// <summary>
/// Body of <c>POST /api/public/early-access</c> (the landing-page form).
///
/// Every property is nullable on purpose. MVC would otherwise add an implicit <c>[Required]</c> to
/// each non-nullable reference type and answer a missing field with its own 400 — with its own
/// key casing and wording — before the action even runs, and before the honeypot is checked.
/// The controller reports missing/invalid fields itself, with stable camelCase keys, through
/// <see cref="EarlyAccess.EarlyAccessRequestValidator"/>.
/// </summary>
public class EarlyAccessRequestDto
{
    public string? Name { get; set; }

    public string? Organisation { get; set; }

    public string? Email { get; set; }

    /// <summary>One of <see cref="EarlyAccess.EarlyAccessRequestValidator.OrganisationSizes"/>; optional until the new form ships.</summary>
    public string? OrganisationSize { get; set; }

    /// <summary>Optional free text, one line.</summary>
    public string? Role { get; set; }

    /// <summary>Optional: ASCII digits, spaces and + ( ) - only.</summary>
    public string? Phone { get; set; }

    /// <summary>Optional free text; the server keeps line breaks and drops control and bidi characters.</summary>
    public string? Message { get; set; }

    /// <summary>
    /// Honeypot. The form renders this input hidden from people and from assistive technology, so a
    /// real visitor never fills it in; a bot that fills every input does. A non-empty value gets the
    /// normal 202 and is silently dropped.
    /// </summary>
    public string? Website { get; set; }
}

/// <summary>
/// 202 body for a request the API accepted. It deliberately says nothing about whether the address
/// was new, already known, or discarded as a bot.
/// </summary>
public record EarlyAccessReceivedDto(string Status)
{
    public static EarlyAccessReceivedDto Received { get; } = new("received");
}

/// <summary>One alpha sign-up as the SuperAdmin list shows it (GET api/v1/admin/early-access).</summary>
public class EarlyAccessSignupDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Organisation { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string? Role { get; set; }
    public string? Phone { get; set; }
    public string? OrganisationSize { get; set; }
    public string? Message { get; set; }
    public DateTime CreatedAtUtc { get; set; }
    public DateTime LastRequestedAtUtc { get; set; }
    public int RequestCount { get; set; }

    /// <summary>Repeat sign-ups whose answers differed from the ones above, newest last; at most 10 (RequestCount - 1 may be higher).</summary>
    public List<EarlyAccessLaterSubmissionDto> LaterSubmissions { get; set; } = [];

    /// <summary>Distinct repeats sent after the 10 were full; only the first is kept, in <see cref="FirstOverLimit"/>, and the rest are counted.</summary>
    public int OverLimitCount { get; set; }

    /// <summary>When the latest of those over-limit repeats arrived; null when there were none.</summary>
    public DateTime? LastOverLimitAtUtc { get; set; }

    public EarlyAccessLaterSubmissionDto? FirstOverLimit { get; set; }

    /// <summary>True while over-limit repeats are unseen by a person: set by each one, cleared only by the SuperAdmin's "Mark followed up".</summary>
    public bool FollowUpNeeded { get; set; }

    /// <summary>When the SuperAdmin last marked them followed up; null if never.</summary>
    public DateTime? FollowUpClearedAtUtc { get; set; }
}

/// <summary>Body of POST api/v1/admin/early-access/{id}/followed-up: the over-limit count the SuperAdmin was looking at.</summary>
public class MarkFollowedUpDto
{
    /// <summary>The sign-up's OverLimitCount on screen. If more have arrived since, the server refuses (409) so they are not marked followed up unseen.</summary>
    public int OverLimitCount { get; set; }
}

/// <summary>What a repeat sign-up said when it differed from the stored answers; the tab shows only the fields that differ.</summary>
public class EarlyAccessLaterSubmissionDto
{
    public Guid Id { get; set; }
    public DateTime ReceivedAtUtc { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Organisation { get; set; } = string.Empty;
    public string? Role { get; set; }
    public string? Phone { get; set; }
    public string? OrganisationSize { get; set; }
    public string? Message { get; set; }
}
