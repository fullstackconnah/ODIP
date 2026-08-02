using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Family, guardian, support coordinator, or other key contact linked to participants.
/// </summary>
public class Contact
{
    public Guid Id { get; set; }
    public string FirstName { get; set; } = string.Empty;
    public string LastName { get; set; } = string.Empty;
    public string FullName => $"{FirstName} {LastName}";
    public string? RoleRelationship { get; set; }
    public string? Organisation { get; set; }
    public string? Email { get; set; }
    public string? Mobile { get; set; }
    public string? Phone { get; set; }
    public string? Address { get; set; }
    public string? Suburb { get; set; }
    public string? State { get; set; }
    public string? Postcode { get; set; }
    public PreferredContactMethod PreferredContactMethod { get; set; }
    public ContactType ContactType { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<ParticipantContact> ParticipantContacts { get; set; } = new List<ParticipantContact>();
}
