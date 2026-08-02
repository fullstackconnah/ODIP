namespace Odip.Domain.Entities;

/// <summary>
/// Many-to-many join table linking Participants to Contacts.
/// </summary>
public class ParticipantContact
{
    public Guid ParticipantId { get; set; }
    public Participant Participant { get; set; } = null!;
    public Guid ContactId { get; set; }
    public Contact Contact { get; set; } = null!;
}
