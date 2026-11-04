using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// One emailed read-only link to a service agreement revision (agreement PR 3). Only the SHA-256 of the link's token is stored: the raw token exists
/// in the email and nowhere else. The row is the record of the send, so a contact edited later does not change who it went to. A link stops working
/// when it expires, is revoked (a newer send, the approval, End early) or its revision is deleted (the FK cascades). <see cref="SendError"/> is set when
/// the email did not go ("NotConfigured" or "Failed"); such a row never opens.
/// </summary>
public class ServiceAgreementShare : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Guid ParticipantId { get; set; }
    public Guid DraftId { get; set; }
    public ServiceAgreementDraft? Draft { get; set; }
    /// <summary>Lowercase hex SHA-256 of the raw token (64 characters), unique.</summary>
    public string TokenHash { get; set; } = string.Empty;
    /// <summary>The contact's Person; null when it went to the participant themselves.</summary>
    public Guid? RecipientPersonId { get; set; }
    public string RecipientName { get; set; } = string.Empty;
    public string RecipientEmail { get; set; } = string.Empty;
    public Guid? SentByUserId { get; set; }
    public string SentByName { get; set; } = string.Empty;
    public DateTime SentAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? OpenedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public string? SendError { get; set; }
}
