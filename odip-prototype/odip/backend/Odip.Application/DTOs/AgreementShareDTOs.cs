using System.ComponentModel.DataAnnotations;

namespace Odip.Application.DTOs;

/// <summary>The body of POST .../service-agreement-drafts/{id}/send. The address is never sent: the server reads it from the contact's record.</summary>
public record SendAgreementDto
{
    /// <summary>A contact of this participant to send to; absent means the default recipient (the first active Guardian, else Plan Nominee, else the participant).</summary>
    public Guid? PersonId { get; init; }
    /// <summary>The version the person saw; a newer save refuses the send (409), so a stale page never mails an old plan.</summary>
    [Range(1, int.MaxValue)] public int ExpectedVersion { get; init; }
}

/// <summary>The answer to a send: <see cref="Error"/> is absent when it went, else NotConfigured (no email set up) or Failed.</summary>
public record SendAgreementResultDto
{
    public bool Sent { get; init; }
    public string? Error { get; init; }
}

/// <summary>One person the agreement can be sent to. <see cref="PersonId"/> is absent for the participant themselves. No email when none is on file (then it cannot be chosen).</summary>
public record AgreementContactDto
{
    public Guid? PersonId { get; init; }
    public string Name { get; init; } = "";
    /// <summary>Their roles to the participant, for example "Guardian, Next of kin"; "Participant" for the participant.</summary>
    public string Roles { get; init; } = "";
    public string? Email { get; init; }
    public bool IsDefault { get; init; }
}

/// <summary>One send of a revision, newest first. Never carries the link or its hash.</summary>
public record AgreementShareRowDto
{
    public Guid Id { get; init; }
    public Guid DraftId { get; init; }
    public int DraftVersion { get; init; }
    public string RecipientName { get; init; } = "";
    public string RecipientEmail { get; init; } = "";
    public string SentByName { get; init; } = "";
    public DateTime SentAt { get; init; }
    public DateTime ExpiresAt { get; init; }
    public DateTime? OpenedAt { get; init; }
    public DateTime? RevokedAt { get; init; }
    /// <summary>Absent when the email went. A row with an error was not sent and is never shown as Sent.</summary>
    public string? SendError { get; init; }
}

/// <summary>The answer to GET .../{id}/sharing.</summary>
public record AgreementSharingDto
{
    public List<AgreementContactDto> Contacts { get; init; } = [];
    public List<AgreementShareRowDto> Shares { get; init; } = [];
}

/// <summary>What the person with the emailed link sees as JSON. Deliberately no NDIS number or date of birth: those are only in the PDF they are sent.</summary>
public record SharedAgreementDto
{
    public string ProviderName { get; init; } = "";
    public string ParticipantName { get; init; } = "";
    public DateOnly StartDate { get; init; }
    /// <summary>Absent on an ongoing agreement, which runs until the plan ends.</summary>
    public DateOnly? EndDate { get; init; }
    public bool IsOngoing { get; init; }
    public string PeriodText { get; init; } = "";
    public List<SharedAgreementLineDto> Lines { get; init; } = [];
    public decimal Total { get; init; }
    public string? ContactEmail { get; init; }
    public string? ContactPhone { get; init; }
    public DateTime ExpiresAt { get; init; }
}

public record SharedAgreementLineDto
{
    public string Item { get; init; } = "";
    public decimal Quantity { get; init; }
    public string Unit { get; init; } = "";
    public decimal UnitPrice { get; init; }
    public decimal Total { get; init; }
}
