namespace Odip.Domain.Entities;

/// <summary>How many times a participant's scalar section (a PATCH group, e.g. "medical") has been saved. A missing row is revision 0.</summary>
public class ParticipantGroupRevision
{
    public Guid ParticipantId { get; set; }
    public string GroupKey { get; set; } = "";   // camelCase PATCH group key
    public int Revision { get; set; }            // EF concurrency token
    public DateTime UpdatedAt { get; set; }
}
